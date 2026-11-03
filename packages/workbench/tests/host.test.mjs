import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {BROWSE_PATH, CONFIG_PATH, CONTROL_PATH, DECIDE_PATH, EMPLOYEES_PATH, FINANCE_PATH, JOB_CONFIG_PATH, ORG_PATH, PICK_PATH, PROJECTS_PATH, REQUIREMENTS_PATH, SERVICES_PATH, START_PATH, STATE_PATH, TASK_PATH, apply, pickScript} from '../index.js'
import { createEventLog } from '../events.js'
import { buildXlsx } from './fixtures.mjs'
import { DatabaseSync } from 'node:sqlite'
import { buildBoard, jobEvent, projectEvent, taskEvent } from '../projects.js'

/**
 * A minimal stand-in for the Cordis context.
 *
 * `webServer` arrives through `inject`, exactly like the real loader does it,
 * so this test reproduces the bug the plugin shipped with: reading
 * `ctx.get('webServer')` during `apply` returns nothing, the mount is skipped
 * silently, and the panel then 404s on every fetch.
 */
const PLAN = {
  roles: [{ key: 'sales', name: '销售', permissions: ['quote.create'], inherits: [] }],
  stack: { frontend: 'x', backend: 'y', database: 'z', rationale: 'boring' },
  entities: [{ key: 'quote', name: '报价单', fields: [] }],
  api: [{ method: 'POST', path: '/quotes', permission: 'quote.create', purpose: '创建' }],
  workItems: [
    { key: 'db', title: '建表', scope: 'database', dependsOn: [], instructions: '建表' },
    { key: 'api', title: '接口', scope: 'api', dependsOn: ['db'], instructions: '接口' },
    { key: 'ui', title: '页面', scope: 'frontend', dependsOn: [], instructions: '页面' },
  ],
  risks: [],
  questions: [],
  summary: 'ok',
  delivered: [],
  knownGaps: [],
  howToUse: [],
}

function fakeLlm() {
  return {
    listProviders: () => [{ id: 'p' }],
    async listModels() {
      return [{ id: 'm' }]
    },
    stream() {
      const text = JSON.stringify(PLAN)
      return (async function* generate() {
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function fakeContext({ withWebServer = true, withLlm = true, connection = null } = {}) {
  const routes = []
  const tools = []
  const disposers = []

  const webCtx = {
    get(name) {
      if (name !== 'webServer') return undefined
      if (!withWebServer) return undefined
      return {
        register(route) {
          routes.push(route)
          return () => {
            const index = routes.indexOf(route)
            if (index >= 0) routes.splice(index, 1)
          }
        },
      }
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }

  const ctx = {
    // A one-shot read during apply must find nothing, like the real thing.
    get(name) {
      if (name === 'connection' && connection !== null) return connection
      throw new Error('cannot get property "webServer" without inject')
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer'], 'the route must ride a webServer sub-fiber')
      return callback(webCtx)
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    llm: withLlm ? fakeLlm() : undefined,
    logger: { warn() {} },
  }

  return { ctx, routes, tools, disposers }
}

function fakeResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body
    },
  }
}

async function withDataDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-host-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the host mounts a read route and a write route, separately', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    assert.deepEqual(routes.map(route => route.path).sort(),
      [STATE_PATH, START_PATH, PROJECTS_PATH, CONTROL_PATH, DECIDE_PATH, CONFIG_PATH, EMPLOYEES_PATH, SERVICES_PATH, JOB_CONFIG_PATH, FINANCE_PATH, TASK_PATH, ORG_PATH, PICK_PATH, BROWSE_PATH, REQUIREMENTS_PATH].sort())
    assert.equal(STATE_PATH, '/workbench/state')
    assert.equal(START_PATH, '/workbench/start')
    assert.equal(PROJECTS_PATH, '/workbench/projects')
    assert.equal(CONTROL_PATH, '/workbench/control')
    assert.equal(DECIDE_PATH, '/workbench/decide')
    assert.equal(CONFIG_PATH, '/workbench/project-config')
    assert.equal(EMPLOYEES_PATH, '/workbench/employees')
    assert.equal(SERVICES_PATH, '/workbench/services')
    assert.equal(JOB_CONFIG_PATH, '/workbench/job-config')
    assert.equal(ORG_PATH, '/workbench/organization')
    for (const route of routes) {
      assert.equal(route.kind, 'exact')
      assert.equal(typeof route.handler, 'function')
    }
  })
})

test('an empty log projects to zeroes rather than NaN', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    const response = fakeResponse()
    await routes[0].handler({ method: 'GET' }, response)

    assert.equal(response.status, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.summary.decisions, 0)
    assert.equal(payload.summary.spentUsd, 0)
    assert.deepEqual(payload.events, [])
    assert.deepEqual(payload.summary.lanes.split, { code: 0, frontier: 0, human: 0 })
    assert.deepEqual(payload.board.projects, [], 'the board is the same file, so an empty log means an empty board')
    assert.equal(payload.board.totals.tasks, 0)
  })
})

test('the state route carries the project board beside the decision panel', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '报价单系统' }))
    await log.append(taskEvent({ event: 'claimed', taskId: 't1', projectId: 'p1', stage: 'build', owner: 'frontend', title: '改报价计算' }))

    const response = fakeResponse()
    await routes[0].handler({ method: 'GET' }, response)
    const payload = JSON.parse(response.body)

    assert.equal(response.status, 200)
    assert.equal(payload.board.projects.length, 1)
    assert.equal(payload.board.projects[0].title, '报价单系统')
    assert.equal(payload.board.projects[0].agents[0].owner, 'frontend')
    assert.equal(payload.summary.decisions, 0, 'a task line is not a decision')
  })
})

test('the route is read-only: writes are refused', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    const stateRoute = routes.find(route => route.path === STATE_PATH)
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = fakeResponse()
      await stateRoute.handler({ method }, response)
      assert.equal(response.status, 405, `${method} must not be accepted on the read route`)
      assert.equal(JSON.parse(response.body).error.code, 'method-not-allowed')
    }
  })
})

test('a headless profile keeps the tools and skips the route', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes, tools } = fakeContext({ withWebServer: false })
    assert.doesNotThrow(() => apply(ctx, { dataDir }), 'no web server must not break activation')
    assert.equal(routes.length, 0)
    assert.deepEqual(tools.map(tool => tool.name), [
      'workbench_plan_software', 'workbench_submit_plan', 'workbench_find_skill',
      'workbench_delivery_diagnostics', 'workbench_next_work', 'workbench_add_task',
      'workbench_report_work',
    ], 'the agent tools still register without a web server')
  })
})

