/**
 * The project board: an org chart plus task tree, folded out of the same
 * append-only log the decision panel reads.
 *
 * The board is not a second database. Every card it draws comes from one line
 * in `events.jsonl`, which keeps the rule the design doc already states: the
 * panel is a projection, so a host restart shows *less* instead of lying.
 *
 * The log carries four kinds of line:
 *
 *   kind=project   a project was opened, renamed or finished
 *   kind=task      one task changed state (`created` … `done` / `failed`)
 *   kind=decision  a judgement was made (the 10 keys from `router.js`)
 *   kind=artifact  a file was produced by a task
 *   kind=approval  something now waits for a person
 *
 * Why a tree instead of a flat list: a lead agent hands a stage to a
 * specialist, and the specialist splits it again. The `parentId` field is that
 * split, and `blockedBy` is the *waiting* edge — "frontend waits for the API"
 * is data, not something inferred from timestamps.
 *
 * Everything here is pure: tests feed fixtures, the host feeds the live log.
 */
import { isDecision } from './events.js'

/** Pipeline stages, in the order a project runs them. */
export const STAGE_ORDER = ['brief', 'roles', 'design', 'build', 'verify', 'report']

/** Task life-cycle transitions a task line may carry. */
export const TASK_EVENTS = [
  'created', 'assigned', 'claimed', 'progress', 'blocked', 'unblocked', 'done', 'failed', 'reopened',
  // Records which continuable subagent session is carrying the card, so pause
  // and resume can address the exact child instead of respawning it.
  'child',
]

/** Where each transition leaves the task. */
const STATUS_BY_EVENT = {
  created: 'todo',
  assigned: 'active',
  claimed: 'active',
  progress: 'active',
  blocked: 'blocked',
  unblocked: 'active',
  done: 'done',
  failed: 'failed',
  reopened: 'active',
}

const round = value => Math.round(value * 10000) / 10000

/**
 * Builds one project line: the identity the board's header renders. One line
 * is enough; it is repeated only when the title or status changes.
 */
/**
 * One job: a single requirement/planning run inside a project.
 *
 * A project is a container (公司管理); a job is one thing done inside it
 * (员工管理). The cockpit belongs to the job, so a project holds many.
 */
export function jobEvent(input = {}) {
  const { projectId, jobId } = input
  const event = input.event ?? 'created'
  if (typeof projectId !== 'string' || projectId === '') throw new Error('a job event needs a projectId')
  if (typeof jobId !== 'string' || jobId === '') throw new Error('a job event needs a jobId')
  if (!['created', 'started', 'done', 'failed', 'paused', 'resumed', 'cancelled', 'deleted', 'config', 'preview-stopped'].includes(event)) {
    throw new Error(`unknown job event: ${event}`)
  }
  return { ...input, kind: 'job', event }
}

/**
 * One plan line: the main agent (or the fallback planner) submitted the work
 * graph for a job. The cards themselves are separate `task` lines.
 */
export function planEvent(input = {}) {
  const { projectId, jobId } = input
  if (typeof projectId !== 'string' || projectId === '') throw new Error('a plan event needs a projectId')
  if (typeof jobId !== 'string' || jobId === '') throw new Error('a plan event needs a jobId')
  const event = input.event ?? 'submitted'
  if (event !== 'submitted') throw new Error(`unknown plan event: ${event}`)
  return { ...input, kind: 'plan', event }
}

/** One requirement line: the input the job exists to deliver. */
export function requirementEvent(input = {}) {
  const { projectId, jobId } = input
  if (typeof projectId !== 'string' || projectId === '') throw new Error('a requirement event needs a projectId')
  if (typeof jobId !== 'string' || jobId === '') throw new Error('a requirement event needs a jobId')
  if (typeof input.text !== 'string' || input.text.trim() === '') throw new Error('a requirement event needs text')
  const event = input.event ?? 'submitted'
  if (event !== 'submitted') throw new Error(`unknown requirement event: ${event}`)
  return { ...input, kind: 'requirement', event }
}

