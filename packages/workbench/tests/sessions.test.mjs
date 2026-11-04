import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSessionBridge, userMessage } from '../sessions.js'

const config = (dir, extra = {}) => ({ dataDir: dir, appsRoot: join(dir, 'apps'), ...extra })

function fakeCtx(services) {
  return {
    get(name) {
      return services[name]
    },
  }
}

const noEvents = { append: async () => {} }

test('a wake message has the shape the session log stores', () => {
  const message = userMessage('hello')
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'user')
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.content[0].text, 'hello')
  assert.equal(typeof message.id, 'string')
})

test('the first requirement creates one session, one agent and a workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const created = { agents: [] }
    const ctx = fakeCtx({
      agents: {
        async create(options) {
          created.agents.push(options)
          return { agent: { id: options.sessionId } }
        },
      },
    })
    const bridge = createSessionBridge({
      ctx,
      config: config(dir, { agentPreset: 'agent-team', provider: 'deepseek', model: 'flash' }),
      events: noEvents,
      now: () => 1_000,
    })

    const result = await bridge.ensureProjectSession({ id: 'p1', title: '公司管理' })
    assert.equal(result.ok, true)
    assert.equal(result.created, true)
    assert.match(result.sessionId, /^session-[0-9a-f-]{36}$/)
    assert.equal(result.workspace, join(dir, 'apps', 'p1'))
    assert.equal(result.workspaceId, null, 'no registry service: no workspace id, path still created')
    await stat(join(dir, 'apps', 'p1'))

    assert.equal(created.agents.length, 1)
    const options = created.agents[0]
    assert.equal(options.sessionId, result.sessionId, 'the factory creates the session it is given')
    assert.equal(options.meta.cwd, join(dir, 'apps', 'p1'))
    assert.equal(options.meta.agentPreset, 'agent-team')

    // A project that already has a session reuses it: no second agent.
    const again = await bridge.ensureProjectSession({ id: 'p1', title: '公司管理', sessionId: result.sessionId })
    assert.equal(again.ok, true)
    assert.equal(again.created, false)
    assert.equal(created.agents.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a project session degrades to a reported error without host services', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const bridge = createSessionBridge({
      ctx: fakeCtx({}),
      config: config(dir),
      events: noEvents,
      now: () => 1_000,
    })
    const result = await bridge.ensureProjectSession({ id: 'p1' })
    assert.equal(result.ok, false)
    assert.match(result.error, /session controller and agents service unavailable/)
    // The workspace path is still prepared so a later restart needs no migration.
    assert.equal(result.workspace, join(dir, 'apps', 'p1'))
    await stat(join(dir, 'apps', 'p1'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('waking an agent delivers one user message and flushes the session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const wake = { messages: [], flushed: 0 }
    const agent = {
      id: 'sess-1',
      session: { id: 'sess-1' },
      followup(message) {
        wake.messages.push(message)
      },
    }
    const ctx = fakeCtx({
      agents: { get: () => agent },
      sessions: { async flush(session) { wake.flushed += 1; assert.equal(session.id, 'sess-1') } },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })

    const result = await bridge.wake('sess-1', 'do the work')
    assert.equal(result.ok, true)
    assert.equal(wake.messages.length, 1)
    assert.equal(wake.messages[0].role, 'user')
    assert.equal(wake.messages[0].content[0].text, 'do the work')
    assert.equal(wake.flushed, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('wake failures are returned, never thrown into the loop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const bridge = createSessionBridge({ ctx: fakeCtx({}), config: config(dir), events: noEvents, now: () => 1_000 })
    assert.equal((await bridge.wake('sess-1', 'x')).ok, false)
    assert.equal((await bridge.wake('', 'x')).ok, false)
    assert.match((await bridge.wake('sess-1', 'x')).error, /no live agent/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the session controller creates the delivery session with a mounted preset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const captured = []
    const ctx = fakeCtx({
      sessionController: {
        async create(request) {
          captured.push(request)
          return { sessionId: 'session-abc', agentPreset: request.agentPreset }
        },
      },
      workspaceRegistry: {
        async create() {
          return { id: 'ws_1' }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })

    const result = await bridge.ensureProjectSession({ id: 'p1', title: '公司管理' })
    assert.equal(result.ok, true)
    assert.equal(result.sessionId, 'session-abc')
    assert.equal(result.agentPreset, null, 'an unconfigured preset is left to the deployment default')
    assert.equal(captured[0].agentPreset, undefined, 'the controller mounts the deployment default')
    assert.equal(captured.length, 1)
    assert.equal(captured[0].workspaceId, 'ws_1', 'a registered workspace is addressed by id')
    assert.equal(captured[0].cwd, undefined, 'workspaceId and cwd are mutually exclusive')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('waking prefers the session controller, which mounts the deployment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const prompted = []
    const ctx = fakeCtx({
      sessionController: {
        async prompt(request) {
          prompted.push(request)
          return { accepted: true }
        },
        async create() {
          return { sessionId: 'session-abc' }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })

    const result = await bridge.wake('session-abc', 'do the work')
    assert.equal(result.ok, true)
    assert.equal(result.via, 'session-controller')
    assert.equal(prompted.length, 1)
    assert.equal(prompted[0].sessionId, 'session-abc')
    assert.equal(prompted[0].mode, 'queue')
    assert.equal(prompted[0].content[0].text, 'do the work')
    assert.equal(typeof prompted[0].requestId, 'string')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a reminder can steer the running turn instead of queueing behind it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const prompted = []
    const ctx = fakeCtx({
      sessionController: {
        async prompt(request) {
          prompted.push(request)
          return { accepted: true }
        },
        async create() {
          return { sessionId: 'session-abc' }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })

    const result = await bridge.wake('session-abc', 'hurry up', { deliver: 'steer' })
    assert.equal(result.ok, true)
    assert.equal(prompted[0].mode, 'steer', 'a reminder reaches the running turn, not the next one')
    assert.equal(prompted[0].content[0].text, 'hurry up')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a workspace registered by a failed attempt is reused on the next try', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const captured = []
    let creates = 0
    const ctx = fakeCtx({
      workspaceRegistry: {
        async create() {
          creates += 1
          throw new Error('already exists')
        },
        async resolveByPath() {
          return { id: 'ws_existing' }
        },
      },
      sessionController: {
        async create(request) {
          captured.push(request)
          return { sessionId: 'session-abc' }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })
    const result = await bridge.ensureProjectSession({ id: 'p1' })
    assert.equal(result.ok, true)
    assert.equal(creates, 1)
    assert.equal(captured[0].workspaceId, 'ws_existing')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('without a workspace id the session is created by cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const captured = []
    const ctx = fakeCtx({
      sessionController: {
        async create(request) {
          captured.push(request)
          return { sessionId: 'session-abc' }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })
    await bridge.ensureProjectSession({ id: 'p1' })
    assert.equal(captured[0].cwd, join(dir, 'apps', 'p1'))
    assert.equal(captured[0].workspaceId, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a fresh session gets the deployment default model selected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const selected = []
    const ctx = fakeCtx({
      agentDefaultModel: {
        currentSelection() {
          return { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' }
        },
      },
      sessionController: {
        async create() {
          return { sessionId: 'session-abc' }
        },
        async selectModel(request) {
          selected.push(request)
          return { selected: { provider: request.provider, model: request.model } }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })
    const result = await bridge.ensureProjectSession({ id: 'p1' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
    assert.equal(selected.length, 1)
    assert.equal(selected[0].sessionId, 'session-abc')
    assert.equal(selected[0].provider, 'deepseek-account')
    assert.equal(selected[0].model, 'deepseek-flash')
    assert.equal(selected[0].reasoningEffort, 'high')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('model selection falls back to the model catalog default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const selected = []
    const ctx = fakeCtx({
      sessionController: {
        async create() {
          return { sessionId: 'session-abc' }
        },
        async modelCatalog() {
          return { default: { provider: 'deepseek-account', model: 'deepseek-flash' } }
        },
        async selectModel(request) {
          selected.push(request)
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })
    const result = await bridge.ensureProjectSession({ id: 'p1' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.model, { provider: 'deepseek-account', model: 'deepseek-flash' })
    assert.equal(selected[0].model, 'deepseek-flash')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('waking a session created without a model selects one first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const order = []
    const ctx = fakeCtx({
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
      sessionController: {
        async selectModel(request) {
          order.push(`select:${request.model}`)
        },
        async prompt() {
          order.push('prompt')
          return { accepted: true }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })
    const result = await bridge.wake('session-abc', 'go')
    assert.equal(result.ok, true)
    assert.deepEqual(order, ['select:deepseek-flash', 'prompt'])

    order.length = 0
    await bridge.wake('session-abc', 'again')
    assert.deepEqual(order, ['prompt'], 'the model is selected once per session')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('waking mounts the deployment preset before delivering the prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const order = []
    const ctx = fakeCtx({
      agentPresets: {
        async resolve() {
          return { id: 'cordis' }
        },
        async select(agent, presetId) {
          order.push(`preset:${presetId}:${agent.id}`)
          return presetId
        },
      },
      sessionController: {
        async resolveAgent() {
          return { agent: { id: 'session-abc' } }
        },
        async prompt() {
          order.push('prompt')
          return { accepted: true }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })
    const result = await bridge.wake('session-abc', 'go')
    assert.equal(result.ok, true)
    assert.deepEqual(order, ['preset:cordis:session-abc', 'prompt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('session usage is folded from persisted assistant messages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const ctx = fakeCtx({
      sessionController: {
        async inspect() {
          return {
            events: [
              { type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 2 } } },
              { type: 'tool/result', data: {} },
              { type: 'assistant/message', data: { usage: { inputTokens: 5, outputTokens: 1 } } },
            ],
          }
        },
      },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir), events: noEvents, now: () => 1_000 })
    assert.deepEqual(await bridge.measureUsage('session-abc'), {
      inputTokens: 15, outputTokens: 3, messages: 2,
    })
    assert.equal(await bridge.measureUsage(''), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a project type chooses the preset and masks its global tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-sessions-'))
  try {
    const created = []
    const restricted = []
    const agent = {
      id: 'session-new',
      ctx: {
        get(name) {
          if (name !== 'tools') return undefined
          return {
            schemas: () => [{ name: 'blender_render' }, { name: 'workbench_state' }, { name: 'spawn_teammate' }],
            restrict: filter => { restricted.push(filter) },
          }
        },
      },
    }
    const ctx = fakeCtx({
      sessionController: {
        async create(options) {
          created.push(options)
          return { sessionId: 'session-new', agentPreset: options.agentPreset }
        },
        async resolveAgent() { return { agent } },
        async selectModel() { return {} },
        async modelCatalog() { return { default: { provider: 'deepseek', model: 'flash' } } },
      },
      agentPresets: {
        async resolve(wanted) { return { id: wanted ?? 'standard' } },
        async select() {},
      },
      agents: { get: () => agent },
    })
    const bridge = createSessionBridge({ ctx, config: config(dir, { agentPreset: 'fallback' }), events: noEvents, now: () => 1_000 })
    const result = await bridge.ensureProjectSession({
      id: 'p1', title: '文案项目', projectKind: 'copy',
      profile: (await import('../profiles.js')).resolveProjectProfile('copy'),
    })
    assert.equal(result.ok, true)
    assert.equal(created[0].agentPreset, 'workbench-copy', 'the project profile picks the preset')
    assert.deepEqual(restricted, [{ deny: ['blender_render', 'spawn_teammate'] }], 'only registered global names are denied')
    assert.equal(result.policy.applied, true)

    // custom keeps the deployment fallback and masks nothing
    const custom = await bridge.ensureProjectSession({
      id: 'p2', title: '自定义', projectKind: 'custom',
      profile: (await import('../profiles.js')).resolveProjectProfile('custom'),
    })
    assert.equal(custom.ok, true)
    assert.equal(created[1].agentPreset, 'fallback')
    assert.equal(restricted.length, 1, 'custom adds no mask')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