test('both routes disappear when the plugin is disposed', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes, disposers } = fakeContext()
    apply(ctx, { dataDir })
    assert.equal(routes.length, 15)

    const response = fakeResponse()
    await routes[0].handler({ method: 'GET' }, response)
    assert.equal(response.status, 200)

    for (const dispose of disposers) dispose?.()
    assert.equal(routes.length, 0, 'a disposed plugin leaves no route behind')
  })
})

test('every agent tool declares the output contract the registry requires', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir })

    for (const registered of tools) {
      assert.ok(registered.output, `${registered.name} without output fails registration`)
      assert.deepEqual(registered.output.schema, { type: 'string' })
      assert.equal(typeof registered.output.render, 'function')
      assert.equal(typeof registered.execute, 'function')
    }

    const tool = tools[0]
    // Registering without `output` throws and takes the whole plugin down, so
    // this is the contract that keeps activation from regressing.
    assert.ok(tool.output, 'a tool without `output` fails registration')
    assert.deepEqual(tool.output.schema, { type: 'string' })
    assert.equal(typeof tool.output.render, 'function')
    assert.deepEqual(tool.output.render({}, 'hello'), [{ type: 'text', text: 'hello' }])
    assert.equal(typeof tool.execute, 'function')
  })
})

test('discovered work can enter the board as a real card', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '报价单系统' }))

    const addTask = tools.find(tool => tool.name === 'workbench_add_task')
    const added = JSON.parse(await addTask.execute({
      title: '补齐 Postgres 仓库层与路由接线',
      owner: 'backend',
      role: '后端开发',
      instructions: '接上 server/api/* 与 Next route handlers',
      blockedBy: [],
    }))

    // Re-read from disk: the tool wrote through the host's own log instance,
    // so this reader's cache is stale unless it is dropped.
    log.reset()
    const board = buildBoard(await log.all())
    const task = board.projects[0].roots.find(item => item.id === added.taskId)
    assert.ok(task, 'the card is on the board')
    assert.equal(task.title, '补齐 Postgres 仓库层与路由接线')
    assert.equal(task.discovered, true, 'a discovered card says so')
    assert.equal(task.owner, 'backend')
    assert.equal(board.projects[0].totals.tasks, 1)
  })
})

/* ── the task entry: one requirement in, one project out ────────────────── */

function postRequest(body, headers = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

async function waitFor(lines, predicate, timeoutMs = 8000) {
  const started = Date.now()
  for (;;) {
    const all = await lines()
    const hit = all.find(predicate)
    if (hit !== undefined) return hit
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for an event')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

test('POST /workbench/state starts a project from one requirement', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    const startRoute = routes.find(route => route.path === START_PATH)
    const response = fakeResponse()
    await startRoute.handler(postRequest({ requirement: '一个内部报价单系统' }), response)
    assert.equal(response.status, 202)
    assert.equal(JSON.parse(response.body).status, 'planning')

    const file = join(dataDir, 'events.jsonl')
    const readAll = async () => {
      try {
        return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      } catch {
        return []
      }
    }
    const project = await waitFor(readAll, event => event.kind === 'project')
    assert.equal(project.title, '一个内部报价单系统')
    const task = await waitFor(readAll, event => event.kind === 'task')
    assert.ok(task.taskId.startsWith(project.projectId))
  })
})

test('an empty requirement and a cross-origin POST are refused', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    const startRoute = routes.find(route => route.path === START_PATH)
    const empty = fakeResponse()
    await startRoute.handler(postRequest({ requirement: '   ' }), empty)
    assert.equal(empty.status, 400)
    assert.equal(JSON.parse(empty.body).error.code, 'empty-requirement')

    const cross = fakeResponse()
    await startRoute.handler(
      postRequest({ requirement: 'x' }, { origin: 'https://evil.example', host: '127.0.0.1:57580' }),
      cross,
    )
    assert.equal(cross.status, 403)
    assert.equal(JSON.parse(cross.body).error.code, 'forbidden')
  })
})

test('a named card can be created before any work exists', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)

    const created = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '公司管理' }), created)
    assert.equal(created.status, 201)
    const body = JSON.parse(created.body)
    assert.match(body.projectId, /^prj_/)
    assert.equal(body.name, '公司管理')

    // The card is on the board immediately, with no tasks under it.
    const stateRoute = routes.find(route => route.path === STATE_PATH)
    const state = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, state)
    const board = JSON.parse(state.body).board
    assert.equal(board.projects.length, 1)
    assert.equal(board.projects[0].title, '公司管理')
    assert.equal(board.projects[0].totals.tasks, 0)

    const empty = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '   ' }), empty)
    assert.equal(empty.status, 400)
    assert.equal(JSON.parse(empty.body).error.code, 'empty-name')
  })
})

test('a planning run can attach to an existing card instead of opening one', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)
    const startRoute = routes.find(route => route.path === START_PATH)

    const created = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '公司管理' }), created)
    const { projectId } = JSON.parse(created.body)

    const started = fakeResponse()
    await startRoute.handler(postRequest({ requirement: '一个内部报价单系统', projectId }), started)
    assert.equal(started.status, 202)

    const file = join(dataDir, 'events.jsonl')
    const readAll = async () => {
      try {
        return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      } catch {
        return []
      }
    }
    const job = await waitFor(readAll, event => event.kind === 'job' && event.projectId === projectId)
    assert.ok(job.jobId, 'the run opens a job on the card')
    const task = await waitFor(readAll, event => event.kind === 'task')
    assert.equal(task.projectId, projectId, 'tasks belong to the card, not to a new project')
    assert.ok(task.taskId.startsWith(`${job.jobId}:`), 'task ids are namespaced by the job')
  })
})

