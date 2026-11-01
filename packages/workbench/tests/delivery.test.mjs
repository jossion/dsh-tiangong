import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDelivery, resolveRoute } from '../delivery.js'

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
    const decisions = []
    const delivery = createDelivery({
      ctx: fakeCtx(),
      config: { provider: 'p', model: 'm', dataDir },
      store: fakeStore(),
      onDecision: event => decisions.push(event),
    })

    const result = await delivery.run({ brief: '一个报价单系统' })
    assert.ok(result, 'run resolves to the stored record')

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
