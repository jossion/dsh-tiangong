import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDelivery, needsRepair, ownerForScope, planHealth, resolveRoute, taskLabel } from '../delivery.js'
import { buildBoard } from '../projects.js'

/** One object that satisfies every stage's schema, so each stage parses it. */
const PLAN = {
  roles: [{ key: 'sales', name: '销售', description: '创建报价单', permissions: ['quote.create'], inherits: [] }],
  permissions: [{ key: 'quote.create', description: '创建报价单' }],
  stack: { frontend: 'react', backend: 'node', database: 'sqlite', rationale: 'boring' },
  entities: [{ key: 'quote', name: '报价单', fields: [] }],
  api: [{ method: 'POST', path: '/quotes', permission: 'quote.create', purpose: '创建' }],
  workItems: [
    { key: 'db', title: '建表', scope: 'database', dependsOn: [], instructions: '建 quote 表' },
    { key: 'api', title: '写接口', scope: 'api', dependsOn: ['db'], instructions: 'POST /quotes' },
  ],
  risks: [],
  questions: ['报价单要不要支持多币种？'],
  summary: '已交付',
  delivered: ['角色与权限'],
  knownGaps: [],
  howToUse: ['打开系统'],
}

function fakeLlm({ route = { id: 'served-model' }, text = JSON.stringify(PLAN), failFinish = null, delayMs = 0 } = {}) {
  return {
    async resolveModelInfo() {
      return route
    },
    stream(options) {
      return (async function* generate() {
        // A slow model keeps a run observably in flight.
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
        // Split across two deltas so the reader has to concatenate.
        const payload = text
        yield { type: 'text-delta', text: payload.slice(0, 12) }
        yield { type: 'text-delta', text: payload.slice(12) }
        yield { type: 'finish', reason: failFinish ?? { kind: 'stop' } }
      })()
    },
  }
}

function fakeStore() {
  const rows = new Map()
  let counter = 0
  return {
    async add(collection, row) {
      counter += 1
      const record = { id: `${collection}_${counter}`, ...row }
      rows.set(record.id, record)
      return record
    },
    async update(collection, id, patch) {
      const record = { ...rows.get(id), ...patch, id }
      rows.set(id, record)
      return record
    },
    async list() {
      return [...rows.values()]
    },
  }
}

function fakeCtx(llm = fakeLlm()) {
  return {
    llm,
    get(name) {
      throw new Error(`cannot get property "${name}" without inject`)
    },
  }
}

async function withDataDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-delivery-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a delivery run records its four decisions and writes artefacts', async () => {
  await withDataDir(async dataDir => {
    const events = []
    const sink = event => events.push(event)
    const delivery = createDelivery({
      ctx: fakeCtx(),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: sink,
      onEvent: sink,
    })

    const result = await delivery.run({ brief: '一个报价单系统' })
    assert.ok(result, 'run resolves to the stored record')

    const decisions = events.filter(event => event.decision !== undefined)
    assert.deepEqual(decisions.map(event => event.decision), [
      'which_skill', 'ask_person', 'keep_result', 'is_done',
    ])
    for (const event of decisions) {
      assert.equal(event.task, '一个报价单系统')
      assert.ok(event.lane, 'every decision names a lane')
      assert.equal(typeof event.confidence, 'number')
    }

    // The open question must park the plan on a person, not push it through.
    const asked = decisions.find(event => event.decision === 'ask_person')
    assert.equal(asked.lane, 'human')
    assert.equal(asked.status, 'waiting')

    const written = JSON.parse(await readFile(join(dataDir, 'deliveries', result.id, 'roles.json'), 'utf8'))
    assert.equal(written.roles[0].key, 'sales')
  })
})

test('a decision sink that throws does not abort the run', async () => {
  await withDataDir(async dataDir => {
    const delivery = createDelivery({
      ctx: fakeCtx(),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: () => {
        throw new Error('audit down')
      },
    })
    await assert.doesNotReject(() => delivery.run({ brief: '随便一个系统' }))
  })
})