test('pause stops the dispatch queue, resume reopens it, cancel closes it for good', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)
    const controlRoute = routes.find(route => route.path === CONTROL_PATH)
    const stateRoute = routes.find(route => route.path === STATE_PATH)

    const created = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '公司管理' }), created)
    const { projectId } = JSON.parse(created.body)
    const read = async () => {
      const response = fakeResponse()
      await stateRoute.handler({ method: 'GET' }, response)
      return JSON.parse(response.body).board.projects.find(project => project.id === projectId)
    }

    const paused = fakeResponse()
    await controlRoute.handler(postRequest({ projectId, action: 'pause' }), paused)
    assert.equal(paused.status, 200)
    assert.equal(JSON.parse(paused.body).status, 'paused')
    assert.equal((await read()).status, 'paused')

    const resumed = fakeResponse()
    await controlRoute.handler(postRequest({ projectId, action: 'resume' }), resumed)
    assert.equal((await read()).status, 'started', 'resume reads as running again')

    const cancelled = fakeResponse()
    await controlRoute.handler(postRequest({ projectId, action: 'cancel' }), cancelled)
    assert.equal((await read()).status, 'cancelled')

    const bad = fakeResponse()
    await controlRoute.handler(postRequest({ projectId, action: 'explode' }), bad)
    assert.equal(bad.status, 400)
    assert.equal(JSON.parse(bad.body).error.code, 'unknown-action')
  })
})

test('a paused project hands out no work', async () => {
  const { readyWork } = await import('../executor.js')
  const board = {
    projects: [{
      id: 'p1',
      status: 'paused',
      roots: [{
        id: 't1', status: 'todo', stage: 'build', owner: 'backend', children: [],
        openBlockers: [],
      }],
    }],
  }
  assert.deepEqual(readyWork(board).work, [])
  assert.equal(readyWork(board).stopped, 'paused')
})

test('resuming one job also lifts a project-level pause', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)
    const controlRoute = routes.find(route => route.path === CONTROL_PATH)
    const stateRoute = routes.find(route => route.path === STATE_PATH)

    const created = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '公司管理' }), created)
    const { projectId } = JSON.parse(created.body)

    const read = async () => {
      const response = fakeResponse()
      await stateRoute.handler({ method: 'GET' }, response)
      return JSON.parse(response.body).board
    }

    // Pause the project as a whole, then resume the job only.
    const paused = fakeResponse()
    await controlRoute.handler(postRequest({ projectId, action: 'pause' }), paused)
    assert.equal((await read()).projects[0].status, 'paused')

    const resumedJob = fakeResponse()
    await controlRoute.handler(postRequest({ projectId, jobId: `${projectId}:job1`, action: 'resume' }), resumedJob)
    assert.equal(resumedJob.status, 200)
    const board = (await read()).projects[0]
    assert.equal(board.status, 'started', 'the project gate opens, or nothing can be dispatched')
    assert.equal(board.jobs[0].id, `${projectId}:job1`)
    assert.equal(board.jobs[0].status, 'started')
  })
})

test('approving a gate clears it, rejecting parks the card', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const decideRoute = routes.find(route => route.path === DECIDE_PATH)
    const stateRoute = routes.find(route => route.path === STATE_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))

    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))
    await log.append(taskEvent({ event: 'created', taskId: 'p1:wi:a', projectId: 'p1', stage: 'build', owner: 'backend', title: '建表' }))
    await log.append({ kind: 'approval', taskId: 'p1:wi:a', action: 'merge_pull_request', status: 'requested', irreversible: true, ts: new Date().toISOString() })

    const readBoard = async () => {
      const response = fakeResponse()
      await stateRoute.handler({ method: 'GET' }, response)
      return JSON.parse(response.body).board.projects[0]
    }
    assert.equal((await readBoard()).gates.length, 1, 'the approval is pending')

    const approve = fakeResponse()
    await decideRoute.handler(postRequest({ taskId: 'p1:wi:a', action: 'merge_pull_request', decision: 'approve' }), approve)
    assert.equal(approve.status, 200)
    log.reset()
    assert.equal((await readBoard()).gates.length, 0, 'an approved gate leaves the queue')

    // A rejected gate parks the card instead of silently continuing.
    await log.append({ kind: 'approval', taskId: 'p1:wi:a', action: 'merge_pull_request', status: 'requested', irreversible: true, ts: new Date().toISOString() })
    const reject = fakeResponse()
    await decideRoute.handler(postRequest({ taskId: 'p1:wi:a', action: 'merge_pull_request', decision: 'reject' }), reject)
    assert.equal(reject.status, 200)
    log.reset()
    const after = await readBoard()
    assert.equal(after.gates.length, 0)
    const card = after.roots.find(task => task.id === 'p1:wi:a')
    assert.equal(card.status, 'blocked', 'rejection stops the card')
  })
})

test('a project can be pointed at its workspace, and preview refuses without one', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const configRoute = routes.find(route => route.path === CONFIG_PATH)
    const stateRoute = routes.find(route => route.path === STATE_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))

    const missing = fakeResponse()
    await configRoute.handler(postRequest({ projectId: 'p1', workspace: 'relative/path' }), missing)
    assert.equal(missing.status, 400, 'a workspace must be an absolute existing directory')

    const ok = fakeResponse()
    await configRoute.handler(postRequest({ projectId: 'p1', workspace: dataDir }), ok)
    assert.equal(ok.status, 200)
    log.reset()

    const response = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, response)
    const board = JSON.parse(response.body).board
    assert.equal(board.projects[0].workspace, dataDir)

  })
})

test('the panel can read and write the app database without the app server', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const employeesRoute = routes.find(route => route.path === EMPLOYEES_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    const workspace = join(dataDir, 'workspace')
    mkdirSync(workspace, { recursive: true })
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理', workspace, event: 'config' }))

    const call = async body => {
      const response = fakeResponse()
      await employeesRoute.handler(
        body.method === 'GET'
          ? { method: 'GET', url: `/workbench/employees?projectId=p1&search=${encodeURIComponent(body.search ?? '')}` }
          : postRequest({ projectId: 'p1', ...body }),
        response,
      )
      return { status: response.status, body: JSON.parse(response.body) }
    }

    const created = await call({ op: 'create', employee: { name: '刘寄和', email: 'Liu@Example.com', status: 'active' } })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.email, 'Liu@Example.com')

    const listed = await call({ method: 'GET', search: 'liu' })
    assert.equal(listed.status, 200)
    assert.equal(listed.body.total, 1, 'search is case-insensitive')
    assert.equal(listed.body.data[0].name, '刘寄和')

    const duplicate = await call({ op: 'create', employee: { name: 'dupe', email: 'liu@example.com' } })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.error.code, 'EMAIL_CONFLICT')

    const updated = await call({ op: 'update', id: created.body.data.id, patch: { status: 'inactive' } })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.status, 'inactive')

    const removed = await call({ op: 'delete', id: created.body.data.id })
    assert.equal(removed.status, 200)
    assert.deepEqual(removed.body.data, { id: created.body.data.id })
    const again = await call({ op: 'delete', id: created.body.data.id })
    assert.equal(again.status, 404)

    const bad = await call({ op: 'create', employee: { name: '', email: 'nope' } })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR')
  })
})