export function projectEvent(input = {}) {
  const { projectId } = input
  const event = input.event ?? 'created'
  if (typeof projectId !== 'string' || projectId === '') throw new Error('a project event needs a projectId')
  if (!['created', 'started', 'done', 'failed', 'paused', 'resumed', 'cancelled', 'deleted', 'config', 'preview-stopped'].includes(event)) {
    throw new Error(`unknown project event: ${event}`)
  }
  return { ...input, kind: 'project', event }
}

/**
 * Builds one task line. Validating at write time means a typo in the
 * orchestrator fails loudly instead of producing a card nobody can see.
 */
export function taskEvent(input = {}) {
  const { event, taskId } = input
  if (!TASK_EVENTS.includes(event)) throw new Error(`unknown task event: ${String(event)}`)
  if (typeof taskId !== 'string' || taskId === '') throw new Error('a task event needs a taskId')
  return { ...input, kind: 'task', event }
}

/** Builds one artefact line: a file a task produced. */
export function artifactEvent(input = {}) {
  const { taskId, path } = input
  if (typeof taskId !== 'string' || taskId === '') throw new Error('an artefact event needs a taskId')
  if (typeof path !== 'string' || path === '') throw new Error('an artefact event needs a path')
  return { ...input, kind: 'artifact' }
}

/** Builds one approval line: a gate a person has to open. */
export function approvalEvent(input = {}) {
  const { taskId, action } = input
  const status = input.status ?? 'requested'
  if (typeof taskId !== 'string' || taskId === '') throw new Error('an approval event needs a taskId')
  if (typeof action !== 'string' || action === '') throw new Error('an approval event needs an action')
  if (!['requested', 'approved', 'rejected'].includes(status)) {
    throw new Error(`unknown approval status: ${status}`)
  }
  return { ...input, kind: 'approval', status }
}

function blankTask(id, seed = {}) {
  return {
    id,
    title: seed.title ?? id,
    parentId: seed.parentId ?? null,
    projectId: seed.projectId ?? null,
    jobId: seed.jobId ?? null,
    stage: seed.stage ?? null,
    owner: seed.owner ?? null,
    role: seed.role ?? null,
    instructions: seed.instructions ?? null,
    discovered: seed.discovered === true,
    status: 'todo',
    blockedBy: [],
    openBlockers: [],
    artifacts: [],
    gates: [],
    children: [],
    decisions: 0,
    waiting: 0,
    costUsd: 0,
    lastNote: null,
    lastActiveAt: null,
    startedAt: null,
    claimedAt: null,
    childSessionId: null,
    createdAt: seed.ts ?? null,
    updatedAt: seed.ts ?? null,
    seq: Number.isInteger(seed.seq) ? seed.seq : null,
    finishedAt: null,
  }
}

function ensureTask(tasks, id, seed) {
  let node = tasks.get(id)
  if (node === undefined) {
    node = blankTask(id, seed)
    tasks.set(id, node)
  }
  return node
}

/** Descriptive fields: a later line refines them, and never blanks them. */
const DESCRIPTIVE = ['title', 'parentId', 'projectId', 'jobId', 'stage', 'owner', 'role', 'instructions', 'acceptance', 'skill', 'discovered', 'childSessionId']

/**
 * Log order, not clock order. Appends within one run share a millisecond, so
 * timestamps cannot separate "roles before design" — the sequence number can.
 * Falls back to the id only when the line never went through the log.
 */
const byCreated = (a, b) => {
  const seqA = Number.isInteger(a.seq) ? a.seq : Number.MAX_SAFE_INTEGER
  const seqB = Number.isInteger(b.seq) ? b.seq : Number.MAX_SAFE_INTEGER
  if (seqA !== seqB) return seqA - seqB
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id)
}

