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
    const created = { sessions: 0, agents: [] }
    const ctx = fakeCtx({
      sessions: {
        create() {
          created.sessions += 1
          return { id: 'sess-1' }
        },
        async flush() {},
      },
      agents: {
        async create(options) {
          created.agents.push(options)
          return { agent: { id: 'sess-1' } }
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
    assert.equal(result.sessionId, 'sess-1')
    assert.equal(result.workspace, join(dir, 'apps', 'p1'))
    assert.equal(result.workspaceId, null, 'no registry service: no workspace id, path still created')
    await stat(join(dir, 'apps', 'p1'))

    assert.equal(created.sessions, 1)
    assert.equal(created.agents.length, 1)
    const options = created.agents[0]
    assert.equal(options.sessionId, 'sess-1')
    assert.equal(options.meta.cwd, join(dir, 'apps', 'p1'))
    assert.equal(options.meta.agentPreset, 'agent-team')
    assert.deepEqual(options.agentOptions, { provider: 'deepseek', model: 'flash' })

    // A project that already has a session reuses it: no second session/agent.
    const again = await bridge.ensureProjectSession({ id: 'p1', title: '公司管理', sessionId: 'sess-1' })
    assert.equal(again.ok, true)
    assert.equal(again.created, false)
    assert.equal(created.sessions, 1)
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
    assert.match(result.error, /sessions service unavailable/)
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