test('the panel can see a project\'s dependencies and is refused a phantom start', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const servicesRoute = routes.find(route => route.path === SERVICES_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    const workspace = join(dataDir, 'workspace')
    mkdirSync(workspace, { recursive: true })
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理', workspace, event: 'config' }))

    const listed = fakeResponse()
    await servicesRoute.handler({ method: 'GET', url: '/workbench/services?projectId=p1' }, listed)
    assert.equal(listed.status, 200)
    const services = JSON.parse(listed.body).data
    // No delivered app under this workspace: the database row is all there is.
    assert.deepEqual(services.map(service => service.id), ['db'])
    assert.equal(services[0].status, 'missing', 'no database file yet')

    const bad = fakeResponse()
    await servicesRoute.handler(postRequest({ projectId: 'p1', serviceId: 'db', action: 'start' }), bad)
    assert.equal(bad.status, 400, 'a file dependency has no start action')

    const noApp = fakeResponse()
    await servicesRoute.handler(postRequest({ projectId: 'p1', serviceId: 'web', action: 'start' }), noApp)
    assert.equal(noApp.status, 400)
    assert.equal(JSON.parse(noApp.body).error.code, 'NO_APP')

    // A project that still ships an app lists the server row again.
    mkdirSync(join(workspace, 'web'), { recursive: true })
    await writeFile(join(workspace, 'web', 'package.json'), '{"scripts":{"start":"next start"}}')
    const withApp = fakeResponse()
    await servicesRoute.handler({ method: 'GET', url: '/workbench/services?projectId=p1' }, withApp)
    assert.deepEqual(JSON.parse(withApp.body).data.map(service => service.id), ['db', 'web'])
  })
})

test('a job can be named after the requirement it runs', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const jobConfigRoute = routes.find(route => route.path === JOB_CONFIG_PATH)
    const stateRoute = routes.find(route => route.path === STATE_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))
    await log.append({ kind: 'job', projectId: 'p1', jobId: 'p1', event: 'created', title: '公司管理' })

    const renamed = fakeResponse()
    await jobConfigRoute.handler(postRequest({ projectId: 'p1', jobId: 'p1', title: '员工管理' }), renamed)
    assert.equal(renamed.status, 200)

    log.reset()
    const response = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, response)
    const job = JSON.parse(response.body).board.projects[0].jobs[0]
    assert.equal(job.title, '员工管理', 'the task is named after its requirement')
    assert.notEqual(job.status, 'config', 'renaming must not become a status')
  })
})

test('a task stores its own workspace and conversation binding', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const jobConfigRoute = routes.find(route => route.path === JOB_CONFIG_PATH)
    const stateRoute = routes.find(route => route.path === STATE_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))
    await log.append({ kind: 'job', projectId: 'p1', jobId: 'j1', event: 'created', title: '员工管理' })

    const workspace = join(dataDir, 'ws')
    mkdirSync(workspace, { recursive: true })

    const bound = fakeResponse()
    await jobConfigRoute.handler(postRequest({ projectId: 'p1', jobId: 'j1', sessionId: 'ses_1', workspace, workspaceId: 'ws_1' }), bound)
    assert.equal(bound.status, 200)

    const badPath = fakeResponse()
    await jobConfigRoute.handler(postRequest({ projectId: 'p1', jobId: 'j1', workspace: 'relative' }), badPath)
    assert.equal(badPath.status, 400, 'a workspace must be an existing absolute directory')

    log.reset()
    const response = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, response)
    const job = JSON.parse(response.body).board.projects[0].jobs[0]
    assert.equal(job.sessionId, 'ses_1')
    assert.equal(job.workspace, workspace)
    assert.equal(job.workspaceId, 'ws_1', 'the DSH workspace id is stored beside the path')
  })
})

test('the finance route reads a directory of bank CSVs and imports it once', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const financeRoute = routes.find(route => route.path === FINANCE_PATH)
    assert.ok(financeRoute, 'the finance route is mounted')

    const bankDir = join(dataDir, 'bank')
    mkdirSync(bankDir, { recursive: true })
    await writeFile(join(bankDir, '2026-01.csv'), [
      '交易日期,交易摘要,对方户名,交易金额,收支,余额',
      '2026-01-05,工资发放,某某公司,12000.00,收入,12000.00',
      '2026-01-08,美团外卖,美团,-38.50,支出,11961.50',
      '2026-02-01,房租,张房东,-5000.00,支出,6961.50',
    ].join('\n'), 'utf8')

    const refused = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'set-dir', dir: 'relative/path' }), refused)
    assert.equal(refused.status, 400, 'a directory must be absolute')

    const configured = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'set-dir', dir: bankDir }), configured)
    assert.equal(configured.status, 200)
    assert.equal(JSON.parse(configured.body).dir, bankDir)

    const listed = fakeResponse()
    await financeRoute.handler({ method: 'GET', url: '/workbench/finance?projectId=p1' }, listed)
    const before = JSON.parse(listed.body)
    assert.equal(before.dirExists, true)
    assert.equal(before.files.length, 1, 'one CSV is offered, nothing else')
    assert.equal(before.files[0].name, '2026-01.csv')
    assert.equal(before.files[0].importedAt, null, 'not imported yet')
    assert.equal(before.totalTransactions, 0)

    const imported = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'import' }), imported)
    assert.equal(imported.status, 200)
    const result = JSON.parse(imported.body).result
    assert.equal(result.imported.length, 1)
    assert.equal(result.imported[0].rows, 3)
    assert.equal(result.imported[0].encoding, 'utf-8')
    assert.equal(result.imported[0].skipped, 0)

    const january = fakeResponse()
    await financeRoute.handler({ method: 'GET', url: '/workbench/finance?projectId=p1&from=2026-01-01&to=2026-01-31' }, january)
    const after = JSON.parse(january.body)
    assert.equal(after.files[0].importedAt !== null, true, 'the file shows as imported')
    assert.equal(after.totalTransactions, 3, 'all rows are on the books')
    assert.equal(after.summary.totals.income, 12000)
    assert.equal(after.summary.totals.expense, 38.5)
    assert.equal(after.summary.count, 2, 'the window really filters')
    assert.equal(after.transactions.length, 2)
    assert.ok(after.categories.includes('工资薪酬'), 'categories are derived for grouping')

    const again = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'import' }), again)
    const second = JSON.parse(again.body).result
    assert.equal(second.imported.length, 0, 're-importing the same export is a no-op')
    assert.equal(second.skipped[0].reason, 'already-imported')

    const crossOrigin = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'import' }, { origin: 'https://evil.example' }), crossOrigin)
    assert.equal(crossOrigin.status, 403, 'a cross-origin import is refused')

    // The statements actually arrive as Excel; the same route has to take them.
    await writeFile(join(bankDir, '流水-2026-03.xlsx'), buildXlsx())
    const xlsxImport = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'import' }), xlsxImport)
    const xlsxResult = JSON.parse(xlsxImport.body).result
    assert.equal(xlsxResult.imported.length, 1)
    assert.equal(xlsxResult.imported[0].format, 'xlsx')
    assert.equal(xlsxResult.imported[0].sheet, '流水', 'the statement tab, not the cover tab')
    assert.equal(xlsxResult.imported[0].rows, 3)

    const listedXlsx = fakeResponse()
    await financeRoute.handler({ method: 'GET', url: '/workbench/finance?projectId=p1' }, listedXlsx)
    const withXlsx = JSON.parse(listedXlsx.body)
    assert.equal(withXlsx.totalTransactions, 6, 'csv rows and xlsx rows share one ledger')
    assert.ok(withXlsx.files.some(file => file.format === 'xlsx'), 'the folder listing names the format')
  })
})