test('a failed model finish surfaces as an error, not as empty JSON', async () => {
  await withDataDir(async dataDir => {
    const delivery = createDelivery({
      ctx: fakeCtx(fakeLlm({ failFinish: { kind: 'error', failure: { message: 'provider down' } } })),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
    })
    await assert.rejects(() => delivery.run({ brief: '一个系统' }), /provider down/)
  })
})

test('only one delivery run may be in flight', async () => {
  await withDataDir(async dataDir => {
    const delivery = createDelivery({
      ctx: fakeCtx(fakeLlm({ delayMs: 20 })),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
    })
    const first = delivery.run({ brief: 'A' })
    // Let the first run pass its `store.add` await and claim the slot.
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(delivery.isRunning(), true)
    await assert.rejects(() => delivery.run({ brief: 'B' }), /already in progress/)
    await first
    assert.equal(delivery.isRunning(), false)
  })
})

test('resolveRoute prefers a served configured route', async () => {
  const route = await resolveRoute(fakeCtx(), { provider: 'deepseek-account', model: 'deepseek-flash' })
  assert.deepEqual(route, { provider: 'deepseek-account', model: 'deepseek-flash' })
})

test('resolveRoute falls back to the profile default when config is not served', async () => {
  const ctx = {
    llm: {
      async resolveModelInfo() {
        throw new Error('unknown provider')
      },
      listProviders: () => [{ id: 'deepseek-account' }],
      async listModels() {
        return [{ id: 'deepseek-flash' }]
      },
    },
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-pro' }) }
      }
      throw new Error('nope')
    },
  }
  const route = await resolveRoute(ctx, { provider: 'deepseek', model: 'deepseek-chat' })
  assert.deepEqual(route, { provider: 'deepseek-account', model: 'deepseek-pro' })
})

test('resolveRoute throws a useful error when the profile serves nothing', async () => {
  const ctx = {
    llm: { listProviders: () => [] },
    get() {
      throw new Error('nope')
    },
  }
  await assert.rejects(() => resolveRoute(ctx, {}), /serves no model route/)
})

test('taskLabel turns a brief into a card title', () => {
  assert.equal(taskLabel('一个公司内部的报价单系统。四类人使用：销售、财务。'), '一个公司内部的报价单系统')
  assert.equal(taskLabel('  多  空格   的需求  '), '多 空格 的需求')
  const long = taskLabel('这是一条特别特别特别特别特别特别长的需求描述', 12)
  assert.ok(long.endsWith('…'))
  assert.ok(long.length <= 12)
})

test('a run writes the project board: stages, owners and dependency edges', async () => {
  await withDataDir(async dataDir => {
    const events = []
    const sink = event => events.push(event)
    const delivery = createDelivery({
      ctx: fakeCtx(),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: sink,
      onEvent: sink,
    })

    const result = await delivery.run({ brief: '一个公司内部的报价单系统。四类人使用：销售、财务。' })
    const board = buildBoard(events)
    assert.equal(board.projects.length, 1)

    const project = board.projects[0]
    assert.equal(project.id, result.id)
    assert.equal(project.title, '一个公司内部的报价单系统', 'the brief becomes a short card title, not a paragraph')
    // The rail follows the pipeline, not the order the stages happened to run:
    // build is planned before the review pause, and the board says so.
    assert.deepEqual(project.stages.map(stage => stage.key), [
      'brief', 'roles', 'design', 'build', 'verify', 'report',
    ])

    const build = project.roots.find(task => task.id.endsWith(':build'))
    assert.ok(build, 'the plan becomes a build card')
    assert.equal(build.children.length, 2, 'one card per work item')

    const api = build.children.find(task => task.id.endsWith(':wi:api'))
    assert.equal(api.title, '写接口')
    assert.equal(api.owner, 'backend', 'scope decides the dev agent, not the business role')
    assert.equal(api.role, '后端开发')
    assert.deepEqual(api.blockedBy, [`${project.id}:wi:db`], 'dependsOn becomes a blocking edge')
    assert.equal(api.status, 'todo', 'planned is not built')
    assert.equal(project.totals.blocked, 1, 'the dependent card is visibly stuck')

    assert.deepEqual(project.progress, { done: 5, total: 7, ratio: 0.71 })
    assert.equal(project.gates.length, 1, 'the open question is the one gate')
    assert.equal(project.gates[0].taskId, `${project.id}:verify`)
  })
})

