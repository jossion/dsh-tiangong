import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {BROWSE_PATH, CONFIG_PATH, CONTINUE_CHILD_TEXT, CONTROL_PATH, DECIDE_PATH, JOB_CONFIG_PATH, PICK_PATH, PROJECTS_PATH, REQUIREMENTS_PATH, START_PATH, STATE_PATH, TASK_PATH, TRANSCRIBE_PATH, apply, pickScript} from '../index.js'
import { createEventLog } from '../events.js'
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

function fakeContext({ withWebServer = true, withLlm = true, connection = null, services = {}, withEvents = false } = {}) {
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

  const listeners = new Map()
  const ctx = {
    ...(withEvents
      ? {
          on(name, listener) {
            const set = listeners.get(name) ?? new Set()
            set.add(listener)
            listeners.set(name, set)
            return () => set.delete(listener)
          },
          emit(name, ...args) {
            for (const listener of listeners.get(name) ?? []) listener(...args)
          },
        }
      : {}),
    // A one-shot read during apply must find nothing, like the real thing.
    get(name) {
      if (Object.prototype.hasOwnProperty.call(services, name)) return services[name]
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

  return withEvents
    ? { ctx, routes, tools, disposers, emit: (name, ...args) => ctx.emit(name, ...args) }
    : { ctx, routes, tools, disposers }
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
      [STATE_PATH, START_PATH, PROJECTS_PATH, CONTROL_PATH, DECIDE_PATH, CONFIG_PATH, JOB_CONFIG_PATH, TASK_PATH, PICK_PATH, BROWSE_PATH, REQUIREMENTS_PATH, TRANSCRIBE_PATH].sort())
    assert.equal(routes.every(route => !route.path.startsWith('/company')), true, 'company routes belong to @jos/company')
    assert.equal(STATE_PATH, '/workbench/state')
    assert.equal(START_PATH, '/workbench/start')
    assert.equal(PROJECTS_PATH, '/workbench/projects')
    assert.equal(CONTROL_PATH, '/workbench/control')
    assert.equal(DECIDE_PATH, '/workbench/decide')
    assert.equal(CONFIG_PATH, '/workbench/project-config')
    assert.equal(JOB_CONFIG_PATH, '/workbench/job-config')
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
      'workbench_delivery_diagnostics', 'workbench_next_work', 'workbench_bind_child',
      'workbench_add_task', 'workbench_report_work',
    ], 'the agent tools still register without a web server')
  })
})

test('both routes disappear when the plugin is disposed', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes, disposers } = fakeContext()
    apply(ctx, { dataDir })
    assert.equal(routes.length, 12)

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

function deleteRequest(body) {
  return {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

test('a project card can be deleted without erasing its history', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)
    const stateRoute = routes.find(route => route.path === STATE_PATH)

    const created = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '公司管理' }), created)
    const { projectId } = JSON.parse(created.body)

    const deleted = fakeResponse()
    await projectsRoute.handler(deleteRequest({ projectId }), deleted)
    assert.equal(deleted.status, 200)
    assert.deepEqual(JSON.parse(deleted.body), { deleted: true, projectId })

    const state = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, state)
    assert.equal(JSON.parse(state.body).board.projects.length, 0, 'the card leaves the board')

    const log = createEventLog(join(dataDir, 'events.jsonl'))
    const lines = await log.all()
    const tombstone = lines.find(line => line.kind === 'project' && line.event === 'deleted')
    assert.ok(tombstone, 'the deletion is an append-only ledger line')
    assert.equal(tombstone.projectId, projectId)

    const again = fakeResponse()
    await projectsRoute.handler(deleteRequest({ projectId }), again)
    assert.equal(again.status, 404, 'deleting twice reports the card is already gone')

    const missing = fakeResponse()
    await projectsRoute.handler(deleteRequest({}), missing)
    assert.equal(missing.status, 400)
    assert.equal(JSON.parse(missing.body).error.code, 'bad-request')
  })
})