test('a card can be reported over HTTP, and done still needs green tests', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const taskRoute = routes.find(route => route.path === TASK_PATH)
    assert.ok(taskRoute, 'the task report route is mounted')
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))
    await log.append({ kind: 'job', projectId: 'p1', jobId: 'j1', event: 'created', title: '财务管理' })
    await log.append(taskEvent({
      event: 'created', taskId: 'j1:wi:card', projectId: 'p1', jobId: 'j1',
      stage: 'build', owner: 'backend', title: '建表',
    }))
    log.reset()

    const missing = fakeResponse()
    await taskRoute.handler(postRequest({ event: 'progress' }), missing)
    assert.equal(missing.status, 400, 'a report needs a task id')

    const unknown = fakeResponse()
    await taskRoute.handler(postRequest({ taskId: 'nope', event: 'progress' }), unknown)
    assert.equal(unknown.status, 404)

    const started = fakeResponse()
    await taskRoute.handler(postRequest({ taskId: 'j1:wi:card', event: 'progress', notes: '写表' }), started)
    assert.equal(started.status, 200)
    assert.equal(JSON.parse(started.body).recorded, 'progress')

    let stateResponse = fakeResponse()
    const stateRoute = routes.find(route => route.path === STATE_PATH)
    await stateRoute.handler({ method: 'GET' }, stateResponse)
    let card = JSON.parse(stateResponse.body).board.projects[0].jobs[0].roots[0]
    assert.equal(card.status, 'active', 'the card lights up while it is being worked on')

    const claim = fakeResponse()
    await taskRoute.handler(postRequest({ taskId: 'j1:wi:card', event: 'done', notes: '自评完成' }), claim)
    assert.equal(claim.status, 200)
    assert.equal(JSON.parse(claim.body).recorded, 'blocked', 'done without tests lands on a person')

    const green = fakeResponse()
    await taskRoute.handler(postRequest({
      taskId: 'j1:wi:card', event: 'done', notes: '表建好', files: ['finance.js'],
      exitCode: 0, testsPassed: 141, testsFailed: 0,
    }), green)
    assert.equal(green.status, 200)
    assert.equal(JSON.parse(green.body).recorded, 'done')

    stateResponse = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, stateResponse)
    card = JSON.parse(stateResponse.body).board.projects[0].jobs[0].roots[0]
    assert.equal(card.status, 'done')

    const crossOrigin = fakeResponse()
    await taskRoute.handler(postRequest({ taskId: 'j1:wi:card', event: 'progress' }, { origin: 'https://evil.example' }), crossOrigin)
    assert.equal(crossOrigin.status, 403, 'a cross-origin report is refused')
  })
})

test('the finance page can read the app ledger database instead of CSV files', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const financeRoute = routes.find(route => route.path === FINANCE_PATH)

    // The owner's database: same schema the company app uses.
    const dbPath = join(dataDir, 'hzy.db')
    const database = new DatabaseSync(dbPath)
    database.exec('create table companies (id text primary key, name text)')
    database.exec(`create table finance (
      id text primary key, date text, type text, "catGroup" text, category text,
      company text, dept text, person text, amount real, method text,
      summary text, voucher text, note text)`)
    database.prepare('insert into companies values (?, ?)').run('c1', '华之语')
    const insert = database.prepare('insert into finance values (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    insert.run('f1', '2026-05-20', '支出', '人力成本', '社保公积金', 'c1', '', '', 4350, '对公转账', '委托收款', '', '交易后余额：543,375.70')
    insert.run('f2', '2026-03-30', '收入', '其他收入', '税费退回', 'c1', '', '', 1615.24, '对公转账', '电子退库', '', '')
    database.close()

    const configured = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'set-source', source: 'sqlite', dbPath }), configured)
    assert.equal(configured.status, 200)

    const payload = fakeResponse()
    await financeRoute.handler({ method: 'GET', url: '/workbench/finance?projectId=p1&preset=all' }, payload)
    const body = JSON.parse(payload.body)
    assert.equal(body.source, 'sqlite')
    assert.equal(body.dbExists, true)
    assert.equal(body.totalTransactions, 2)
    assert.deepEqual(body.summary.totals, { income: 1615.24, expense: 4350, net: -2734.76 })
    assert.ok(body.categories.includes('人力成本 · 社保公积金'))
    const withBalance = body.transactions.find(row => row.id === 'db_f1')
    assert.equal(withBalance.balance, 543375.7)
    assert.equal(withBalance.company, '华之语')
    const withoutBalance = body.transactions.find(row => row.id === 'db_f2')
    assert.equal(withoutBalance.balance, null, 'rows without a balance say so')

    const refused = fakeResponse()
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'import' }), refused)
    assert.equal(refused.status, 400, 'a live source has nothing to import')
    assert.equal(JSON.parse(refused.body).error.code, 'not-applicable')

    const bad = fakeResponse()
    // An allowed path that is not a finance database: rejected by the reader,
    // not by the path fence.
    await financeRoute.handler(postRequest({ projectId: 'p1', op: 'set-source', source: 'sqlite', dbPath: join(dataDir, 'nope.db') }), bad)
    assert.equal(bad.status, 400)
    assert.equal(JSON.parse(bad.body).error.code, 'bad-database')
  })
})