test('work items go to the dev agent whose scope they belong to', () => {
  assert.deepEqual(ownerForScope('database'), { owner: 'backend', role: '后端开发' })
  assert.deepEqual(ownerForScope('api'), { owner: 'backend', role: '后端开发' })
  assert.deepEqual(ownerForScope('frontend'), { owner: 'frontend', role: '前端开发' })
  assert.deepEqual(ownerForScope('tests'), { owner: 'qa', role: 'QA' })
  assert.deepEqual(ownerForScope('unknown'), { owner: 'workbench', role: '规划智能体' })
})

/* ── dependency planning: measure fan-out instead of trusting the model ── */

const SERIAL = {
  ...PLAN,
  workItems: [
    { key: 'a', title: 'A 建表', scope: 'database', dependsOn: [] },
    { key: 'b', title: 'B 接口', scope: 'api', dependsOn: ['a'] },
    { key: 'c', title: 'C 页面', scope: 'frontend', dependsOn: ['b'] },
    { key: 'd', title: 'D 页面', scope: 'frontend', dependsOn: ['c'] },
    { key: 'e', title: 'E 测试', scope: 'tests', dependsOn: ['d'] },
    { key: 'f', title: 'F 测试', scope: 'tests', dependsOn: ['e'] },
  ],
}

const PARALLEL = {
  ...PLAN,
  workItems: [
    { key: 'a', title: 'A 建表', scope: 'database', dependsOn: [] },
    { key: 'b', title: 'B 页面', scope: 'frontend', dependsOn: [] },
    { key: 'c', title: 'C 测试', scope: 'tests', dependsOn: [] },
    { key: 'd', title: 'D 接口', scope: 'api', dependsOn: ['a'] },
    { key: 'e', title: 'E 联调', scope: 'frontend', dependsOn: ['d'] },
    { key: 'f', title: 'F 回归', scope: 'tests', dependsOn: ['b'] },
  ],
}