test('POST /workbench/requirements records a change request against its delivered job', async () => {
  await withDataDir(async dataDir => {
    // Seed the delivered job before the plugin's log loads, so its in-memory
    // projection contains the parent the change request points at.
    const seed = createEventLog(join(dataDir, 'events.jsonl'))
    await seed.append(projectEvent({ projectId: 'prj_seed', title: '公司管理', event: 'created' }))
    await seed.append(jobEvent({ projectId: 'prj_seed', jobId: 'job_parent', title: '员工管理', event: 'done' }))

    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const requirementsRoute = routes.find(route => route.path === REQUIREMENTS_PATH)
    const projectId = 'prj_seed'

    const accepted = fakeResponse()
    await requirementsRoute.handler(postRequest({
      projectId,
      text: '修复员工列表导出',
      parentJobId: 'job_parent',
      kind: 'fix',
    }), accepted)
    assert.equal(accepted.status, 202)
    const body = JSON.parse(accepted.body)
    assert.equal(body.parentJobId, 'job_parent')
    assert.equal(body.kind, 'fix')

    const lines = (await readFile(join(dataDir, 'events.jsonl'), 'utf8'))
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const child = lines.find(line => line.kind === 'job' && line.jobId === body.jobId)
    assert.equal(child.parentJobId, 'job_parent', 'lineage is on the job line, not the requirement line')
    assert.equal(child.jobKind, 'fix')
    assert.ok(lines.some(line => line.kind === 'requirement' && line.jobId === body.jobId), 'the intake still records the requirement')

    // The projection must carry both lineage and the requirement: the dispatch
    // loop only auto-drives jobs with a requirement, which is what makes a
    // change request run without a manual "start execution" click.
    const board = buildBoard(lines)
    const job = board.projects
      .find(project => project.id === projectId)
      .jobs.find(item => item.id === body.jobId)
    assert.equal(job.parentJobId, 'job_parent')
    assert.equal(job.kind, 'fix')
    assert.ok(job.requirement, 'the follow-up job is managed by the closed loop')

    const unknown = fakeResponse()
    await requirementsRoute.handler(postRequest({ projectId, text: 'x', parentJobId: 'nope' }), unknown)
    assert.equal(unknown.status, 400)
    assert.equal(JSON.parse(unknown.body).error.code, 'unknown-parent-job')

    const badKind = fakeResponse()
    await requirementsRoute.handler(postRequest({ projectId, text: 'x', kind: 'rewrite' }), badKind)
    assert.equal(badKind.status, 400)
    assert.equal(JSON.parse(badKind.body).error.code, 'invalid-requirement')
  })
})

test('handing out a card marks it active so the board shows work in progress', async () => {
  await withDataDir(async dataDir => {
    const seed = createEventLog(join(dataDir, 'events.jsonl'))
    await seed.append(projectEvent({ projectId: 'prj_x', title: '公司管理', event: 'created' }))
    await seed.append(jobEvent({ projectId: 'prj_x', jobId: 'job_x', title: '贪吃蛇', event: 'created', sessionId: 's1' }))
    await seed.append(taskEvent({
      event: 'created', taskId: 'job_x:wi:logic', projectId: 'prj_x', jobId: 'job_x',
      stage: 'build', owner: 'backend', title: '逻辑层',
    }))

    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir })
    const next = tools.find(tool => tool.name === 'workbench_next_work')
    const first = JSON.parse(await next.execute({ jobId: 'job_x' }))
    assert.deepEqual(first.work.map(item => item.taskId), ['job_x:wi:logic'])
    assert.equal(first.work[0].status, 'todo')

    const lines = (await readFile(join(dataDir, 'events.jsonl'), 'utf8'))
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const claims = () => lines.filter(line => line.kind === 'task' && line.event === 'claimed' && line.taskId === 'job_x:wi:logic')
    assert.equal(claims().length, 1, 'the handed-out card is claimed once')

    const board = buildBoard(lines)
    const job = board.projects[0].jobs.find(item => item.id === 'job_x')
    const card = job.roots.find(item => item.id === 'job_x:wi:logic')
    assert.equal(card.status, 'active', 'the board stops saying todo while the child runs')

    // A second dispatch round must not stack a second claim on the same card.
    await next.execute({ jobId: 'job_x' })
    const after = (await readFile(join(dataDir, 'events.jsonl'), 'utf8'))
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    assert.equal(
      after.filter(line => line.kind === 'task' && line.event === 'claimed' && line.taskId === 'job_x:wi:logic').length,
      1,
      'a running card is not claimed twice',
    )
  })
})