test('the panel manages several companies with their own departments and job levels', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const orgRoute = routes.find(route => route.path === ORG_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    const workspace = join(dataDir, 'workspace')
    mkdirSync(join(workspace, 'web', 'data'), { recursive: true })
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理', workspace, event: 'config' }))

    const get = async (query = '') => {
      const response = fakeResponse()
      await orgRoute.handler({ method: 'GET', url: `/workbench/organization?projectId=p1${query}` }, response)
      return { status: response.status, body: JSON.parse(response.body) }
    }
    const post = async body => {
      const response = fakeResponse()
      await orgRoute.handler(postRequest({ projectId: 'p1', ...body }), response)
      return { status: response.status, body: JSON.parse(response.body) }
    }

    const empty = await get()
    assert.deepEqual(empty.body.data.companies, [])
    assert.equal(empty.body.data.company, null)

    const a = await post({ op: 'company.create', name: '甲公司' })
    const b = await post({ op: 'company.create', name: '乙公司' })
    assert.equal(a.status, 201)
    assert.equal((await get()).body.data.companies.length, 2)

    const aRoot = await post({ op: 'department.create', companyId: a.body.data.company.id, name: '研发部' })
    const bRoot = await post({ op: 'department.create', companyId: b.body.data.company.id, name: '财务部' })
    assert.equal(aRoot.status, 201)
    const crossParent = await post({
      op: 'department.create',
      companyId: b.body.data.company.id,
      name: '串门',
      parentDepartmentId: aRoot.body.data.department.id,
    })
    assert.equal(crossParent.status, 400, 'a parent must belong to the same company')

    const levelA = await post({ op: 'joblevel.create', companyId: a.body.data.company.id, name: 'P7', rankOrder: 1 })
    const levelB = await post({ op: 'joblevel.create', companyId: b.body.data.company.id, name: 'P5', rankOrder: 1 })
    assert.equal(levelA.status, 201)

    const scopedA = await get(`&companyId=${a.body.data.company.id}`)
    const scopedB = await get(`&companyId=${b.body.data.company.id}`)
    assert.deepEqual(scopedA.body.data.departments.map(item => item.name), ['研发部'])
    assert.deepEqual(scopedB.body.data.departments.map(item => item.name), ['财务部'])
    assert.deepEqual(scopedA.body.data.jobLevels.map(item => item.name), ['P7'])

    const renamed = await post({ op: 'company.rename', id: a.body.data.company.id, name: '甲公司（更名）' })
    assert.equal(renamed.status, 200)

    const blockedCompany = await post({ op: 'company.delete', id: a.body.data.company.id })
    assert.equal(blockedCompany.status, 409, 'a company with structure is not deleted silently')

    const blockedDept = await post({ op: 'department.create', companyId: a.body.data.company.id, name: '后端', parentDepartmentId: aRoot.body.data.department.id })
    const parentDelete = await post({ op: 'department.delete', id: aRoot.body.data.department.id })
    assert.equal(parentDelete.status, 409, 'a department with children is not deleted silently')

    await post({ op: 'department.delete', id: blockedDept.body.data.department.id })
    await post({ op: 'department.delete', id: aRoot.body.data.department.id })
    await post({ op: 'joblevel.delete', id: levelA.body.data.jobLevel.id })
    const deleted = await post({ op: 'company.delete', id: a.body.data.company.id })
    assert.equal(deleted.status, 200)
    assert.equal((await get()).body.data.companies.length, 1, 'only 乙公司 remains')
    void levelB
  })
})

test('the organization route refuses a read without a project', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const orgRoute = routes.find(route => route.path === ORG_PATH)
    const response = fakeResponse()
    await orgRoute.handler({ method: 'GET', url: '/workbench/organization' }, response)
    assert.equal(response.status, 404)
    assert.match(response.body, /no such project/)
  })
})

test('finance belongs to one project: two books never share rows', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const financeRoute = routes.find(route => route.path === FINANCE_PATH)
    const bankDir = join(dataDir, 'bank')
    mkdirSync(bankDir, { recursive: true })
    await writeFile(join(bankDir, '2026-01.csv'), [
      '交易日期,交易摘要,对方户名,交易金额,收支,余额',
      '2026-01-05,工资发放,某某公司,12000.00,收入,12000.00',
      '2026-01-08,美团外卖,美团,-38.50,支出,11961.50',
    ].join('\n'), 'utf8')

    const get = async projectId => {
      const response = fakeResponse()
      await financeRoute.handler({ method: 'GET', url: `/workbench/finance?projectId=${projectId}` }, response)
      return JSON.parse(response.body)
    }
    const post = async body => {
      const response = fakeResponse()
      await financeRoute.handler(postRequest(body), response)
      return { status: response.status, body: JSON.parse(response.body) }
    }

    await post({ projectId: 'prj_a', op: 'set-dir', dir: bankDir })
    await post({ projectId: 'prj_b', op: 'set-dir', dir: bankDir })
    await post({ projectId: 'prj_a', op: 'import' })

    const a = await get('prj_a')
    const b = await get('prj_b')
    assert.equal(a.totalTransactions, 2, 'project A has its own rows')
    assert.equal(a.files[0].importedAt !== null, true)
    assert.equal(b.totalTransactions, 0, 'project B is untouched')
    assert.equal(b.files[0].importedAt, null, 'A importing a file does not mark it imported for B')

    await post({ projectId: 'prj_b', op: 'import' })
    const bAfter = await get('prj_b')
    assert.equal(bAfter.totalTransactions, 2, 'the same file can be imported into B independently')
    assert.equal((await get('prj_a')).totalTransactions, 2, 'A did not grow from B\'s import')

    const missing = fakeResponse()
    await financeRoute.handler({ method: 'GET', url: '/workbench/finance' }, missing)
    assert.equal(missing.status, 400, 'finance reads must name their project')
  })
})