/** A fake model that answers each call from a script, so stages stay distinct. */
function fakeSequence(texts) {
  let index = 0
  return {
    calls: () => index,
    async resolveModelInfo() {
      return { id: 'served' }
    },
    listProviders: () => [{ id: 'p' }],
    async listModels() {
      return [{ id: 'm' }]
    },
    stream() {
      const text = texts[Math.min(index, texts.length - 1)]
      index += 1
      return (async function* generate() {
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

test('planHealth measures what can start at once', () => {
  assert.deepEqual(planHealth(SERIAL.workItems), { total: 6, ready: 1, blocked: 5, maxChain: 6 })
  assert.equal(planHealth(PARALLEL.workItems).ready, 3)
  assert.equal(planHealth(PARALLEL.workItems).maxChain, 3)
  assert.deepEqual(planHealth(null), { total: 0, ready: 0, blocked: 0, maxChain: 0 })

  // A cycle is a plan bug: report a chain instead of hanging.
  const cyclic = [
    { key: 'a', dependsOn: ['b'] },
    { key: 'b', dependsOn: ['a'] },
  ]
  assert.ok(planHealth(cyclic).maxChain >= 1)
})

test('a plan that can only start one item needs a repair pass', () => {
  assert.equal(needsRepair(planHealth(SERIAL.workItems)), true)
  assert.equal(needsRepair(planHealth(PARALLEL.workItems)), false)
  assert.equal(needsRepair({ total: 3, ready: 1, blocked: 2, maxChain: 3 }), false, 'small plans are allowed to be serial')
})

test('an over-serialized design is repaired once, and the repair is adopted', async () => {
  await withDataDir(async dataDir => {
    const llm = fakeSequence([
      JSON.stringify(PLAN),     // roles
      JSON.stringify(SERIAL),   // design: one item ready
      JSON.stringify(PARALLEL), // repair
      JSON.stringify(PLAN),     // review
      JSON.stringify(PLAN),     // report
    ])
    const events = []
    const sink = event => events.push(event)
    const delivery = createDelivery({
      ctx: fakeCtx(llm),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: sink,
      onEvent: sink,
    })

    const result = await delivery.run({ brief: '一个报价单系统' })
    assert.deepEqual(result.design.workItems.map(item => item.title), PARALLEL.workItems.map(item => item.title))
    assert.equal(planHealth(result.design.workItems).ready, 3)
    assert.equal(llm.calls(), 5, 'roles + design + repair + review + report')

    const done = events.filter(event => event.decision === 'is_done').pop()
    assert.equal(done.evidence.parallel.ready, 3, 'the fan-out is on the record')
  })
})

test('a parallel design is not repaired', async () => {
  await withDataDir(async dataDir => {
    const llm = fakeSequence([
      JSON.stringify(PLAN),
      JSON.stringify(PARALLEL),
      JSON.stringify(PLAN),
      JSON.stringify(PLAN),
    ])
    const delivery = createDelivery({
      ctx: fakeCtx(llm),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: () => {},
      onEvent: () => {},
    })

    const result = await delivery.run({ brief: '一个报价单系统' })
    assert.equal(llm.calls(), 4, 'no repair call when the plan already fans out')
    assert.equal(planHealth(result.design.workItems).ready, 3)
  })
})

test('two runs on one card open two jobs, each with its own ids', async () => {
  await withDataDir(async dataDir => {
    const events = []
    const sink = event => events.push(event)
    const delivery = createDelivery({
      ctx: fakeCtx(),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: sink,
      onEvent: sink,
    })

    const first = await delivery.run({ brief: '员工管理', projectId: 'prj_card' })
    const second = await delivery.run({ brief: '报销流程', projectId: 'prj_card' })

    const jobs = events.filter(event => event.kind === 'job')
    assert.equal(jobs.filter(job => job.event === 'created').length, 2, 'one job opened per run')
    assert.equal(jobs.filter(job => job.event === 'started').length, 2, 'planning completion opens the job for execution')
    assert.deepEqual([...new Set(jobs.map(job => job.projectId))], ['prj_card'], 'both jobs belong to the card')
    assert.equal(new Set(jobs.map(job => job.jobId)).size, 2, 'the jobs have distinct ids')

    const taskIds = events.filter(event => event.kind === 'task').map(event => event.taskId)
    assert.ok(taskIds.some(id => id.startsWith(`${first.id}:`)), 'run one works under its own job id')
    assert.ok(taskIds.some(id => id.startsWith(`${second.id}:`)))

    // The board sees one project with two jobs and no cross-talk.
    const project = buildBoard(events).projects[0]
    assert.equal(project.jobs.length, 2)
    const titles = project.jobs.map(job => job.title).sort()
    assert.deepEqual(titles, ['员工管理', '报销流程'])
    for (const job of project.jobs) {
      assert.ok(job.roots.length > 0)
      assert.ok(job.roots.every(task => task.id.startsWith(`${job.id}:`)), 'job roots stay inside the job')
    }
  })
})

test('a change request is a new job that points at the delivered one', async () => {
  await withDataDir(async dataDir => {
    const events = []
    const delivery = createDelivery({
      ctx: fakeCtx(),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: event => events.push(event),
      onEvent: event => events.push(event),
    })
    await delivery.run({ brief: '修复员工列表导出', projectId: 'prj_card', parentJobId: 'job_old', kind: 'fix' })
    const created = events.find(event => event.kind === 'job' && event.event === 'created')
    assert.equal(created.parentJobId, 'job_old')
    assert.equal(created.jobKind, 'fix')
    const project = buildBoard(events).projects[0]
    const job = project.jobs.find(item => item.id === created.jobId)
    assert.equal(job.parentJobId, 'job_old', 'the lineage survives projection')
    assert.equal(job.kind, 'fix')
  })
})