test('POST /workbench/transcribe hands audio to the host recognizer', async () => {
  await withDataDir(async dataDir => {
    const calls = []
    const speechToText = {
      snapshot: () => ({ providers: [{ id: 'sensevoice-local', name: 'SenseVoice', preparation: { phase: 'ready' } }], selection: { providerId: 'sensevoice-local', language: 'zh' } }),
      resolve: request => {
        calls.push(request.audio.length)
        return { audio: request.audio, provider: { id: 'sensevoice-local' } }
      },
      async transcribe() {
        return { text: '把蛇改成真蛇', audioSeconds: 1.4, inferenceSeconds: 0.2 }
      },
    }
    const { ctx, routes } = fakeContext({ services: { speechToText } })
    apply(ctx, { dataDir })
    const route = routes.find(item => item.path === TRANSCRIBE_PATH)
    assert.ok(route, 'the panel has a transcription route')

    const response = fakeResponse()
    await route.handler(postRequest({ audio: Buffer.from('RIFFxxxxWAVE').toString('base64') }), response)
    assert.equal(response.status, 200)
    const body = JSON.parse(response.body)
    assert.equal(body.text, '把蛇改成真蛇')
    assert.deepEqual(calls, [12], 'the decoded bytes reach the recognizer')

    // The state route exposes whether a microphone makes sense at all.
    const stateRoute = routes.find(item => item.path === STATE_PATH)
    const state = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, state)
    assert.equal(JSON.parse(state.body).speech.available, true)
  })
})

test('transcription without a host recognizer reports a clean 501', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const route = routes.find(item => item.path === TRANSCRIBE_PATH)
    const response = fakeResponse()
    await route.handler(postRequest({ audio: 'AAAA' }), response)
    assert.equal(response.status, 501)
    assert.equal(JSON.parse(response.body).error.code, 'speech-unavailable')
  })
})

test('a project carries a capability profile and seeds its workspace', async () => {
  await withDataDir(async dataDir => {
    const workspace = join(dataDir, 'proj-software')
    mkdirSync(workspace, { recursive: true })
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)

    const created = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '公司管理', kind: 'software', workspace }), created)
    assert.equal(created.status, 201)
    const body = JSON.parse(created.body)
    assert.equal(body.kind, 'software')
    assert.equal(body.profile.preset, 'workbench-software')
    assert.deepEqual(body.template.sort(), ['AGENTS.md', 'docs/README.md'].sort(), 'the workspace gets its rule skeleton')

    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')
    assert.match(text, /项目约定/)
    await readFile(join(workspace, 'docs', 'README.md'), 'utf8')

    // The ledger is the source of truth: the kind and profile are recorded.
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    const line = (await log.all()).find(item => item.kind === 'project' && item.projectId === body.projectId)
    assert.equal(line.projectKind, 'software')
    assert.equal(line.profile.preset, 'workbench-software')

    // The board projection exposes it to the panel.
    const stateRoute = routes.find(route => route.path === STATE_PATH)
    const state = fakeResponse()
    await stateRoute.handler({ method: 'GET' }, state)
    const project = JSON.parse(state.body).board.projects[0]
    assert.equal(project.projectKind, 'software')
    assert.equal(project.profile.preset, 'workbench-software')

    // A second create does not overwrite the seeded AGENTS.md.
    await projectsRoute.handler(postRequest({ name: '文案项目', kind: 'copy', workspace }), created)
    const copy = JSON.parse(created.body)
    assert.equal(copy.kind, 'copy')
    assert.equal(copy.profile.preset, 'workbench-copy')
    assert.match(await readFile(join(workspace, 'AGENTS.md'), 'utf8'), /软件交付/, 'existing template files stay untouched')
  })
})