/**
 * Folds the log into task nodes plus the approval requests that are still
 * open. Parents and blockers are resolved after the fold, because a task may
 * name a parent that only appears later in the file.
 */
export function foldTasks(events) {
  const tasks = new Map()
  const approvals = []
  const projects = new Map()
  const jobs = new Map()
  // Projects a person deleted from the board. The ledger keeps their history,
  // but every projection stops showing them from the deletion event onwards.
  const deletedProjects = new Set()
  const list = Array.isArray(events) ? events : []

  for (const event of list) {
    if (event === null || typeof event !== 'object') continue
    const kind = event.kind ?? 'decision'

    if (kind === 'plan') {
      if (typeof event.jobId !== 'string' || event.jobId === '') continue
      let job = jobs.get(event.jobId)
      if (job === undefined) {
        // A plan line is enough to open a minimal job entry; the job's own
        // created event normally comes first.
        job = {
          id: event.jobId,
          projectId: event.projectId ?? null,
          title: null,
          brief: null,
          workspace: null,
          workspaceId: null,
          sessionId: null,
          parentJobId: null,
          kind: null,
          status: 'created',
          planBy: null,
          planAt: null,
          requirement: null,
          tokens: null,
          costUsd: 0,
          createdAt: null,
          updatedAt: null,
        }
        jobs.set(event.jobId, job)
      }
      job.planBy = typeof event.by === 'string' && event.by !== '' ? event.by : 'agent'
      job.planAt = event.ts ?? job.planAt
      if (job.brief === null && typeof event.brief === 'string' && event.brief !== '') job.brief = event.brief
      job.updatedAt = event.ts ?? job.updatedAt
      continue
    }

    if (kind === 'requirement') {
      if (typeof event.jobId !== 'string' || event.jobId === '') continue
      let job = jobs.get(event.jobId)
      if (job === undefined) {
        job = {
          id: event.jobId,
          projectId: event.projectId ?? null,
          title: null,
          brief: null,
          workspace: null,
          workspaceId: null,
          sessionId: null,
          parentJobId: null,
          kind: null,
          status: 'created',
          planBy: null,
          planAt: null,
          requirement: null,
          tokens: null,
          costUsd: 0,
          createdAt: null,
          updatedAt: null,
        }
        jobs.set(event.jobId, job)
      }
      job.requirement = {
        text: typeof event.text === 'string' ? event.text : '',
        file: typeof event.file === 'string' && event.file !== '' ? event.file : null,
        source: typeof event.source === 'string' ? event.source : 'text',
        title: typeof event.title === 'string' ? event.title : null,
        ts: event.ts ?? null,
      }
      if (job.brief === null && typeof event.title === 'string' && event.title !== '') job.brief = event.title
      job.updatedAt = event.ts ?? job.updatedAt
      continue
    }

    if (kind === 'usage') {
      if (typeof event.jobId !== 'string' || event.jobId === '') continue
      let job = jobs.get(event.jobId)
      if (job === undefined) {
        job = {
          id: event.jobId,
          projectId: event.projectId ?? null,
          title: null,
          brief: null,
          workspace: null,
          workspaceId: null,
          sessionId: null,
          parentJobId: null,
          kind: null,
          status: 'created',
          planBy: null,
          planAt: null,
          requirement: null,
          tokens: null,
          costUsd: 0,
          createdAt: null,
          updatedAt: null,
        }
        jobs.set(event.jobId, job)
      }
      // Totals are absolute, so a replayed line is idempotent.
      job.tokens = {
        inputTokens: Number(event.inputTokens) || 0,
        outputTokens: Number(event.outputTokens) || 0,
      }
      job.costUsd = Number(event.costUsd) || 0
      job.updatedAt = event.ts ?? job.updatedAt
      continue
    }

    if (kind === 'job') {
      if (typeof event.jobId !== 'string' || event.jobId === '') continue
      let job = jobs.get(event.jobId)
      if (job === undefined) {
        job = {
          id: event.jobId,
          projectId: event.projectId ?? null,
          title: null,
          brief: null,
          workspace: null,
          workspaceId: null,
          sessionId: null,
          parentJobId: null,
          kind: null,
          status: 'created',
          planBy: null,
          planAt: null,
          requirement: null,
          tokens: null,
          costUsd: 0,
          createdAt: null,
          updatedAt: null,
        }
        jobs.set(event.jobId, job)
      }
      if (typeof event.title === 'string' && event.title !== '') job.title = event.title
      if (typeof event.brief === 'string' && event.brief !== '') job.brief = event.brief
      if (typeof event.parentJobId === 'string' && event.parentJobId !== '') job.parentJobId = event.parentJobId
      if (typeof event.jobKind === 'string' && event.jobKind !== '') job.kind = event.jobKind
      if (typeof event.workspace === 'string' && event.workspace !== '') job.workspace = event.workspace
      if (typeof event.workspaceId === 'string' && event.workspaceId !== '') job.workspaceId = event.workspaceId
      if (event.workspaceId === null) job.workspaceId = null
      if (typeof event.sessionId === 'string' && event.sessionId !== '') job.sessionId = event.sessionId
      if (event.sessionId === null) job.sessionId = null
      if (typeof event.projectId === 'string' && event.projectId !== '') job.projectId = event.projectId
      if (event.event !== 'config') job.status = event.event === 'resumed' ? 'started' : event.event
      job.createdAt ??= event.ts ?? null
      job.updatedAt = event.ts ?? job.updatedAt
      continue
    }

    if (kind === 'project') {
      if (typeof event.projectId !== 'string' || event.projectId === '') continue
      if (event.event === 'deleted') {
        deletedProjects.add(event.projectId)
        projects.delete(event.projectId)
        continue
      }
      // A later `created` line restores a card a person deleted earlier: the
      // ledger keeps the history, so the card comes back with it.
      if (event.event === 'created') deletedProjects.delete(event.projectId)
      let project = projects.get(event.projectId)
      if (project === undefined) {
        project = {
          id: event.projectId,
          title: null,
          brief: null,
          artifactDir: null,
          workspace: null,
          workspaceId: null,
          sessionId: null,
          projectKind: null,
          profile: null,
          status: 'created',
          createdAt: null,
          updatedAt: null,
        }
        projects.set(event.projectId, project)
      }
      if (typeof event.title === 'string' && event.title !== '') project.title = event.title
      if (typeof event.brief === 'string' && event.brief !== '') project.brief = event.brief
      if (typeof event.artifactDir === 'string' && event.artifactDir !== '') project.artifactDir = event.artifactDir
      if (typeof event.projectKind === 'string' && event.projectKind !== '') project.projectKind = event.projectKind
      if (event.profile !== null && typeof event.profile === 'object' && !Array.isArray(event.profile)) {
        project.profile = { ...event.profile }
      }
      if (typeof event.workspace === 'string' && event.workspace !== '') project.workspace = event.workspace
      if (typeof event.workspaceId === 'string' && event.workspaceId !== '') project.workspaceId = event.workspaceId
      if (event.workspaceId === null) project.workspaceId = null
      if (typeof event.sessionId === 'string' && event.sessionId !== '') project.sessionId = event.sessionId
      if (event.sessionId === null) project.sessionId = null
      if (event.event === 'preview-stopped') project.previewUrl = null
      else if (typeof event.previewUrl === 'string' && event.previewUrl !== '') project.previewUrl = event.previewUrl
      if (['created', 'started', 'done', 'failed', 'paused', 'resumed', 'cancelled'].includes(event.event)) {
        // 'resumed' means "running again", so the stored status is 'started'.
        project.status = event.event === 'resumed' ? 'started' : event.event
      }
      project.createdAt ??= event.ts ?? null
      project.updatedAt = event.ts ?? project.updatedAt
      continue
    }

    if (kind === 'task') {
      if (typeof event.taskId !== 'string' || event.taskId === '') continue
      const node = ensureTask(tasks, event.taskId, event)
      for (const key of DESCRIPTIVE) {
        const value = event[key]
        if (value !== undefined && value !== null && value !== '') node[key] = value
      }
      if (Array.isArray(event.blockedBy)) {
        node.blockedBy = [...new Set(
          event.blockedBy.filter(id => typeof id === 'string' && id !== event.taskId),
        )]
      }
      const status = STATUS_BY_EVENT[event.event] ?? (typeof event.status === 'string' ? event.status : null)
      if (status !== null) node.status = status
      if (Number.isFinite(Number(event.costUsd))) node.costUsd = round(node.costUsd + Number(event.costUsd))
      // What the agent says it is doing, and when it said it: this is the only
      // "in progress" signal the panel can show while work is still running.
      if (typeof event.notes === 'string' && event.notes.trim() !== '') node.lastNote = event.notes.trim()
      if (event.event === 'claimed' || event.event === 'progress') {
        node.startedAt ??= event.ts ?? null
        node.lastActiveAt = event.ts ?? node.lastActiveAt
      }
      // A claim is a lease: it says a child is carrying this card right now.
      // Without the timestamp a host restart orphans the card as "active"
      // forever (nothing can hand it out again), and without expiry a busy
      // loop asks the agent to spawn the same card over and over.
      if (event.event === 'claimed') node.claimedAt = event.ts ?? null
      if (['done', 'failed', 'blocked', 'reopened'].includes(event.event)) node.claimedAt = null
      node.createdAt ??= event.ts ?? null
      node.updatedAt = event.ts ?? node.updatedAt
      if (node.seq === null && Number.isInteger(event.seq)) node.seq = event.seq
      if (event.event === 'done') node.finishedAt = event.ts ?? null
      if (event.event === 'reopened') node.finishedAt = null
      continue
    }

    if (kind === 'artifact') {
      if (typeof event.taskId !== 'string' || event.taskId === '') continue
      const node = ensureTask(tasks, event.taskId, event)
      if (typeof event.path === 'string' && event.path !== '' && !node.artifacts.includes(event.path)) {
        node.artifacts.push(event.path)
      }
      node.updatedAt = event.ts ?? node.updatedAt
      continue
    }

    if (kind === 'approval') {
      if (typeof event.taskId !== 'string' || event.taskId === '') continue
      const node = ensureTask(tasks, event.taskId, event)
      const gate = {
        kind: 'approval',
        id: event.id ?? null,
        taskId: event.taskId,
        action: event.action ?? null,
        status: event.status ?? 'requested',
        // Only an approval blocks the queue. Advisory decisions (low confidence)
        // are review material: they must never freeze a card.
        blocking: true,
        irreversible: event.irreversible === true,
        ts: event.ts ?? null,
      }
      approvals.push(gate)
      node.gates.push(gate)
      node.updatedAt = event.ts ?? node.updatedAt
      continue
    }

    if (isDecision(event) && typeof event.taskId === 'string' && event.taskId !== '') {
      const node = ensureTask(tasks, event.taskId, event)
      node.decisions += 1
      if (Number.isFinite(Number(event.costUsd))) node.costUsd = round(node.costUsd + Number(event.costUsd))
      if (event.lane === 'human' && event.status === 'waiting') {
        node.waiting += 1
        node.gates.push({
          kind: 'decision',
          id: event.id ?? null,
          taskId: node.id,
          action: event.action ?? null,
          status: 'requested',
          blocking: false,
          irreversible: event.irreversible === true,
          ts: event.ts ?? null,
          decision: event.decision ?? null,
          value: event.value ?? null,
          // What the person actually has to answer. Without it the gate reads
          // "要不要问人" — true, but useless when it is 2am and the run is stuck.
          questions: Array.isArray(event.evidence?.questions)
            ? event.evidence.questions.filter(question => typeof question === 'string')
            : [],
        })
      }
      node.updatedAt = event.ts ?? node.updatedAt
    }
  }

  // Link the tree, then resolve whether each dependency is still open.
  for (const node of tasks.values()) {
    const parent = node.parentId === null ? undefined : tasks.get(node.parentId)
    if (parent !== undefined) parent.children.push(node)
  }
  for (const node of tasks.values()) {
    node.children.sort(byCreated)
    node.openBlockers = node.blockedBy.filter(id => {
      const dependency = tasks.get(id)
      // A blocker that never got a line is still a blocker: the edge was
      // declared, so silence is not permission to proceed.
      return dependency === undefined || dependency.status !== 'done'
    })
  }

  const roots = [...tasks.values()].filter(node => {
    return node.parentId === null || !tasks.has(node.parentId)
  }).sort(byCreated)

  return { tasks, approvals, roots, projects, jobs, deletedProjects }
}

