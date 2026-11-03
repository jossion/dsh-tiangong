/**
 * Host half of the Workbench bundle.
 *
 * Two domains:
 *  - operations: staff directory and finance ledger, persisted as local JSON
 *  - delivery:   requirement-driven software planning runs
 *
 * Plus the decision log both of them write into: every judgement the delivery
 * workflow makes becomes one line in `events.jsonl`, and the panel is a
 * projection of that file. The panel reads it over one read-only host route,
 * so the browser never keeps its own copy of the data.
 *
 * Everything registered here is owned by this plugin's context, so unloading
 * the plugin removes it. Optional services are resolved lazily so the plugin
 * still activates in a profile that lacks them.
 */
import { existsSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { createStore } from './store.js'
import { createDelivery } from './delivery.js'
import { createEventLog, summarize } from './events.js'
import { artifactEvent, buildBoard, foldTasks, jobEvent, projectEvent, requirementEvent, taskEvent } from './projects.js'
import { AppDbError, createEmployee, deleteEmployee, listEmployees, updateEmployee } from './appdb.js'
import {
  OrgError, createCompany, createDepartment, createJobLevel, deleteCompany, deleteDepartment, deleteJobLevel,
  listCompanies, listDepartments, listJobLevels, renameCompany, updateDepartment, updateJobLevel,
} from './orgdb.js'
import { disposeAll, listServices, ServiceError, startService, stopService } from './services.js'
import { readyWork, reportEvents } from './executor.js'
import { PlanError, assertPlan, buildCardId, planEvents } from './planner.js'
import { RequirementError, assertRequirement, storeRequirement } from './requirements.js'
import { SKILL_LIMITS, formatSkillResult, marketCandidates, rankSkills } from './skillfind.js'
import { createSessionBridge } from './sessions.js'
import { createDispatcher } from './dispatch.js'
import { readFinanceLedger } from './ledgerdb.js'
import {
  DEFAULT_FINANCE_DIR,
  fileFingerprint,
  filterTransactions,
  resolveRange,
  statementSheets,
  summarizeFinance,
  toTransactions,
} from './finance.js'

export const inject = ['llm', 'tools']

const DEFAULTS = {
  dataDir: '',
  // Empty means "whatever this profile serves" — see resolveRoute().
  provider: '',
  model: '',
}

/** The panel reads this. GET only: nothing reachable here starts work. */
export const STATE_PATH = '/workbench/state'

/** The panel's write routes. Both POST only. */
export const START_PATH = '/workbench/start'
export const PROJECTS_PATH = '/workbench/projects'
export const CONTROL_PATH = '/workbench/control'
export const DECIDE_PATH = '/workbench/decide'
export const CONFIG_PATH = '/workbench/project-config'
export const EMPLOYEES_PATH = '/workbench/employees'
export const SERVICES_PATH = '/workbench/services'
export const JOB_CONFIG_PATH = '/workbench/job-config'
/** Requirements: one route, POST only. A requirement opens a job. */
export const REQUIREMENTS_PATH = '/workbench/requirements'

/** Finance: one route, read on GET, import/configure on POST. */
export const FINANCE_PATH = '/workbench/finance'
export const ORG_PATH = '/workbench/organization'
export const PICK_PATH = '/workbench/pick-path'
export const BROWSE_PATH = '/workbench/browse-path'
/**
 * The same report the `workbench_report_work` tool writes, over HTTP.
 *
 * The agent tools only exist for an agent the host launched. Work that happens
 * outside that path (a hand-driven session, a script) still has to land on the
 * board, or the cockpit shows "待开始" for work that is actually running.
 */
export const TASK_PATH = '/workbench/task'

function resolveDataDir(configured) {
  if (configured) return configured
  return join(homedir(), '.dsh', 'workbench')
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}

/** Cap the request body: a requirement is a paragraph, not an upload. */
const MAX_BODY_BYTES = 16 * 1024

/**
 * A requirement document is uploaded as base64 inside JSON, so the one route
 * that accepts one needs a wider cap. It is still bounded: the decoded file is
 * limited by `requirements.js`, and this is only the transport ceiling.
 */
const MAX_UPLOAD_BYTES = 1024 * 1024

/** Read a JSON request body from a Node stream (or a pre-set string in tests). */
async function readJsonBody(request, limit = MAX_BODY_BYTES) {
  if (typeof request.body === 'string') {
    if (request.body.length > limit) throw new Error('body too large')
    return JSON.parse(request.body)
  }
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/**
 * Reject a cross-origin write. A same-origin fetch from the panel may carry an
 * Origin header; a request with none is a local tool (curl, tests) and is
 * allowed, since it never carries a browser's ambient authority.
 */
function isSameOrigin(request) {
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === request.headers?.host
  } catch {
    return false
  }
}

/**
 * The host's own trust fence for raw web routes. `webServer` hands us the full
 * request/response; only `connection` knows the browser authentication and
 * Host/Origin policy, so every route asks it before touching the ledger.
 *
 * A profile without the connection service keeps its old same-origin check:
 * that is a degraded host, not a reason to stop serving the panel.
 */
function connectionDenied(ctx, request) {
  try {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (connection === null || connection === undefined || typeof connection.requestRejection !== 'function') return false
    const rejection = connection.requestRejection(request)
    return rejection !== null && rejection !== undefined && rejection !== false
  } catch {
    return false
  }
}

/** Roots a path-sensitive route may touch: home, the data dir, DSH workspaces. */
function allowedRoots(ctx, config) {
  const roots = [homedir(), config.dataDir]
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    const list = registry !== null && registry !== undefined && typeof registry.list === 'function' ? registry.list() : []
    for (const workspace of Array.isArray(list) ? list : []) {
      if (typeof workspace?.path === 'string' && workspace.path !== '') roots.push(workspace.path)
    }
  } catch {
    /* no registry: home and the data dir are still allowed */
  }
  return roots.filter(root => typeof root === 'string' && root !== '').map(root => resolve(root))
}

/** Is `target` inside one of the allowed roots (or equal to one)? */
function pathAllowed(target, roots) {
  const resolved = resolve(target)
  return roots.some(root => resolved === root || resolved.startsWith(`${root}${sep}`))
}

export const pickScript = (kind, prompt) => {
  // AppleScript strings have no backslash escape: keep quotes and control
  // characters out of the prompt rather than trying to escape them.
  const safe = String(prompt ?? '').replace(/["\\`$\n\r\t]/g, ' ').slice(0, 120)
  if (process.platform === 'darwin') {
    const verb = kind === 'directory' ? 'choose folder' : 'choose file'
    return { file: 'osascript', args: ['-e', `POSIX path of (${verb} with prompt "${safe}")`] }
  }
  if (process.platform === 'win32') {
    const dialog = kind === 'directory'
      ? 'FolderBrowserDialog'
      : 'OpenFileDialog'
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      `$d = New-Object System.Windows.Forms.${dialog};`,
      `$d.Description = "${safe}";`,
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath ?? $d.FileName }',
    ].join(' ')
    return { file: 'powershell', args: ['-NoProfile', '-Command', script] }
  }
  if (process.platform === 'linux') {
    return { file: 'zenity', args: ['--file-selection', ...(kind === 'directory' ? ['--directory'] : []), `--title=${safe}`] }
  }
  return null
}