test('a bad project kind or workspace is refused', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    const projectsRoute = routes.find(route => route.path === PROJECTS_PATH)

    const unknown = fakeResponse()
    await projectsRoute.handler(postRequest({ name: 'x', kind: 'nope' }), unknown)
    assert.equal(unknown.status, 400)
    assert.equal(JSON.parse(unknown.body).error.code, 'unknown-kind')

    const missing = fakeResponse()
    await projectsRoute.handler(postRequest({ name: 'x', kind: 'software', workspace: join(dataDir, 'does-not-exist') }), missing)
    assert.equal(missing.status, 400)
    assert.equal(JSON.parse(missing.body).error.code, 'bad-workspace')

    // Omitting the kind keeps old callers working, with the custom profile.
    const legacy = fakeResponse()
    await projectsRoute.handler(postRequest({ name: '旧项目' }), legacy)
    assert.equal(legacy.status, 201)
    assert.equal(JSON.parse(legacy.body).kind, 'custom')
    assert.equal(JSON.parse(legacy.body).profile.preset, null)
  })
})


test('workbench_bind_child records the child session that carries a card', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '量化', ts: '2026-11-05T00:00:00.000Z' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '二期', ts: '2026-11-05T00:00:01.000Z' }))
    await log.append(taskEvent({
      event: 'created', taskId: 'j1:wi:a', projectId: 'p1', jobId: 'j1',
      stage: 'build', owner: 'backend', title: '契约', ts: '2026-11-05T00:00:02.000Z',
    }))

    const bind = tools.find(tool => tool.name === 'workbench_bind_child')
    assert.ok(bind, 'the bind tool is registered')
    const result = JSON.parse(await bind.execute({ taskId: 'j1:wi:a', childSessionId: 'child-1' }))
    assert.equal(result.ok, true)
    assert.equal(result.childSessionId, 'child-1')

    const lines = (await createEventLog(join(dataDir, 'events.jsonl')).all())
    const line = lines.find(item => item.kind === 'task' && item.event === 'child' && item.taskId === 'j1:wi:a')
    assert.equal(line.childSessionId, 'child-1')
    const card = buildBoard(lines).projects[0].jobs[0].roots.find(item => item.id === 'j1:wi:a')
    assert.equal(card.childSessionId, 'child-1', 'the board exposes the binding')

    const unknown = await bind.execute({ taskId: 'nope', childSessionId: 'child-2' }).then(() => null, error => error)
    assert.match(String(unknown?.message ?? unknown), /unknown task/)
  })
})