/** Injects defaults down the tree so a subtask inherits its parent's identity. */
function propagate(roots) {
  const visit = (node, inherited) => {
    node.projectId = node.projectId ?? inherited.projectId ?? 'unassigned'
    node.jobId = node.jobId ?? inherited.jobId ?? null
    node.stage = node.stage ?? inherited.stage ?? 'work'
    for (const child of node.children) {
      visit(child, { projectId: node.projectId, jobId: node.jobId, stage: node.stage })
    }
  }
  for (const root of roots) visit(root, {})
}

function stageRank(stage) {
  const index = STAGE_ORDER.indexOf(stage)
  return index === -1 ? STAGE_ORDER.length : index
}

function emptyCounts() {
  return { tasks: 0, done: 0, active: 0, blocked: 0, failed: 0, todo: 0, waiting: 0, decisions: 0, costUsd: 0 }
}

/**
 * What the board should show for a task right now.
 *
 * A dependency edge that has not finished makes the task blocked even when its
 * own last line said `active`: the work cannot proceed, and the board must not
 * pretend otherwise just because nobody flipped a status.
 */
function effectiveStatus(node) {
  if (node.status === 'done' || node.status === 'failed') return node.status
  if (node.status === 'blocked' || node.openBlockers.length > 0) return 'blocked'
  return node.status === 'active' ? 'active' : 'todo'
}