export function apply(ctx, row) {
  const config = { ...DEFAULTS, ...(row ?? {}) }
  if (!isAbsolute(config.dataDir)) {
    config.dataDir = resolveDataDir(config.dataDir)
  }

  const store = createStore(config.dataDir)
  const events = createEventLog(join(config.dataDir, 'events.jsonl'))
  // The delivery loop's two halves: the host bridge (sessions/agents) and the
  // dispatcher that wakes the bound agent when work is ready.
  const sessionBridge = createSessionBridge({ ctx, config, events })
  let loop = null

  // A decision sink that never lets an audit failure abort a run: losing one
  // log line is bad, losing the delivery is worse.
  const recordDecision = event => events.append(event).catch(error => {
    try {
      ctx.logger?.warn?.('[workbench] could not record decision', error)
    } catch {
      /* logging is best-effort too */
    }
    return null
  })

  // One sink for every line the run produces, decisions and board cards alike:
  // both projections read the same file, so they cannot disagree about history.
  const delivery = createDelivery({ ctx, config, store, onDecision: recordDecision, onEvent: recordDecision })

  // The handle on the one planning run in flight, so /control can abort it.
  let planning = null

  // Cordis contexts only expose declared keys, so the store, event log and
  // delivery runner stay module-local; the tool and the route below are the
  // plugin's public surface.

  // Read-only state route for the panel.
  //
  // It rides a `webServer` sub-fiber rather than a one-shot `ctx.get` during
  // `apply`: loader entries settle concurrently, so a service that is absent
  // at apply time can be present a moment later. A headless profile simply
  // never activates this fiber and still writes events.
  const route = {
    kind: 'exact',
    path: STATE_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      try {
        // One read of the log feeds both projections. They are two views of
        // the same file: the decision panel renders `summary` + `events`, the
        // project board renders `board`.
        const all = await events.all()
        const summary = summarize(all)
        const board = buildBoard(all)
        // Newest first is what the stream renders; the file stays oldest-first.
        sendJson(response, 200, {
          summary,
          board,
          planning: delivery.isRunning(),
          events: [...all].slice(-30).reverse(),
        })
      } catch (error) {
        sendJson(response, 500, {
          error: { code: 'state-unavailable', message: String(error?.message ?? error) },
        })
      }
    },
  }

  /** A named, empty project card: created before any work exists. */
  const projectsRoute = {
    kind: 'exact',
    path: PROJECTS_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      let name = ''
      try {
        name = String((await readJsonBody(request))?.name ?? '').trim()
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-request', message: String(error?.message ?? error) } })
        return
      }
      if (name === '') {
        sendJson(response, 400, { error: { code: 'empty-name', message: 'name must not be empty' } })
        return
      }
      const projectId = `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await events.append(projectEvent({
        projectId,
        title: name.slice(0, 80),
        event: 'created',
        ts: new Date().toISOString(),
      }))
      sendJson(response, 201, { projectId, name: name.slice(0, 80) })
    },
  }

  /**
   * The write route. It is separate from the read route on purpose: a path that
   * answers GET must not also start work, or "read-only" stops being a checkable
   * property of the URL.
   */
  const startRoute = {
    kind: 'exact',
    path: START_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      let requirement = ''
      let projectId = ''
      let jobIdFromBody = ''
      let parentJobIdFromBody = ''
      let kindFromBodyRaw = ''
      try {
        const body = await readJsonBody(request)
        jobIdFromBody = String(body?.jobId ?? '').trim()
        parentJobIdFromBody = String(body?.parentJobId ?? '').trim()
        kindFromBodyRaw = String(body?.kind ?? '').trim()
        requirement = String(body?.requirement ?? '').trim()
        projectId = String(body?.projectId ?? '').trim()
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-request', message: String(error?.message ?? error) } })
        return
      }
      if (requirement === '') {
        sendJson(response, 400, { error: { code: 'empty-requirement', message: 'requirement must not be empty' } })
        return
      }
      if (delivery.isRunning()) {
        sendJson(response, 409, { error: { code: 'already-running', message: 'a planning run is already in progress' } })
        return
      }
      // Planning takes as long as several model calls: answer "accepted" and
      // let the board be the progress channel. The project appears as soon as
      // its first event is appended.
      const controller = new AbortController()
      planning = { controller, projectId: projectId === '' ? null : projectId }
      const jobId = typeof jobIdFromBody === 'string' ? jobIdFromBody : ''
      // Lineage for follow-up work: a change request points at the finished job.
      const parentJobId = typeof parentJobIdFromBody === 'string' ? parentJobIdFromBody : ''
      const kindFromBody = typeof kindFromBodyRaw === 'string' ? kindFromBodyRaw : ''
      planning = { controller, projectId: projectId === '' ? null : projectId, jobId: jobId === '' ? null : jobId }
      delivery.run({
        brief: requirement,
        ...(projectId === '' ? {} : { projectId }),
        ...(jobId === '' ? {} : { jobId }),
        ...(parentJobId === '' ? {} : { parentJobId }),
        ...(kindFromBody === '' ? {} : { kind: kindFromBody }),
        signal: controller.signal,
      }).catch(error => {
        try {
          ctx.logger?.warn?.('[workbench] planning stopped', error)
        } catch {
          /* logging is best-effort */
        }
      }).finally(() => {
        if (planning !== null && planning.controller === controller) planning = null
      })
      sendJson(response, 202, { status: 'planning', requirement })
    },
  }

  /**
   * Pause / resume / cancel. Pausing stops the dispatch queue (the filter lives
   * in the executor, not the UI); cancelling also aborts a planning run that is
   * already spending model calls. Stopping work has to be a first-class verb,
   * otherwise the only way to stop is to kill the host.
   */
  const controlRoute = {
    kind: 'exact',
    path: CONTROL_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      let projectId = ''
      let jobId = ''
      let action = ''
      try {
        const body = await readJsonBody(request)
        projectId = String(body?.projectId ?? '').trim()
        jobId = String(body?.jobId ?? '').trim()
        action = String(body?.action ?? '').trim()
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-request', message: String(error?.message ?? error) } })
        return
      }
      const eventsByAction = { pause: 'paused', resume: 'resumed', cancel: 'cancelled' }
      if (Object.hasOwn(eventsByAction, action) === false) {
        sendJson(response, 400, { error: { code: 'unknown-action', message: 'action must be pause, resume or cancel' } })
        return
      }
      if (projectId === '') {
        sendJson(response, 400, { error: { code: 'missing-project', message: 'projectId is required' } })
        return
      }

      // A cancelled planning run should not have to finish its model calls.
      let aborted = false
      if (action === 'cancel' && planning !== null) {
        aborted = true
        planning.controller.abort()
      }
      // A job-scoped control pauses/stops that job only; an unscoped one is a
      // project-level decision that applies to every job in the project.
      const now = new Date().toISOString()
      if (jobId !== '') {
        await events.append(jobEvent({ projectId, jobId, event: eventsByAction[action], ts: now }))
        // A paused project gates every job. Resuming one job therefore has to
        // lift that gate too, otherwise "resume" answers 200 and nothing moves.
        if (action === 'resume') {
          await events.append(projectEvent({ projectId, event: 'resumed', ts: now }))
        }
      } else {
        await events.append(projectEvent({ projectId, event: eventsByAction[action], ts: now }))
      }
      sendJson(response, 200, {
        projectId,
        ...(jobId === '' ? {} : { jobId }),
        action,
        aborted,
        status: eventsByAction[action],
      })
    },
  }

  /**
   * Resolve one gate. Approving records the approval and lets the card move;
   * rejecting also parks the card, so a rejection is a real stop rather than
   * a note nobody acts on.
   */
  const decideRoute = {
    kind: 'exact',
    path: DECIDE_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      let body = {}
      try {
        body = await readJsonBody(request)
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-request', message: String(error?.message ?? error) } })
        return
      }
      const taskId = String(body?.taskId ?? '').trim()
      const action = String(body?.action ?? '').trim()
      const decision = String(body?.decision ?? '').trim()
      const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null
      if (taskId === '' || action === '' || (decision !== 'approve' && decision !== 'reject')) {
        sendJson(response, 400, { error: { code: 'bad-request', message: 'taskId, action and decision (approve|reject) are required' } })
        return
      }
      const ts = new Date().toISOString()
      await events.append({
        kind: 'approval',
        taskId,
        action,
        status: decision === 'approve' ? 'approved' : 'rejected',
        note,
        ts,
      })
      if (decision === 'reject') {
        await events.append(taskEvent({ event: 'blocked', taskId, ts, notes: note ?? 'rejected by the owner' }))
      }
      sendJson(response, 200, { taskId, action, decision, ts })
    },
  }

  /**
   * Point a project at its workspace. The employee module reads the app's
   * SQLite file from there, so this is configuration, not a running server.
   */
  const configRoute = {
    kind: 'exact',
    path: CONFIG_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      let projectId = ''
      let workspace = ''
      try {
        const body = await readJsonBody(request)
        projectId = String(body?.projectId ?? '').trim()
        workspace = String(body?.workspace ?? '').trim()
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-request', message: String(error?.message ?? error) } })
        return
      }
      if (projectId === '' || workspace === '') {
        sendJson(response, 400, { error: { code: 'bad-request', message: 'projectId and workspace are required' } })
        return
      }
      if (!isAbsolute(workspace) || !existsSync(workspace) || !statSync(workspace).isDirectory()) {
        sendJson(response, 400, { error: { code: 'bad-workspace', message: 'workspace must be an existing absolute directory' } })
        return
      }
      if (!pathAllowed(workspace, allowedRoots(ctx, config))) {
        sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${workspace}` } })
        return
      }
      await events.append(projectEvent({ projectId, workspace, event: 'config', ts: new Date().toISOString() }))
      sendJson(response, 200, { projectId, workspace })
    },
  }

  const workspaceOf = async projectId => {
    const board = buildBoard(await events.all())
    return board.projects.find(project => project.id === projectId)?.workspace ?? null
  }

  const dbError = (error, response, fallback = 500) => {
    if (error instanceof AppDbError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'EMAIL_CONFLICT' ? 409 : 400
      sendJson(response, status, { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } })
      return
    }
    sendJson(response, fallback, { error: { code: 'INTERNAL_ERROR', message: String(error?.message ?? error) } })
  }

  /**
   * The panel's own employee API, backed by the delivered app's SQLite file.
   * The point is that the panel does not need the app's HTTP server to be up:
   * one workbench, one data source, no iframe.
   */
  const employeesRoute = {
    kind: 'exact',
    path: EMPLOYEES_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      try {
        if (request.method === 'GET') {
          const projectId = url.searchParams.get('projectId') ?? ''
          const workspace = await workspaceOf(projectId)
          if (workspace === null) {
            sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'no such project' } })
            return
          }
          const result = listEmployees(workspace, {
            search: url.searchParams.get('search') ?? '',
            status: url.searchParams.get('status') ?? '',
            companyId: url.searchParams.get('companyId') ?? '',
            limit: url.searchParams.get('limit') ?? 50,
            offset: url.searchParams.get('offset') ?? 0,
          })
          sendJson(response, 200, { data: result.rows, total: result.total, limit: result.limit, offset: result.offset })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: { code: 'method-not-allowed' } })
          return
        }
        let body = {}
        body = await readJsonBody(request)
        const workspace = await workspaceOf(String(body?.projectId ?? ''))
        if (workspace === null) {
          sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'no such project' } })
          return
        }
        const op = String(body?.op ?? 'create')
        if (op === 'create') {
          sendJson(response, 201, { data: createEmployee(workspace, body?.employee ?? {}) })
          return
        }
        if (op === 'update') {
          sendJson(response, 200, { data: updateEmployee(workspace, body?.id, body?.patch ?? {}) })
          return
        }
        if (op === 'delete') {
          deleteEmployee(workspace, body?.id)
          sendJson(response, 200, { data: { id: Number(body?.id) } })
          return
        }
        sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: `unknown op ${op}` } })
      } catch (error) {
        dbError(error, response)
      }
    },
  }

  /** Name a job (planning run): the requirement, not the project container. */
  const jobConfigRoute = {
    kind: 'exact',
    path: JOB_CONFIG_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      let body = {}
      try {
        body = await readJsonBody(request)
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-request', message: String(error?.message ?? error) } })
        return
      }
      const projectId = String(body?.projectId ?? '').trim()
      const jobId = String(body?.jobId ?? '').trim()
      if (projectId === '' || jobId === '') {
        sendJson(response, 400, { error: { code: 'bad-request', message: 'projectId and jobId are required' } })
        return
      }
      const patch = {}
      if (body?.title !== undefined) {
        const title = String(body.title ?? '').trim()
        if (title === '' || title.length > 80) {
          sendJson(response, 400, { error: { code: 'bad-request', message: 'title must be 1-80 characters' } })
          return
        }
        patch.title = title
      }
      if (body?.workspace !== undefined) {
        const workspace = String(body.workspace ?? '').trim()
        if (workspace !== '' && (!isAbsolute(workspace) || !existsSync(workspace) || !statSync(workspace).isDirectory())) {
          sendJson(response, 400, { error: { code: 'bad-workspace', message: 'workspace must be an existing absolute directory' } })
          return
        }
        if (workspace !== '' && !pathAllowed(workspace, allowedRoots(ctx, config))) {
          sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${workspace}` } })
          return
        }
        patch.workspace = workspace === '' ? null : workspace
      }
      if (body?.workspaceId !== undefined) {
        const workspaceId = String(body.workspaceId ?? '').trim()
        patch.workspaceId = workspaceId === '' ? null : workspaceId
      }
      if (body?.sessionId !== undefined) {
        const sessionId = String(body.sessionId ?? '').trim()
        patch.sessionId = sessionId === '' ? null : sessionId
      }
      if (Object.keys(patch).length === 0) {
        sendJson(response, 400, { error: { code: 'bad-request', message: 'nothing to update' } })
        return
      }
      await events.append(jobEvent({ projectId, jobId, ...patch, event: 'config', ts: new Date().toISOString() }))
      sendJson(response, 200, { projectId, jobId, ...patch })
    },
  }

  /** Dependencies of a project: what it needs, whether it is up, and controls. */
  const servicesRoute = {
    kind: 'exact',
    path: SERVICES_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      try {
        if (request.method === 'GET') {
          const workspace = await workspaceOf(url.searchParams.get('projectId') ?? '')
          if (workspace === null) {
            sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'no such project' } })
            return
          }
          sendJson(response, 200, { data: await listServices(workspace) })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: { code: 'method-not-allowed' } })
          return
        }
        const body = await readJsonBody(request)
        const workspace = await workspaceOf(String(body?.projectId ?? ''))
        if (workspace === null) {
          sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'no such project' } })
          return
        }
        const serviceId = String(body?.serviceId ?? '')
        const action = String(body?.action ?? '')
        if (action === 'start') {
          if (!pathAllowed(workspace, allowedRoots(ctx, config))) {
            sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${workspace}` } })
            return
          }
          const result = await startService(workspace, String(body?.projectId ?? ''), serviceId)
          sendJson(response, 200, { data: result })
          return
        }
        if (action === 'stop') {
          const result = await stopService(workspace)
          sendJson(response, 200, { data: result })
          return
        }
        sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: `unknown action ${action}` } })
      } catch (error) {
        if (error instanceof ServiceError) {
          const status = error.code === 'NO_APP' || error.code === 'BAD_REQUEST' ? 400 : 502
          sendJson(response, status, { error: { code: error.code, message: error.message } })
          return
        }
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: String(error?.message ?? error) } })
      }
    },
  }

  // ---------------------------------------------------------------------------
  // Finance: bank-statement CSV -> transactions -> one dashboard payload.
  //
  // The host owns the filesystem read. A browser cannot list a directory, and
  // "读取指定目录里的 CSV" is the requirement verbatim, so the panel names a
  // directory and the host answers with the files it may import. Nothing here
  // touches the ledger: statement rows are their own collection, and the read
  // route stays read-only while POST carries the two writes (set-dir/import).
  // ---------------------------------------------------------------------------
  const FINANCE_CONFIG_ID = 'finance'

  const expandHome = value => {
    const text = String(value ?? '').trim()
    if (text === '' || text === '~') return text === '~' ? homedir() : ''
    if (text.startsWith('~/')) return join(homedir(), text.slice(2))
    return text
  }

  const financeConfigId = projectId => (projectId ? `${FINANCE_CONFIG_ID}:${projectId}` : FINANCE_CONFIG_ID)
  async function financeConfig(projectId = '') {
    const rows = await store.list('financeConfig')
    const row = rows.find(item => item.id === financeConfigId(projectId))
    return {
      // Two sources: a folder of exported statements, or the app's own ledger
      // database (read-only). `files` is the default so an old config keeps
      // working without a migration.
      source: row?.source === 'sqlite' ? 'sqlite' : 'files',
      dir: expandHome(row?.dir ?? '') || DEFAULT_FINANCE_DIR,
      dbPath: expandHome(row?.dbPath ?? ''),
    }
  }

  async function saveFinanceConfig(projectId, patch) {
    const id = financeConfigId(projectId)
    const rows = await store.list('financeConfig')
    const row = rows.find(item => item.id === id)
    if (row === undefined) return store.add('financeConfig', { id, projectId, ...patch })
    return store.update('financeConfig', id, patch)
  }

  /**
   * The CSV files in the configured directory.
   *
   * "Already imported" is matched on name+size instead of hashing every file on
   * every panel poll: a 10 MB statement should not be read to answer "is there
   * anything new". The import itself still fingerprints the bytes, so the
   * double-import guard is exact where it matters.
   */
  async function financeFiles(dir, projectId = '') {
    const imports = (await store.list('financeImports')).filter(item => (item.projectId ?? '') === projectId)
    const importedByKey = new Map(imports.map(item => [`${item.file}:${item.size}`, item]))
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const files = []
      for (const entry of entries) {
        if (entry.isFile() === false || /\.(csv|xlsx|xlsm|xls)$/i.test(entry.name) === false) continue
        const info = await stat(join(dir, entry.name))
        const imported = importedByKey.get(`${entry.name}:${info.size}`)
        files.push({
          name: entry.name,
          format: entry.name.split('.').pop().toLowerCase(),
          size: info.size,
          mtime: info.mtime.toISOString(),
          importedAt: imported?.importedAt ?? null,
          rows: imported?.rows ?? null,
        })
      }
      files.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)) || a.name.localeCompare(b.name))
      return { exists: true, files, error: null }
    } catch (error) {
      return { exists: false, files: [], error: String(error?.message ?? error) }
    }
  }

  /** Parse the selected files, refuse rows already on the books, write once. */
  async function financeImport(dir, requested, projectId = '') {
    const listing = await financeFiles(dir, projectId)
    if (listing.exists === false) {
      return { imported: [], skipped: [], errors: [{ file: '*', message: listing.error }] }
    }
    const wanted = Array.isArray(requested) && requested.length > 0 ? new Set(requested) : null
    const existingImports = (await store.list('financeImports')).filter(item => (item.projectId ?? '') === projectId)
    const importedFingerprints = new Set(existingImports.map(item => item.fingerprint))
    const existing = (await store.list('financeTransactions')).filter(item => (item.projectId ?? '') === projectId)
    const seen = new Set(existing.map(item => item.hash))
    const imported = []
    const skipped = []
    const errors = []
    for (const file of listing.files) {
      if (wanted !== null && wanted.has(file.name) === false) continue
      try {
        const buffer = await readFile(join(dir, file.name))
        const fingerprint = fileFingerprint(buffer)
        if (importedFingerprints.has(fingerprint)) {
          skipped.push({ file: file.name, reason: 'already-imported', rows: file.rows ?? 0 })
          continue
        }
        const importId = `fin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        // A workbook may open on a cover tab; take the first sheet whose header
        // maps, not blindly the first sheet.
        const sheets = statementSheets(buffer, file.name)
        let parsed = null
        let sheetName = ''
        for (const sheet of sheets) {
          const candidate = toTransactions(sheet.rows, { file: file.name, importId })
          if (candidate.headerIndex >= 0) {
            parsed = candidate
            sheetName = sheet.name
            break
          }
        }
        if (parsed === null) {
          errors.push({ file: file.name, message: '找不到表头：至少需要一列日期和一列金额' })
          continue
        }
        const fresh = []
        for (const transaction of parsed.transactions) {
          if (seen.has(transaction.hash)) continue
          seen.add(transaction.hash)
          fresh.push({ ...transaction, id: `${importId}_${transaction.line}`, projectId })
        }
        await store.addMany('financeTransactions', fresh)
        const record = {
          id: importId,
          projectId,
          file: file.name,
          dir,
          fingerprint,
          encoding: sheets[0]?.encoding ?? 'utf-8',
          sheet: sheetName,
          format: file.name.split('.').pop().toLowerCase(),
          size: file.size,
          rows: fresh.length,
          skipped: parsed.skipped,
          duplicateRows: parsed.transactions.length - fresh.length,
          importedAt: new Date().toISOString(),
        }
        await store.add('financeImports', record)
        importedFingerprints.add(fingerprint)
        imported.push(record)
      } catch (error) {
        errors.push({ file: file.name, message: String(error?.message ?? error) })
      }
    }
    return { imported, skipped, errors }
  }

  /** One payload feeds the whole finance page: source, files, aggregates, rows. */
  async function financePayload(url, projectId = '') {
    const config = await financeConfig(projectId)
    // `preset` is resolved here, not in the browser: one definition of "本月"
    // (the local calendar) instead of one per client.
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    const preset = url.searchParams.get('preset') ?? ''
    const range = from !== '' || to !== '' ? { from, to } : resolveRange(preset)
    const filters = {
      from: range.from,
      to: range.to,
      category: url.searchParams.get('category') ?? '',
      direction: url.searchParams.get('direction') ?? '',
      q: url.searchParams.get('q') ?? '',
      preset,
    }

    if (config.source === 'sqlite') {
      // The ledger database is the source of truth: read it per request instead
      // of copying rows, so an edit in the app shows up here on the next poll.
      try {
        const ledger = await readFinanceLedger(config.dbPath)
        return {
          source: 'sqlite',
          dbPath: config.dbPath,
          dbExists: true,
          dbError: null,
          dir: config.dir,
          dirExists: true,
          files: [],
          imports: [],
          categories: ledger.categories,
          companies: ledger.companies,
          summary: summarizeFinance(ledger.transactions, filters),
          transactions: filterTransactions(ledger.transactions, filters)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)))
            .slice(0, 200),
          totalTransactions: ledger.transactions.length,
          range: ledger.range,
          filters,
        }
      } catch (error) {
        return {
          source: 'sqlite',
          dbPath: config.dbPath,
          dbExists: false,
          dbError: String(error?.message ?? error),
          dir: config.dir,
          dirExists: true,
          files: [],
          imports: [],
          categories: [],
          companies: [],
          summary: summarizeFinance([], filters),
          transactions: [],
          totalTransactions: 0,
          filters,
        }
      }
    }

    const listing = await financeFiles(config.dir, projectId)
    const all = (await store.list('financeTransactions')).filter(item => (item.projectId ?? '') === projectId)
    const summary = summarizeFinance(all, filters)
    const transactions = filterTransactions(all, filters)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.line).localeCompare(String(a.line)))
      .slice(0, 200)
    const imports = (await store.list('financeImports')).filter(item => (item.projectId ?? '') === projectId)
    return {
      source: 'files',
      dir: config.dir,
      dbPath: config.dbPath,
      dirExists: listing.exists,
      dirError: listing.error,
      files: listing.files,
      imports: imports.slice().reverse(),
      categories: [...new Set(all.map(item => item.category))].filter(Boolean).sort(),
      summary,
      transactions,
      totalTransactions: all.length,
      filters,
    }
  }

  const financeRoute = {
    kind: 'exact',
    path: FINANCE_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (request.method === 'POST' && !isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      let projectId = url.searchParams.get('projectId') ?? ''
      try {
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (projectId === '') {
            sendJson(response, 400, { error: { code: 'bad-request', message: 'projectId is required — finance belongs to a project' } })
            return
          }
          sendJson(response, 200, await financePayload(url, projectId))
          return
        }
        const body = await readJsonBody(request)
        projectId = projectId || String(body?.projectId ?? '')
        if (projectId === '') {
          sendJson(response, 400, { error: { code: 'bad-request', message: 'projectId is required — finance belongs to a project' } })
          return
        }
        const op = String(body?.op ?? '').trim()
        const source = body?.source === 'sqlite' ? 'sqlite' : 'files'
        if (op === 'set-source' || op === 'set-dir') {
          // `set-dir` stays as the folder-only alias an older panel may send.
          const nextSource = op === 'set-dir' ? 'files' : source
          if (nextSource === 'sqlite') {
            const dbPath = expandHome(body?.dbPath)
            if (dbPath === '' || !isAbsolute(dbPath)) {
              sendJson(response, 400, { error: { code: 'bad-request', message: 'dbPath must be an absolute path' } })
              return
            }
            if (!pathAllowed(dbPath, allowedRoots(ctx, config))) {
              sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${dbPath}` } })
              return
            }
            try {
              // Validate by reading, not by inspecting: a valid SQLite file
              // without a `finance` table is still the wrong database.
              await readFinanceLedger(dbPath)
            } catch (error) {
              sendJson(response, 400, { error: { code: 'bad-database', message: String(error?.message ?? error) } })
              return
            }
            await saveFinanceConfig(projectId, { source: 'sqlite', dbPath })
            sendJson(response, 200, { ok: true, source: 'sqlite', dbPath })
            return
          }
          const dir = expandHome(body?.dir)
          if (dir === '' || !isAbsolute(dir)) {
            sendJson(response, 400, { error: { code: 'bad-request', message: 'dir must be an absolute path' } })
            return
          }
          if (!pathAllowed(dir, allowedRoots(ctx, config))) {
            sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${dir}` } })
            return
          }
          try {
            const info = await stat(dir)
            if (!info.isDirectory()) throw new Error('not a directory')
          } catch (error) {
            sendJson(response, 400, {
              error: { code: 'bad-directory', message: `${dir}: ${String(error?.message ?? error)}` },
            })
            return
          }
          await saveFinanceConfig(projectId, { source: 'files', dir })
          sendJson(response, 200, { ok: true, source: 'files', dir })
          return
        }
        if (op === 'import') {
          const config = await financeConfig(projectId)
          if (config.source === 'sqlite') {
            sendJson(response, 400, {
              error: { code: 'not-applicable', message: 'SQLite 数据源是实时读取的，不需要导入' },
            })
            return
          }
          sendJson(response, 200, { ok: true, result: await financeImport(config.dir, body?.files, projectId) })
          return
        }
        sendJson(response, 400, { error: { code: 'bad-request', message: `unknown op ${op}` } })
      } catch (error) {
        sendJson(response, 500, {
          error: { code: 'finance-unavailable', message: String(error?.message ?? error) },
        })
      }
    },
  }

  /**
   * Report one card's transition over HTTP.
   *
   * Same gate as the `workbench_report_work` tool because it calls the same
   * `reportEvents`: "done" without green tests is recorded as blocked, so a
   * hand-driven session cannot grade its own homework either. The only new
   * thing is the transport — an agent working outside a host-launched run has
   * no tool to call, and a cockpit that shows 待开始 for work that is running
   * is exactly the lie this plugin exists to avoid.
   */
  const taskRoute = {
    kind: 'exact',
    path: TASK_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      try {
        const input = await readJsonBody(request)
        const taskId = String(input?.taskId ?? '').trim()
        if (taskId === '') {
          sendJson(response, 400, { error: { code: 'missing-task', message: 'taskId is required' } })
          return
        }
        const before = await events.all()
        const { tasks } = foldTasks(before)
        const task = tasks.get(taskId)
        if (task === undefined) {
          sendJson(response, 404, { error: { code: 'unknown-task', message: `unknown task: ${taskId}` } })
          return
        }
        const project = buildBoard(before).projects.find(item => item.id === task.projectId)
          ?? { id: task.projectId, artifactDir: null }
        const lines = reportEvents({
          task,
          project,
          report: {
            event: String(input?.event ?? 'progress'),
            files: Array.isArray(input?.files) ? input.files : [],
            linesChanged: Number(input?.linesChanged) || 0,
            notes: String(input?.notes ?? ''),
            tests: {
              exitCode: Number(input?.exitCode ?? 0),
              passed: Number(input?.testsPassed ?? 0),
              failed: Number(input?.testsFailed ?? 0),
            },
            ts: new Date().toISOString(),
          },
        })
        for (const line of lines) await events.append(line)
        const after = buildBoard(await events.all())
        sendJson(response, 200, {
          ok: true,
          taskId,
          recorded: lines[0]?.event ?? null,
          events: lines.length,
          readyAfter: readyWork(after, { projectId: project.id, limit: 99 }).work.length,
        })
      } catch (error) {
        sendJson(response, 400, {
          error: { code: 'task-unavailable', message: String(error?.message ?? error) },
        })
      }
    },
  }

  /**
   * Native file/folder picker.
   *
   * The panel runs in a sandboxed renderer, so `<input type=file>` can never
   * reveal an absolute path (and the ledger lives on disk, not in the browser).
   * The host asks the OS instead: AppleScript on macOS, PowerShell on Windows,
   * zenity on Linux. The dialog is confined to picking a path; nothing else of
   * the user's shell is involved.
   */

  const electronPick = async (kind, prompt) => {
    if (!process.versions?.electron) return null
    try {
      const require = createRequire(import.meta.url)
      const electron = require('electron')
      const dialog = electron?.dialog
      if (!dialog || typeof dialog.showOpenDialog !== 'function') return null
      // Never let a dialog call hang the request: without a window server it
      // may never resolve, and the panel would appear dead.
      const result = await Promise.race([
        dialog.showOpenDialog({
          title: prompt,
          properties: kind === 'directory' ? ['openDirectory', 'createDirectory'] : ['openFile'],
        }),
        new Promise(resolve => setTimeout(() => resolve(null), 1500)),
      ])
      if (result?.canceled || !Array.isArray(result?.filePaths) || result.filePaths.length === 0) return { cancelled: true, path: null }
      return { path: result.filePaths[0] }
    } catch {
      return null
    }
  }

  const runPick = command => new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
  })

  const orgRoute = {
    kind: 'exact',
    path: ORG_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const fail = error => {
        if (error instanceof OrgError) {
          const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'HAS_CHILDREN' ? 409 : 400
          sendJson(response, status, { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } })
          return
        }
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: String(error?.message ?? error) } })
      }
      try {
        if (request.method === 'GET') {
          const workspace = await workspaceOf(url.searchParams.get('projectId') ?? '')
          if (workspace === null) {
            sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'no such project' } })
            return
          }
          const companies = listCompanies(workspace)
          const requested = Number(url.searchParams.get('companyId') ?? 0)
          const company = companies.find(item => item.id === requested) ?? companies[0] ?? null
          sendJson(response, 200, {
            data: {
              companies,
              company,
              departments: company === null ? [] : listDepartments(workspace, company.id),
              jobLevels: company === null ? [] : listJobLevels(workspace, company.id),
            },
          })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: { code: 'method-not-allowed' } })
          return
        }
        const body = await readJsonBody(request)
        const workspace = await workspaceOf(String(body?.projectId ?? ''))
        if (workspace === null) {
          sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'no such project' } })
          return
        }
        const op = String(body?.op ?? '')
        if (op === 'company.create') {
          sendJson(response, 201, { data: { company: createCompany(workspace, body) } })
          return
        }
        if (op === 'company.rename') {
          sendJson(response, 200, { data: { company: renameCompany(workspace, Number(body?.id), body) } })
          return
        }
        if (op === 'company.delete') {
          sendJson(response, 200, { data: { deleted: deleteCompany(workspace, Number(body?.id)) } })
          return
        }
        if (op === 'department.create') {
          sendJson(response, 201, { data: { department: createDepartment(workspace, Number(body?.companyId), body) } })
          return
        }
        if (op === 'department.update') {
          sendJson(response, 200, { data: { department: updateDepartment(workspace, Number(body?.id), body) } })
          return
        }
        if (op === 'department.delete') {
          sendJson(response, 200, { data: { deleted: deleteDepartment(workspace, Number(body?.id)) } })
          return
        }
        if (op === 'joblevel.create') {
          sendJson(response, 201, { data: { jobLevel: createJobLevel(workspace, Number(body?.companyId), body) } })
          return
        }
        if (op === 'joblevel.update') {
          sendJson(response, 200, { data: { jobLevel: updateJobLevel(workspace, Number(body?.id), body) } })
          return
        }
        if (op === 'joblevel.delete') {
          sendJson(response, 200, { data: { deleted: deleteJobLevel(workspace, Number(body?.id)) } })
          return
        }
        sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: `unknown op ${op}` } })
      } catch (error) {
        fail(error)
      }
    },
  }

  const browseRoute = {
    kind: 'exact',
    path: BROWSE_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      const body = await readJsonBody(request).catch(() => ({}))
      const requested = typeof body?.path === 'string' && body.path !== '' ? expandHome(body.path) : homedir()
      if (!pathAllowed(requested, allowedRoots(ctx, config))) {
        sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${requested}` } })
        return
      }
      try {
        const info = await stat(requested)
        if (!info.isDirectory()) throw new Error('not a directory')
        const entries = await readdir(requested, { withFileTypes: true })
        const visible = entries
          .filter(entry => entry.name.startsWith('.') === false)
          .map(entry => ({
            name: entry.name,
            path: join(requested, entry.name),
            isDir: entry.isDirectory(),
          }))
          .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
        sendJson(response, 200, {
          path: requested,
          parent: dirname(requested) === requested ? null : dirname(requested),
          entries: visible,
          home: homedir(),
        })
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-path', message: String(error?.message ?? error) } })
      }
    },
  }

  /**
   * A requirement opens a job: the project is the container, the job is this
   * one delivery. The session that will plan it is bound by the delivery loop,
   * so this route only records the input — the board stays the progress channel.
   */
  const requirementsRoute = {
    kind: 'exact',
    path: REQUIREMENTS_PATH,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      let body = null
      try {
        body = await readJsonBody(request, MAX_UPLOAD_BYTES)
      } catch (error) {
        sendJson(response, 400, { error: { code: 'bad-request', message: String(error?.message ?? error) } })
        return
      }
      let requirement = null
      try {
        requirement = assertRequirement(body)
      } catch (error) {
        if (error instanceof RequirementError) {
          sendJson(response, 400, {
            error: { code: 'invalid-requirement', message: error.message, details: error.issues },
          })
          return
        }
        throw error
      }
      const board = buildBoard(await events.all())
      const project = board.projects.find(item => item.id === requirement.projectId)
      if (project === undefined) {
        sendJson(response, 404, { error: { code: 'project-not-found', message: `unknown project: ${requirement.projectId}` } })
        return
      }
      if (project.status === 'paused' || project.status === 'cancelled') {
        sendJson(response, 409, { error: { code: 'project-stopped', message: `project is ${project.status}` } })
        return
      }
      const now = new Date().toISOString()
      const jobId = `deliveries_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const stored = await storeRequirement(config.dataDir, jobId, requirement)
      const brief = requirement.text.slice(0, 280)
      await events.append(projectEvent({ projectId: project.id, event: 'started', brief, ts: now }))
      await events.append(jobEvent({
        projectId: project.id, jobId, title: requirement.title, brief, event: 'created', ts: now,
      }))
      await events.append(requirementEvent({
        projectId: project.id,
        jobId,
        title: requirement.title,
        text: requirement.text,
        source: requirement.source,
        file: stored.relative,
        ts: now,
      }))
      // The loop plans when a delivery session is bound; a tick here saves the
      // user up to one timer interval.
      loop?.schedule?.()
      sendJson(response, 202, {
        status: 'accepted',
        projectId: project.id,
        jobId,
        requirement: {
          title: requirement.title,
          source: requirement.source,
          chars: requirement.text.length,
          file: stored.relative,
        },
      })
    },
  }

  const pickRoute = {
    kind: 'exact',
    path: PICK_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      const body = await readJsonBody(request).catch(() => ({}))
      const kind = body?.kind === 'directory' ? 'directory' : body?.kind === 'file' ? 'file' : ''
      if (kind === '') {
        sendJson(response, 400, { error: { code: 'bad-request', message: 'kind must be file or directory' } })
        return
      }
      const command = pickScript(kind, body?.prompt)
      if (command === null) {
        sendJson(response, 501, { error: { code: 'unsupported', message: 'no native picker on this platform' } })
        return
      }
      const viaElectron = await electronPick(kind, body?.prompt)
      if (viaElectron !== null) {
        sendJson(response, 200, viaElectron)
        return
      }
      try {
        const result = await runPick(command)
        // A cancelled dialog is not an error: the panel just keeps its input.
        if (result.code !== 0) {
          // Distinguish "user closed it" from "the OS refused the dialog":
          // -128 is AppleScript's user-cancel code.
          if (result.stderr !== '' && result.stderr.includes('-128') === false) {
            sendJson(response, 500, { error: { code: 'picker-failed', message: result.stderr.slice(0, 400) } })
            return
          }
          sendJson(response, 200, { cancelled: true, path: null })
          return
        }
        const path = result.stdout.split('\n').filter(Boolean).pop() ?? ''
        if (path === '') {
          sendJson(response, 200, { cancelled: true, path: null })
          return
        }
        sendJson(response, 200, { path })
      } catch (error) {
        sendJson(response, 500, { error: { code: 'picker-failed', message: String(error?.message ?? error) } })
      }
    },
  }


  /** Native organization section of the panel: same tables the app owns. */



  /** Native organization section of the panel: same tables the app owns. */

  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => {
      const webServer = webCtx.get('webServer')
      if (!webServer || typeof webServer.register !== 'function') {
        return () => {}
      }
      // The fence goes on every route: a handler that skips it would be the
      // one endpoint a tunneled or cross-origin request could reach.
      const fencedRoute = candidate => ({
        ...candidate,
        handler: (request, response) => {
          if (connectionDenied(ctx, request)) {
            sendJson(response, 403, {
              error: { code: 'untrusted-connection', message: 'request rejected by the host connection policy' },
            })
            return
          }
          return candidate.handler(request, response)
        },
      })
      const register = candidate => webServer.register(fencedRoute(candidate))
      const disposers = [
        register(route),
        register(startRoute),
        register(projectsRoute),
        register(controlRoute),
        register(decideRoute),
        register(requirementsRoute),
        register(configRoute),
        register(employeesRoute),
        register(servicesRoute),
        register(orgRoute),
        register(pickRoute),
        register(browseRoute),
        register(jobConfigRoute),
        register(financeRoute),
        register(taskRoute),
      ]
      return () => {
        disposeAll()
        for (const dispose of disposers) {
          try {
            dispose?.()
          } catch {
            /* already withdrawn */
          }
        }
      }
    }, 'workbench: state route')
  })

  // The loop is event-driven: tool results, subagent endings and agent status
  // changes schedule a tick; a slow timer is only the safety net.
  loop = createDispatcher({ ctx, config, events, sessions: sessionBridge })
  // Attach only where the host exposes event subscriptions: a headless or test
  // context keeps the tools and routes, and simply never auto-drives.
  if (typeof ctx.on === 'function') {
    ctx.effect(() => loop.attach())
  }

  // One tool so the agent can drive delivery from an ordinary conversation,
  // which is how a non-technical owner will actually reach it.
  //
  // `output` is not optional: without it `ctx.tools.register` throws and the
  // whole plugin fails to activate — which is exactly why this plugin never
  // came up between its install and today.
  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_plan_software',
      description:
        'Legacy host-side planner: plan a small software system from a plain-language requirement '
        + 'and write roles/design/task artefacts. For a job opened by the Workbench requirement '
        + 'intake, use workbench_submit_plan instead — that is the closed-loop path. This tool is '
        + 'the fallback when no delivery session can plan.',
      parameters: {
        type: 'object',
        properties: {
          requirement: {
            type: 'string',
            description: 'What the user wants, in their own words, including who will use it.',
          },
          projectId: {
            type: 'string',
            description: 'Attach this plan to an existing board card (its project id). Omit to open a new project.',
          },
          jobId: {
            type: 'string',
            description: 'Continue a specific job (planning run) on that card. Omit to open a new job.',
          },
        },
        required: ['requirement'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const brief = String(input.requirement ?? '').trim()
        if (!brief) throw new Error('requirement must not be empty')
        const attachTo = typeof input?.projectId === 'string' ? input.projectId.trim() : ''
        const jobId = typeof input?.jobId === 'string' ? input.jobId.trim() : ''
        const result = await delivery.run({
          brief,
          ...(attachTo === '' ? {} : { projectId: attachTo }),
          ...(jobId === '' ? {} : { jobId }),
          ...(typeof input?.parentJobId === 'string' && input.parentJobId !== '' ? { parentJobId: input.parentJobId } : {}),
          ...(typeof input?.kind === 'string' && input.kind !== '' ? { kind: input.kind } : {}),
        })
        return [
          `Planned: ${brief}`,
          `Roles: ${result.roles?.roles?.length ?? 0}`,
          `Work items: ${result.design?.workItems?.length ?? 0}`,
          `Artefacts: ${result.artifactDir ?? config.dataDir}`,
        ].join('\n')
      },
    }),
  )

  // The main agent owns understanding; this tool owns the shape of a plan. One
  // validated graph per job, written as ledger lines, so the dispatcher and the
  // board read the same truth. A rejected plan reports every issue at once.
  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_submit_plan',
      description:
        'Submit the work graph for a job after understanding the requirement with the relevant '
        + 'skills. One plan per job: a DAG of work items (title, owner, stage, blockedBy) that the '
        + 'board dispatches. A rejected plan returns every issue at once: fix them and resubmit. '
        + 'Use workbench_report_work for progress; this tool is planning only.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The job this plan delivers (required).' },
          projectId: { type: 'string', description: 'Project id; derived from the job when omitted.' },
          brief: { type: 'string', description: 'One-paragraph restatement of the requirement.' },
          roles: { type: 'array', items: { type: 'object' }, description: 'Optional role/permission matrix.' },
          design: { type: 'object', description: 'Optional data model and API surface.' },
          tasks: {
            type: 'array',
            description: 'Work items; ids are local and referenced by blockedBy/parentId.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Local id, unique inside this plan.' },
                title: { type: 'string' },
                owner: { type: 'string', enum: ['backend', 'frontend', 'qa', 'workbench'] },
                stage: { type: 'string', enum: ['brief', 'roles', 'design', 'build', 'verify', 'report'] },
                parentId: { type: 'string', description: 'Another task id; defaults to the build card.' },
                blockedBy: { type: 'array', items: { type: 'string' } },
                instructions: { type: 'string' },
                acceptance: { type: 'string' },
                skill: { type: 'string', description: 'Suggested skill for the executor, if known.' },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['jobId', 'tasks'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const jobId = String(input?.jobId ?? '').trim()
        if (jobId === '') throw new PlanError(['jobId is required'])
        const board = buildBoard(await events.all())
        let project = null
        let job = null
        for (const candidate of board.projects) {
          const found = (candidate.jobs || []).find(item => item.id === jobId)
          if (found !== undefined) {
            project = candidate
            job = found
            break
          }
        }
        if (job === null) throw new Error(`unknown job: ${jobId}`)
        // A plan is immutable once written: a change request is a new job, so
        // the old job's completion stays a historical fact.
        if (job.roots.length > 0 || job.planBy !== null) {
          throw new Error(`job ${jobId} already has a plan; open a new job for a change request`)
        }
        const plan = assertPlan({ ...input, jobId, projectId: project.id })
        const now = new Date().toISOString()
        const dir = join(config.dataDir, 'deliveries', jobId)
        const files = []
        if (plan.roles.length > 0 || plan.design !== null) {
          await mkdir(dir, { recursive: true })
          if (plan.roles.length > 0) {
            const path = join(dir, 'roles.json')
            await writeFile(path, `${JSON.stringify({ roles: plan.roles }, null, 2)}\n`, 'utf8')
            files.push(path)
          }
          if (plan.design !== null) {
            const path = join(dir, 'design.json')
            await writeFile(path, `${JSON.stringify(plan.design, null, 2)}\n`, 'utf8')
            files.push(path)
          }
        }
        for (const line of planEvents(plan, { now })) await events.append(line)
        const container = buildCardId(jobId)
        for (const path of files) await events.append(artifactEvent({ taskId: container, path }))
        loop?.schedule?.()
        return JSON.stringify({
          jobId,
          projectId: project.id,
          tasks: plan.tasks.length,
          planBy: 'agent',
          files,
          nextStep: 'call workbench_next_work to start dispatching ready work',
        })
      },
    }),
  )

  /**
   * Skill discovery. The session catalog is checked first (free to use), the
   * plugin market second (install first, a person approves). Lookups are logged
   * as `skill` lines so the `which_skill` decision can learn from history.
   */
  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_find_skill',
      description:
        'Find a skill for the work you are about to do. Searches the current session\'s skill '
        + 'catalog first and, when nothing matches, the configured plugin market. Use it before '
        + 'starting a task when you are unsure which skill applies; a market hit is not installed '
        + 'yet. Returns candidates with the reason each one matched.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What the work is about, e.g. "database migration" or "报价单 PRD".' },
          taskId: { type: 'string', description: 'Optional work item id; recorded with the lookup.' },
          includeMarket: { type: 'boolean', description: 'Search the plugin market too (default true).' },
        },
        required: ['query'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const query = String(input?.query ?? '').trim()
        if (query === '') throw new Error('query is required')

        const optional = name => {
          try {
            return typeof ctx.get === 'function' ? ctx.get(name) : undefined
          } catch {
            return undefined
          }
        }

        let session = []
        const skillsService = optional('skills')
        if (skillsService && typeof skillsService.list === 'function') {
          try {
            session = rankSkills(await skillsService.list({}), query)
          } catch {
            session = []
          }
        }

        const market = []
        const marketErrors = []
        if (input?.includeMarket !== false) {
          const marketService = optional('pluginMarket')
          if (marketService && typeof marketService.search === 'function') {
            let indexes = []
            try {
              indexes = typeof marketService.listIndexes === 'function' ? marketService.listIndexes() : []
            } catch (error) {
              marketErrors.push({ index: 'listIndexes', error: String(error?.message ?? error) })
            }
            for (const index of (Array.isArray(indexes) ? indexes : []).slice(0, SKILL_LIMITS.maxIndexes)) {
              if (typeof index?.url !== 'string' || index.url === '' || typeof index.error === 'string') continue
              try {
                const page = await marketService.search(index.url, {
                  text: query,
                  sort: { kind: 'relevance' },
                  offset: 0,
                  limit: SKILL_LIMITS.maxMarketEntries,
                })
                const entries = marketCandidates(page?.entries ?? [])
                if (entries.length > 0) {
                  market.push({ index: typeof index.title === 'string' ? index.title : index.url, entries })
                }
              } catch (error) {
                marketErrors.push({ index: index.url, error: String(error?.message ?? error) })
              }
            }
          }
        }

        const taskId = String(input?.taskId ?? '').trim()
        if (taskId !== '') {
          try {
            await events.append({
              kind: 'skill',
              taskId,
              query,
              session: session.map(item => item.name),
              market: market.flatMap(entry => entry.entries.map(item => item.name)),
              ts: new Date().toISOString(),
            })
          } catch {
            /* the lookup must not fail because its audit line could not be written */
          }
        }
        return formatSkillResult({ query, session, market, marketErrors })
      },
    }),
  )

  /**
   * Delivery-session diagnostics. The closed loop crosses three host seams
   * (session creation, preset composition, model selection); when a turn dies
   * in prompt assembly this tool reports which seam failed instead of guessing.
   */
  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_delivery_diagnostics',
      description:
        'Diagnose the delivery session wiring for a project/job: which host services are mounted, '
        + 'the resolved agent preset, the selected model, and the error from preparing the session. '
        + 'Read-only; safe to call when a closed-loop job is stuck before its first plan.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id; defaults to the only project when unambiguous.' },
          jobId: { type: 'string', description: 'Job id; defaults to the project\'s newest job.' },
          sessionId: { type: 'string', description: 'Explicit delivery session id.' },
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const board = buildBoard(await events.all())
        let project = null
        let job = null
        if (typeof input?.jobId === 'string' && input.jobId !== '') {
          for (const candidate of board.projects) {
            const found = (candidate.jobs || []).find(item => item.id === input.jobId)
            if (found !== undefined) {
              project = candidate
              job = found
              break
            }
          }
        } else if (typeof input?.projectId === 'string' && input.projectId !== '') {
          project = board.projects.find(item => item.id === input.projectId) ?? null
          job = project?.jobs?.[0] ?? null
        }
        const sessionId = String(input?.sessionId ?? job?.sessionId ?? project?.sessionId ?? '')
        const preparation = sessionId === ''
          ? { error: 'no delivery session bound yet' }
          : await sessionBridge.prepare(sessionId)
        return JSON.stringify({
          projectId: project?.id ?? null,
          jobId: job?.id ?? null,
          sessionId: sessionId === '' ? null : sessionId,
          job: job === null ? null : {
            status: job.status,
            planBy: job.planBy,
            hasRequirement: job.requirement !== null && job.requirement !== undefined,
          },
          preparation,
        }, null, 2)
      },
    }),
  )

  // ── the executor's two halves ────────────────────────────────────────────
  //
  // A plugin cannot spawn agents (that seam needs a parent Agent), so the plan
  // is split in two: hand the calling agent ready work with a complete prompt,
  // then accept its report and write the ledger lines yourself. The board only
  // moves because a line was written, which is what keeps it honest.

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_next_work',
      description:
        'List the project work items that are ready to start now, each with a complete prompt for '
        + 'a child agent. Use this to drive a planned project: call it, spawn one subagent per item '
        + 'with the returned prompt, then report each child result with workbench_report_work. '
        + 'Readiness comes from the dependency graph, so never start an item it did not return.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id; defaults to the most recent project.' },
          jobId: { type: 'string', description: 'Task (job) id; only its queue is considered.' },
          limit: { type: 'integer', description: 'How many items to return (default 3).' },
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const board = buildBoard(await events.all())
        // A project planned before the artefact directory was recorded still
        // gets a usable prompt: the path is derivable from the project id.
        for (const item of board.projects) {
          if (!item.artifactDir) item.artifactDir = join(config.dataDir, 'deliveries', item.id)
        }
        const limit = Number.isInteger(Number(input?.limit)) ? Number(input.limit) : 3
        const { project, work, stopped } = readyWork(board, {
          projectId: typeof input?.projectId === 'string' && input.projectId !== '' ? input.projectId : null,
          jobId: typeof input?.jobId === 'string' && input.jobId !== '' ? input.jobId : null,
          limit,
        })
        if (project === null) throw new Error('no project yet — plan one with workbench_plan_software first')
        if (work.length === 0) {
          return JSON.stringify({
            projectId: project.id,
            project: project.title,
            work: [],
            note: stopped
              ? `the queue is ${stopped}: resume it before asking for work`
              : 'nothing is ready: every work item is done, or waiting on a dependency or a person',
            ...(stopped ? { stopped } : {}),
          })
        }
        return JSON.stringify({
          projectId: project.id,
          project: project.title,
          work,
          howToReport:
            'Spawn one subagent per item with its prompt, wait for the child, then call '
            + 'workbench_report_work with the child report. Report tests honestly: an item whose '
            + 'tests did not pass is not done.',
        }, null, 2)
      },
    }),
  )

  // Work discovered while implementing has to be able to enter the board, or
  // the plan becomes a lie the moment reality diverges from it.
  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_add_task',
      description:
        'Add a task card to a project for work discovered during implementation that the plan did '
        + 'not describe (a missing layer, an integration seam, a bug). The card joins the same '
        + 'dependency graph, so it blocks and unblocks like any planned item.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short imperative title.' },
          projectId: { type: 'string', description: 'Project id; defaults to the most recent project.' },
          owner: { type: 'string', description: 'Agent that owns it: backend, frontend, qa, or workbench.' },
          role: { type: 'string', description: 'Human-readable role label.' },
          stage: { type: 'string', description: 'Pipeline stage: brief, roles, design, build, verify, report.' },
          jobId: { type: 'string', description: 'Job the task belongs to; defaults to the project id.' },
          instructions: { type: 'string', description: 'What to build, stated for a child agent.' },
          blockedBy: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task ids that must finish first.',
          },
        },
        required: ['title'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const title = String(input?.title ?? '').trim()
        if (!title) throw new Error('title is required')
        const board = buildBoard(await events.all())
        const project = typeof input?.projectId === 'string' && input.projectId !== ''
          ? board.projects.find(item => item.id === input.projectId)
          : board.projects[0]
        if (project === undefined) throw new Error('no project yet — plan one first')

        const existing = new Set()
        const walk = tasks => {
          for (const task of Array.isArray(tasks) ? tasks : []) {
            existing.add(task.id)
            walk(task.children)
          }
        }
        walk(project.roots)
        let counter = 1
        while (existing.has(`${project.id}:discovered:${counter}`)) counter += 1
        const taskId = `${project.id}:discovered:${counter}`

        await events.append(taskEvent({
          event: 'created',
          taskId,
          projectId: project.id,
          jobId: typeof input?.jobId === 'string' && input.jobId !== '' ? input.jobId : project.id,
          stage: typeof input?.stage === 'string' && input.stage !== '' ? input.stage : 'build',
          owner: typeof input?.owner === 'string' && input.owner !== '' ? input.owner : 'workbench',
          role: typeof input?.role === 'string' && input.role !== '' ? input.role : null,
          title,
          instructions: typeof input?.instructions === 'string' ? input.instructions : null,
          blockedBy: Array.isArray(input?.blockedBy) ? input.blockedBy : [],
          discovered: true,
        }))
        return JSON.stringify({ taskId, projectId: project.id, title })
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_report_work',
      description:
        'Record the result of one work item after a child agent finished it. Appends the task '
        + 'transition, the produced files, and the decisions the child made to the project ledger. '
        + 'A report of done without green tests is recorded as blocked and lands on a person.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The taskId returned by workbench_next_work.' },
          event: {
            type: 'string',
            enum: ['progress', 'done', 'failed', 'blocked'],
            description: 'What happened to the card.',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files the child actually changed, as workspace-relative paths.',
          },
          exitCode: { type: 'integer', description: 'Exit code of the test command the child ran.' },
          testsPassed: { type: 'integer', description: 'Number of passing tests.' },
          testsFailed: { type: 'integer', description: 'Number of failing tests.' },
          linesChanged: { type: 'integer', description: 'Approximate changed line count, for diff risk.' },
          notes: { type: 'string', description: 'One or two sentences from the child.' },
        },
        required: ['taskId', 'event'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const taskId = String(input?.taskId ?? '')
        if (!taskId) throw new Error('taskId is required')
        const before = await events.all()
        const { tasks } = foldTasks(before)
        const task = tasks.get(taskId)
        if (task === undefined) throw new Error(`unknown task: ${taskId}`)
        const project = buildBoard(before).projects.find(item => item.id === task.projectId)
          ?? { id: task.projectId, artifactDir: null }

        const lines = reportEvents({
          task,
          project,
          report: {
            event: String(input?.event ?? 'progress'),
            files: Array.isArray(input?.files) ? input.files : [],
            linesChanged: Number(input?.linesChanged) || 0,
            notes: String(input?.notes ?? ''),
            tests: {
              exitCode: Number(input?.exitCode ?? 0),
              passed: Number(input?.testsPassed ?? 0),
              failed: Number(input?.testsFailed ?? 0),
            },
            ts: new Date().toISOString(),
          },
        })
        for (const line of lines) await events.append(line)
        loop?.schedule?.()

        const after = buildBoard(await events.all())
        const remaining = readyWork(after, { projectId: project.id, limit: 99 }).work.length
        return JSON.stringify({
          taskId,
          recorded: lines[0].event,
          lines: lines.length,
          readyAfter: remaining,
        })
      },
    }),
  )
}