test('pausing a job with bound children records a checkpoint and cancels the child', async () => {
  await withDataDir(async dataDir => {
    const calls = { interrupt: [], message: [], prompt: [] }
    const agent = { id: 's1' }
    const { ctx, tools, routes } = fakeContext({
      services: {
        agents: { get: id => (id === 's1' ? agent : undefined) },
        subagents: {
          interrupt(target, authority) { calls.interrupt.push({ target, authority }) },
          async sendMessage(sender, targetId, content) {
            calls.message.push({ sender, targetId, content })
            return 'msg-1'
          },
        },
        sessionController: {
          async prompt(request) { calls.prompt.push(request); return { accepted: true } },
        },
      },
    })
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '量化', ts: '2026-11-05T00:00:00.000Z' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '二期', sessionId: 's1', ts: '2026-11-05T00:00:01.000Z' }))
    await log.append(taskEvent({
      event: 'created', taskId: 'j1:wi:a', projectId: 'p1', jobId: 'j1',
      stage: 'build', owner: 'backend', title: '契约', ts: '2026-11-05T00:00:02.000Z',
    }))
    await log.append(taskEvent({ event: 'claimed', taskId: 'j1:wi:a', ts: '2026-11-05T00:00:03.000Z' }))
    await tools.find(tool => tool.name === 'workbench_bind_child').execute({ taskId: 'j1:wi:a', childSessionId: 'child-1' })

    const control = routes.find(route => route.path === CONTROL_PATH)
    const response = fakeResponse()
    await control.handler(postRequest({ projectId: 'p1', jobId: 'j1', action: 'pause' }), response)
    assert.equal(response.status, 200)

    const lines = await createEventLog(join(dataDir, 'events.jsonl')).all()
    const job = lines.filter(item => item.kind === 'job' && item.jobId === 'j1')
    assert.ok(job.some(item => item.event === 'paused'))
    const checkpoint = lines.find(item => item.kind === 'task' && item.event === 'progress' && item.taskId === 'j1:wi:a')
    assert.ok(checkpoint, 'pause writes a checkpoint on the in-flight card')
    assert.match(checkpoint.notes, /paused; child session child-1 interrupted/)
    assert.equal(calls.interrupt.length, 1, 'pause interrupts the exact child')
    assert.equal(calls.interrupt[0].target, 'child-1')
    assert.equal(calls.interrupt[0].authority.kind, 'ancestor')
    assert.equal(calls.interrupt[0].authority.agent, agent)

    // Resuming messages the same child with "continue", not a fresh card run.
    await control.handler(postRequest({ projectId: 'p1', jobId: 'j1', action: 'resume' }), fakeResponse())
    assert.equal(calls.message.length, 1)
    assert.equal(calls.message[0].sender, agent)
    assert.equal(calls.message[0].targetId, 'child-1')
    assert.equal(calls.message[0].content[0].text, CONTINUE_CHILD_TEXT)
    const resumedLine = (await createEventLog(join(dataDir, 'events.jsonl')).all())
      .filter(item => item.kind === 'task' && item.event === 'progress' && item.taskId === 'j1:wi:a').at(-1)
    assert.match(resumedLine.notes, /resumed; child session child-1 continued/)
  })
})



test('a child bound while its job is paused is stopped immediately', async () => {
  await withDataDir(async dataDir => {
    const calls = { interrupt: [] }
    const agent = { id: 's1' }
    const { ctx, tools, routes } = fakeContext({
      services: {
        agents: { get: id => (id === 's1' ? agent : undefined) },
        subagents: { interrupt(target, authority) { calls.interrupt.push({ target, authority }) } },
        sessionController: { async prompt() { return { accepted: true } } },
      },
    })
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '量化', ts: '2026-11-05T00:00:00.000Z' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '二期', sessionId: 's1', ts: '2026-11-05T00:00:01.000Z' }))
    await log.append(taskEvent({
      event: 'created', taskId: 'j1:wi:a', projectId: 'p1', jobId: 'j1',
      stage: 'build', owner: 'backend', title: '契约', ts: '2026-11-05T00:00:02.000Z',
    }))

    const control = routes.find(route => route.path === CONTROL_PATH)
    await control.handler(postRequest({ projectId: 'p1', jobId: 'j1', action: 'pause' }), fakeResponse())
    // Pause ran before the child id was known; the binding arrives afterwards.
    const bind = tools.find(tool => tool.name === 'workbench_bind_child')
    const bound = JSON.parse(await bind.execute({ taskId: 'j1:wi:a', childSessionId: 'child-9' }))
    assert.equal(bound.paused, true)
    assert.equal(calls.interrupt.length, 1, 'the late child is interrupted right away')
    assert.equal(calls.interrupt[0].target, 'child-9')
    assert.equal(calls.interrupt[0].authority.kind, 'ancestor')
    const lines = await createEventLog(join(dataDir, 'events.jsonl')).all()
    const note = lines.filter(item => item.kind === 'task' && item.event === 'progress' && item.taskId === 'j1:wi:a').at(-1)
    assert.match(note.notes, /bound after pause/)
  })
})