function addCounts(target, node) {
  target.tasks += 1
  const status = effectiveStatus(node)
  if (Object.hasOwn(target, status)) target[status] += 1
  target.waiting += node.waiting
  target.decisions += node.decisions
  target.costUsd = round(target.costUsd + node.costUsd)
}

/**
 * Folds the log into one entry per project: stage rails, the task tree, one
 * lane per agent, and the gates waiting on a person.
 *
 * `progress` counts leaves only — a parent is finished when its children are,
 * and counting both would double the denominator and understate the project.
 */
export function buildBoard(events, options = {}) {
  const { tasks, roots, projects: metas, jobs: jobMetas, deletedProjects = new Set() } = foldTasks(events)
  const hiddenProject = id => deletedProjects.has(id)
  propagate(roots)

  /** Aggregate any set of task nodes into the shape one screen renders. */
  function summarizeNodes(nodes) {
    const totals = emptyCounts()
    const stages = new Map()
    const agents = new Map()
    const gates = []
    const artifacts = []
    const scopeIds = new Set(nodes.map(node => node.id))
    let done = 0
    let total = 0

    const latestGate = new Map()
    for (const node of nodes) {
      addCounts(totals, node)
      for (const path of node.artifacts) if (!artifacts.includes(path)) artifacts.push(path)
      for (const gate of node.gates) {
        // A gate is identified by its card + action: a later approve/reject of
        // the same action replaces the request instead of stacking on it, so
        // log order decides the current status.
        latestGate.set(`${gate.taskId}:${gate.action ?? gate.decision ?? gate.id}`, {
          ...gate,
          title: node.title,
          owner: node.owner,
          stage: node.stage,
        })
      }

      let bucket = stages.get(node.stage)
      if (bucket === undefined) {
        bucket = { key: node.stage, order: stageRank(node.stage), tasks: [], counts: emptyCounts() }
        stages.set(node.stage, bucket)
      }
      bucket.tasks.push(node.id)
      addCounts(bucket.counts, node)

      const owner = node.owner ?? 'unassigned'
      let lane = agents.get(owner)
      if (lane === undefined) {
        lane = { owner, role: node.role ?? null, counts: emptyCounts(), gates: 0 }
        agents.set(owner, lane)
      }
      if (node.role !== null) lane.role = node.role
      addCounts(lane.counts, node)
      lane.gates += node.gates.filter(gate => gate.status === 'requested').length

      if (node.children.length === 0) {
        total += 1
        if (node.status === 'done') done += 1
      }
    }

    const running = nodes.filter(node => node.status === 'active')
    const activity = running
      .slice()
      .sort((a, b) => String(b.lastActiveAt ?? '').localeCompare(String(a.lastActiveAt ?? '')))
      .map(node => ({
        taskId: node.id,
        title: node.title,
        owner: node.owner,
        role: node.role,
        note: node.lastNote,
        startedAt: node.startedAt,
        lastActiveAt: node.lastActiveAt,
        status: node.status,
      }))

    const scopedRoots = nodes
      .filter(node => node.parentId === null || scopeIds.has(node.parentId) === false)
      .sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || byCreated(a, b))

    for (const gate of latestGate.values()) {
      if (gate.status === 'requested') gates.push(gate)
    }
    // Stable order: newest gate first, so the most recent objection is on top.
    gates.sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')))
    const finished = total > 0 && done === total
    return {
      running: running.length,
      activity,
      // A delivered scope keeps its decisions as history, but nothing in it is
      // still "waiting on you": otherwise a finished project reads as stuck.
      gates: finished ? [] : gates,
      stages: [...stages.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)),
      agents: [...agents.values()].sort((a, b) => b.counts.tasks - a.counts.tasks),
      artifacts,
      roots: scopedRoots,
      totals,
      progress: { done, total, ratio: total === 0 ? 0 : Math.round((done / total) * 100) / 100 },
    }
  }

  const projects = new Map()
  const projectOf = id => {
    let project = projects.get(id)
    if (project === undefined) {
      const meta = metas.get(id)
      project = {
        id,
        title: meta?.title ?? (id === 'unassigned' ? '未归属任务' : id),
        brief: meta?.brief ?? null,
        artifactDir: meta?.artifactDir ?? null,
        workspace: meta?.workspace ?? null,
        workspaceId: meta?.workspaceId ?? null,
        sessionId: meta?.sessionId ?? null,
        projectKind: meta?.projectKind ?? null,
        profile: meta?.profile ?? null,
        status: meta?.status ?? 'created',
        previewUrl: meta?.previewUrl ?? null,
        createdAt: meta?.createdAt ?? null,
        updatedAt: meta?.updatedAt ?? null,
        jobs: [],
        ...summarizeNodes([]),
      }
      projects.set(id, project)
    }
    return project
  }

  // Meta-only projects still appear (a card opened before any work) — unless
  // a person deleted the project from the board.
  for (const id of metas.keys()) if (!hiddenProject(id)) projectOf(id)

  const nodesByProject = new Map()
  for (const node of tasks.values()) {
    if (hiddenProject(node.projectId)) continue
    const list = nodesByProject.get(node.projectId) ?? []
    list.push(node)
    nodesByProject.set(node.projectId, list)
  }

  /** One job entry per planning run; legacy logs fall into an implicit job. */
  function buildJobs(projectId, nodes) {
    const project = projectOf(projectId)
    const jobIds = new Set()
    for (const node of nodes) jobIds.add(node.jobId ?? projectId)
    for (const jobId of jobMetas.keys()) {
      const meta = jobMetas.get(jobId)
      if (meta?.projectId === projectId && !hiddenProject(projectId)) jobIds.add(jobId)
    }
    if (jobIds.size === 0) return []
    const jobs = []
    for (const jobId of jobIds) {
      const meta = jobMetas.get(jobId)
      const jobNodes = nodes.filter(node => (node.jobId ?? projectId) === jobId)
      const summary = summarizeNodes(jobNodes)
      // Completion is derived, not only announced: planning ends with a job
      // 'done' event, but the work items are executed afterwards, so a job must
      // also read as done when every leaf card is done.
      const explicitStatus = meta?.status ?? (jobId === projectId ? project.status : 'started')
      let status = explicitStatus
      if (explicitStatus !== 'paused' && explicitStatus !== 'cancelled') {
        const finished = summary.progress.total > 0 && summary.progress.done === summary.progress.total
        if (summary.totals.failed > 0) status = 'failed'
        else if (finished) status = 'done'
        // Older logs marked the job done when *planning* finished. If cards are
        // still open, the job is running, not delivered.
        else if (explicitStatus === 'done') status = 'started'
      }
      jobs.push({
        id: jobId,
        projectId,
        // An explicit job is titled by its own event; the implicit (legacy) job
        // takes the project's name, never a random card title.
        title: meta?.title ?? (jobId === projectId ? project.title : (jobNodes[0]?.title ?? jobId)),
        brief: meta?.brief ?? project.brief ?? null,
        workspace: meta?.workspace ?? project.workspace ?? null,
        workspaceId: meta?.workspaceId ?? null,
        sessionId: meta?.sessionId ?? null,
        planBy: meta?.planBy ?? null,
        planAt: meta?.planAt ?? null,
        requirement: meta?.requirement ?? null,
        tokens: meta?.tokens ?? null,
        costUsd: meta?.costUsd ?? 0,
        parentJobId: meta?.parentJobId ?? null,
        kind: meta?.kind ?? null,
        status,
        createdAt: meta?.createdAt ?? summary.roots[0]?.createdAt ?? null,
        updatedAt: meta?.updatedAt ?? null,
        ...summary,
      })
    }
    jobs.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id))
    return jobs
  }

  for (const [projectId, nodes] of nodesByProject.entries()) {
    const project = projectOf(projectId)
    Object.assign(project, summarizeNodes(nodes))
    for (const node of nodes) {
      project.createdAt = project.createdAt ?? node.createdAt
      if (String(node.updatedAt ?? '') > String(project.updatedAt ?? '')) project.updatedAt = node.updatedAt
    }
    project.jobs = buildJobs(projectId, nodes)
  }

  // Projects that only have job lines (opened, no plan yet) still show them.
  for (const project of projects.values()) {
    if (project.jobs.length === 0) {
      const jobs = buildJobs(project.id, nodesByProject.get(project.id) ?? [])
      if (jobs.length > 0) project.jobs = jobs
    }
  }

  for (const project of projects.values()) {
    if (project.status === 'paused' || project.status === 'cancelled') continue
    if (project.jobs.length > 0 && project.jobs.every(job => job.status === 'done')) {
      project.status = 'done'
    }
  }

  const totals = emptyCounts()
  for (const project of projects.values()) {
    totals.tasks += project.totals.tasks
    totals.done += project.totals.done
    totals.active += project.totals.active
    totals.blocked += project.totals.blocked
    totals.failed += project.totals.failed
    totals.todo += project.totals.todo
    totals.waiting += project.totals.waiting
    totals.decisions += project.totals.decisions
    totals.costUsd = round(totals.costUsd + project.totals.costUsd)
  }

  return {
    generatedAt: options.now ?? null,
    projects: [...projects.values()].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))),
    totals,
  }
}