test('the native picker asks the OS for a path and never for a command', async () => {
  const folder = pickScript('directory', '选择流水目录')
  const file = pickScript('file', '选择数据库')
  assert.ok(folder && file, 'the platform has a picker')
  assert.equal(folder.file, process.platform === 'darwin' ? 'osascript' : folder.file)
  assert.ok(JSON.stringify(folder.args).includes(process.platform === 'darwin' ? 'choose folder' : 'directory'))
  assert.ok(JSON.stringify(file.args).includes(process.platform === 'darwin' ? 'choose file' : 'file'))
  const quoted = pickScript('file', 'a "quoted" prompt')
  assert.equal((quoted.args.join(' ').match(/"/g) || []).length, 2, 'quotes never reach the script — only the delimiters do')

  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const pickRoute = routes.find(route => route.path === PICK_PATH)
    assert.ok(pickRoute, 'the picker route is mounted')

    const bad = fakeResponse()
    await pickRoute.handler(postRequest({ kind: 'asteroid' }), bad)
    assert.equal(bad.status, 400, 'only file and directory are accepted')

    const cross = fakeResponse()
    await pickRoute.handler(postRequest({ kind: 'file' }, { origin: 'https://evil.example' }), cross)
    assert.equal(cross.status, 403, 'a cross-origin request cannot open a dialog')

    const wrongMethod = fakeResponse()
    await pickRoute.handler({ method: 'GET', url: '/workbench/pick-path' }, wrongMethod)
    assert.equal(wrongMethod.status, 405)
  })
})

test('the panel can walk the filesystem when a native dialog is unavailable', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const browseRoute = routes.find(route => route.path === BROWSE_PATH)
    assert.ok(browseRoute, 'the browse route is mounted')

    const root = join(dataDir, 'docs')
    mkdirSync(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, 'app.sqlite'), 'x')
    await writeFile(join(root, '.hidden'), 'x')

    const listed = fakeResponse()
    await browseRoute.handler(postRequest({ path: root }), listed)
    assert.equal(listed.status, 200)
    const body = JSON.parse(listed.body)
    assert.equal(body.path, root)
    assert.equal(body.parent, dirname(root))
    assert.equal(body.entries[0].name, 'sub', 'directories come first')
    assert.equal(body.entries[0].isDir, true)
    assert.ok(body.entries.some(entry => entry.name === 'app.sqlite' && entry.isDir === false))
    assert.ok(body.entries.every(entry => entry.name.startsWith('.') === false), 'dotfiles stay hidden')

    const file = fakeResponse()
    await browseRoute.handler(postRequest({ path: join(root, 'app.sqlite') }), file)
    assert.equal(file.status, 400, 'a file is not browsable')

    const cross = fakeResponse()
    await browseRoute.handler(postRequest({ path: root }, { origin: 'https://evil.example' }), cross)
    assert.equal(cross.status, 403)
  })
})

test('employees can be linked to a company and a department of that company', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const employeesRoute = routes.find(route => route.path === EMPLOYEES_PATH)
    const orgRoute = routes.find(route => route.path === ORG_PATH)
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    const workspace = join(dataDir, 'workspace')
    mkdirSync(join(workspace, 'web', 'data'), { recursive: true })
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理', workspace, event: 'config' }))

    const org = async body => {
      const response = fakeResponse()
      await orgRoute.handler(postRequest({ projectId: 'p1', ...body }), response)
      return JSON.parse(response.body).data
    }
    const a = (await org({ op: 'company.create', name: '甲公司' })).company
    const b = (await org({ op: 'company.create', name: '乙公司' })).company
    const aDev = (await org({ op: 'department.create', companyId: a.id, name: '研发部' })).department
    const bFin = (await org({ op: 'department.create', companyId: b.id, name: '财务部' })).department

    const call = async body => {
      const response = fakeResponse()
      await employeesRoute.handler(
        body.method === 'GET'
          ? { method: 'GET', url: `/workbench/employees?projectId=p1&companyId=${body.companyId ?? ''}&search=` }
          : postRequest({ projectId: 'p1', ...body }),
        response,
      )
      return { status: response.status, body: JSON.parse(response.body) }
    }

    const created = await call({ op: 'create', employee: { name: '张三', email: 'z@x.com', companyId: a.id, departmentId: aDev.id } })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.companyName, '甲公司')
    assert.equal(created.body.data.departmentName, '研发部')
    assert.equal(created.body.data.department, null, 'the text column still follows the link only when set')

    const mismatched = await call({ op: 'create', employee: { name: '李四', email: 'l@x.com', companyId: b.id, departmentId: aDev.id } })
    assert.equal(mismatched.status, 400, 'a department must belong to the chosen company')

    const noCompany = await call({ op: 'create', employee: { name: '王五', email: 'w@x.com', companyId: 999 } })
    assert.equal(noCompany.status, 400)

    await call({ op: 'create', employee: { name: '赵六', email: 'zg@x.com', companyId: b.id, departmentId: bFin.id } })

    const onlyA = await call({ method: 'GET', companyId: a.id })
    assert.equal(onlyA.body.total, 1, 'the list can be scoped to one company')
    assert.equal(onlyA.body.data[0].name, '张三')

    const moved = await call({ op: 'update', id: created.body.data.id, patch: { departmentId: bFin.id } })
    assert.equal(moved.status, 400, 'a bare department move across companies is refused')
    const movedOk = await call({ op: 'update', id: created.body.data.id, patch: { companyId: b.id, departmentId: bFin.id } })
    assert.equal(movedOk.status, 200)
    assert.equal(movedOk.body.data.companyName, '乙公司')
    assert.equal(movedOk.body.data.departmentName, '财务部')
  })
})

test('the main agent can submit exactly one validated plan per job', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '员工管理' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j2', title: '修改员工管理' }))

    const submit = tools.find(tool => tool.name === 'workbench_submit_plan')
    const result = JSON.parse(await submit.execute({
      jobId: 'j1',
      brief: '员工管理',
      design: { entities: ['employee'] },
      tasks: [
        { id: 'db', title: '建员工表', owner: 'backend', stage: 'build' },
        { id: 'api', title: '员工 API', owner: 'backend', stage: 'build', blockedBy: ['db'] },
      ],
    }))
    assert.equal(result.tasks, 2)
    assert.equal(result.planBy, 'agent')
    assert.equal(result.files.length, 1, 'design.json is written next to the ledger')

    // The tool writes through its own log instance; read the file again.
    const board = buildBoard(await createEventLog(join(dataDir, 'events.jsonl')).all())
    const job = board.projects[0].jobs[0]
    assert.equal(job.planBy, 'agent')
    assert.equal(job.roots.length, 1, 'one build container card')
    assert.deepEqual(job.roots[0].children.map(task => task.title), ['建员工表', '员工 API'])

    // A plan is immutable: a change request is a new job.
    await assert.rejects(
      () => submit.execute({ jobId: 'j1', tasks: [{ id: 'x', title: 'x' }] }),
      /already has a plan/,
    )

    // A rejected plan writes nothing at all.
    await assert.rejects(
      () => submit.execute({ jobId: 'j2', tasks: [{ id: 'a', title: 'a', owner: 'nobody' }] }),
      /invalid plan/,
    )
    const after = buildBoard(await createEventLog(join(dataDir, 'events.jsonl')).all())
    const j2 = after.projects[0].jobs.find(item => item.id === 'j2')
    assert.equal(j2.planBy, null)
    assert.equal(j2.roots.length, 0)
  })
})