test('binding a child applies the project mask to that child agent', async () => {
  await withDataDir(async dataDir => {
    const applied = []
    const tools = {
      schemas: () => [{ name: 'bash' }, { name: 'cua_driver_native__list_windows' }],
      restrict: filter => applied.push(filter),
    }
    const child = { id: 'child-7', ctx: { get: name => (name === 'tools' ? tools : undefined) } }
    const { ctx, tools: registered } = fakeContext({
      services: { agents: { get: id => (id === 'child-7' ? child : undefined) } },
    })
    apply(ctx, { dataDir })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '量化', projectKind: 'software', ts: '2026-11-05T00:00:00.000Z' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '二期', sessionId: 's1', ts: '2026-11-05T00:00:01.000Z' }))
    await log.append(taskEvent({
      event: 'created', taskId: 'j1:wi:a', projectId: 'p1', jobId: 'j1',
      stage: 'build', owner: 'backend', title: '契约', ts: '2026-11-05T00:00:02.000Z',
    }))

    const bind = registered.find(tool => tool.name === 'workbench_bind_child')
    const result = JSON.parse(await bind.execute({ taskId: 'j1:wi:a', childSessionId: 'child-7' }))
    assert.equal(result.ok, true)
    assert.ok(result.policy.denied.includes('cua_driver_native__list_windows'), 'the child is told which tools are masked')
    assert.equal(applied.length, 1)
    assert.ok(applied[0].deny.includes('cua_driver_native__list_windows'))
    assert.ok(!applied[0].deny.includes('bash'))
  })
})


test('a skill loaded by a card child is recorded on that card', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools, emit } = fakeContext({ withEvents: true })
    apply(ctx, { dataDir, autoRun: false })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '量化', ts: '2026-11-05T00:00:00.000Z' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '二期', sessionId: 's1', ts: '2026-11-05T00:00:01.000Z' }))
    await log.append(taskEvent({
      event: 'created', taskId: 'j1:wi:a', projectId: 'p1', jobId: 'j1',
      stage: 'build', owner: 'backend', title: '契约', ts: '2026-11-05T00:00:02.000Z',
    }))
    const bind = tools.find(tool => tool.name === 'workbench_bind_child')
    await bind.execute({ taskId: 'j1:wi:a', childSessionId: 'child-1' })

    emit('tools/result', { name: 'skill', arguments: { name: 'office' }, agent: { id: 'child-1' } })
    emit('tools/result', { name: 'skill', arguments: { name: 'office' }, agent: { id: 'child-1' } })
    await new Promise(resolve => setTimeout(resolve, 120))

    const lines = await createEventLog(join(dataDir, 'events.jsonl')).all()
    const skills = lines.filter(line => line.kind === 'task' && line.event === 'skill')
    assert.equal(skills.length, 1, 'the same skill is recorded once')
    assert.equal(skills[0].skill, 'office')
    assert.equal(skills[0].taskId, 'j1:wi:a')
    const card = buildBoard(lines).projects[0].jobs[0].roots.find(item => item.id === 'j1:wi:a')
    assert.deepEqual(card.skills, ['office'])
  })
})

test('a report can name the skills the child loaded', async () => {
  await withDataDir(async dataDir => {
    const { ctx, tools } = fakeContext()
    apply(ctx, { dataDir, autoRun: false })
    const log = createEventLog(join(dataDir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'p1', title: '量化', ts: '2026-11-05T00:00:00.000Z' }))
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', title: '二期', sessionId: 's1', ts: '2026-11-05T00:00:01.000Z' }))
    await log.append(taskEvent({
      event: 'created', taskId: 'j1:wi:a', projectId: 'p1', jobId: 'j1',
      stage: 'build', owner: 'backend', title: '契约', ts: '2026-11-05T00:00:02.000Z',
    }))
    const report = tools.find(tool => tool.name === 'workbench_report_work')
    await report.execute({ taskId: 'j1:wi:a', event: 'progress', notes: 'halfway', skills: ['office'] })
    const lines = await createEventLog(join(dataDir, 'events.jsonl')).all()
    const skill = lines.find(item => item.kind === 'task' && item.event === 'skill' && item.skill === 'office')
    assert.ok(skill, 'the reported skill lands in the ledger')
    assert.equal(skill.taskId, 'j1:wi:a')
  })
})