test('a requirement opens a job, stores its document and keeps the text', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))

    const route = routes.find(item => item.path === REQUIREMENTS_PATH)
    const response = fakeResponse()
    await route.handler(postRequest({
      projectId: 'p1',
      title: '员工管理',
      text: '## 需求\n给公司管理加员工管理页',
    }), response)
    assert.equal(response.status, 202)
    const body = JSON.parse(response.body)
    assert.match(body.jobId, /^deliveries_/)
    assert.equal(body.requirement.title, '员工管理')
    assert.equal(body.requirement.source, 'text')

    const board = buildBoard(await createEventLog(join(dataDir, 'events.jsonl')).all())
    const job = board.projects[0].jobs.find(item => item.id === body.jobId)
    assert.equal(job.requirement.text, '## 需求\n给公司管理加员工管理页')
    assert.equal(job.requirement.source, 'text')
    assert.equal(job.status, 'created')

    const stored = await readFile(join(dataDir, body.requirement.file), 'utf8')
    assert.match(stored, /员工管理页/)
    assert.match(stored, /job: deliveries_/)
  })
})

test('an uploaded markdown requirement is decoded; bad input is refused', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))

    const route = routes.find(item => item.path === REQUIREMENTS_PATH)
    const uploaded = fakeResponse()
    await route.handler(postRequest({
      projectId: 'p1',
      file: { name: 'requirement.md', base64: Buffer.from('# 报销流程\n实现报销单').toString('base64') },
    }), uploaded)
    assert.equal(uploaded.status, 202)
    const body = JSON.parse(uploaded.body)
    assert.equal(body.requirement.source, 'upload')
    assert.equal(body.requirement.title, '报销流程')

    const unknownProject = fakeResponse()
    await route.handler(postRequest({ projectId: 'nope', text: 'x' }), unknownProject)
    assert.equal(unknownProject.status, 404)

    const empty = fakeResponse()
    await route.handler(postRequest({ projectId: 'p1', text: '   ' }), empty)
    assert.equal(empty.status, 400)
    assert.equal(JSON.parse(empty.body).error.code, 'invalid-requirement')

    const wrongMethod = fakeResponse()
    await route.handler({ method: 'GET' }, wrongMethod)
    assert.equal(wrongMethod.status, 405)
  })
})

test('skill discovery degrades cleanly when no skill service is mounted', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir })
    const find = tools.find(tool => tool.name === 'workbench_find_skill')
    const parsed = JSON.parse(await find.execute({ query: 'database migration', taskId: 'job-1:wi:db' }))
    assert.equal(parsed.query, 'database migration')
    assert.deepEqual(parsed.sessionSkills, [])
    assert.deepEqual(parsed.market, [])
    assert.ok(parsed.howToUse.length >= 2)

    // The lookup still lands in the ledger, even without services.
    const lines = await createEventLog(join(dataDir, 'events.jsonl')).all()
    const skill = lines.find(line => line.kind === 'skill')
    assert.equal(skill.taskId, 'job-1:wi:db')
    assert.equal(skill.query, 'database migration')

    await assert.rejects(() => find.execute({ query: '   ' }), /query is required/)
  })
})

test('every route is fenced by the host connection policy', async () => {
  await withDataDir(async dataDir => {
    const connection = {
      requestRejection: request => (request?.headers?.['x-untrusted'] === '1' ? { code: 'denied' } : undefined),
    }
    const { ctx, routes } = fakeContext({ connection })
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)

    const denied = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '被拒' }, { 'x-untrusted': '1' }), denied)
    assert.equal(denied.status, 403)
    assert.equal(JSON.parse(denied.body).error.code, 'untrusted-connection')

    const allowed = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '放行' }), allowed)
    assert.equal(allowed.status, 201, 'a trusted request is unaffected')
  })
})

test('path-sensitive routes stay inside the allowed roots', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    const browseRoute = routes.find(route => route.path === BROWSE_PATH)
    const outside = fakeResponse()
    await browseRoute.handler(postRequest({ path: '/etc' }), outside)
    assert.equal(outside.status, 403)
    assert.equal(JSON.parse(outside.body).error.code, 'path-not-allowed')

    const configRoute = routes.find(route => route.path === CONFIG_PATH)
    const refused = fakeResponse()
    await configRoute.handler(postRequest({ projectId: 'p1', workspace: '/etc' }), refused)
    assert.equal(refused.status, 403)
    assert.equal(JSON.parse(refused.body).error.code, 'path-not-allowed')

    // Inside the data dir is allowed.
    const inside = fakeResponse()
    await browseRoute.handler(postRequest({ path: dataDir }), inside)
    assert.equal(inside.status, 200)
  })
})

test('the picker prompt cannot inject a PowerShell expression', () => {
  const script = pickScript('directory', '$(Start-Process calc)')
  assert.equal(script.file, 'osascript')
  assert.ok(!script.args.join(' ').includes('$'), 'dollar signs are stripped from the prompt')
})

test('a done report accepts passed/failed aliases as real test evidence', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '公司管理' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '员工管理' }))
    const submit = tools.find(tool => tool.name === 'workbench_submit_plan')
    await submit.execute({
      jobId: 'j1',
      brief: '员工管理',
      tasks: [{ id: 'db', title: '建员工表', owner: 'backend', stage: 'build' }],
    })
    const report = tools.find(tool => tool.name === 'workbench_report_work')
    const result = JSON.parse(await report.execute({
      taskId: 'j1:wi:db',
      event: 'done',
      files: ['db.sql'],
      exitCode: 0,
      passed: 3,
      failed: 0,
      notes: 'green',
    }))
    assert.equal(result.recorded, 'done', 'aliases count as the same machine evidence')

    const board = buildBoard(await createEventLog(join(dataDir, 'events.jsonl')).all())
    const job = board.projects[0].jobs[0]
    assert.equal(job.progress.done, 1)
  })
})
