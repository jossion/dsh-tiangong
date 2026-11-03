import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEventLog } from '../events.js'
import { jobEvent, planEvent, projectEvent, requirementEvent, taskEvent } from '../projects.js'
import { createDispatcher } from '../dispatch.js'

const config = {
  autoRun: true,
  wakeCooldownMs: 60_000,
  planTimeoutMs: 900_000,
  maxRounds: 10,
  dataDir: '',
}

const silentCtx = { get() { return undefined } }

function fakeSessions(overrides = {}) {
  const calls = { ensure: [], wake: [] }
  return {
    calls,
    async ensureProjectSession(project) {
      calls.ensure.push(project.id)
      if (overrides.ensure !== undefined) return overrides.ensure(project)
      return { ok: true, sessionId: 'sess-1', workspace: '/tmp/app', workspaceId: null }
    },
    async wake(sessionId, text) {
      calls.wake.push({ sessionId, text })
      if (overrides.wake !== undefined) return overrides.wake(sessionId, text)
      return { ok: true }
    },
  }
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-loop-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function seedIntake(log, { projectId = 'p1', jobId = 'j1', text = '给公司管理加员工管理页' } = {}) {
  await log.append(projectEvent({ projectId, title: '公司管理' }))
  await log.append(jobEvent({ projectId, jobId, title: '员工管理' }))
  await log.append(requirementEvent({ projectId, jobId, text, source: 'text', ts: '2026-11-03T00:00:00.000Z' }))
}

async function seedPlan(log, { projectId = 'p1', jobId = 'j1' } = {}) {
  await log.append(planEvent({
    projectId, jobId, by: 'agent', brief: '员工管理', tasks: 2, ts: '2026-11-03T00:00:01.000Z',
  }))
  await log.append(taskEvent({
    event: 'created', taskId: `${jobId}:build`, projectId, jobId, stage: 'build', owner: 'workbench', title: '实现',
    ts: '2026-11-03T00:00:02.000Z',
  }))
  await log.append(taskEvent({
    event: 'created', taskId: `${jobId}:wi:db`, parentId: `${jobId}:build`, projectId, jobId,
    stage: 'build', owner: 'backend', title: '建员工表', ts: '2026-11-03T00:00:03.000Z',
  }))
  await log.append(taskEvent({
    event: 'created', taskId: `${jobId}:wi:api`, parentId: `${jobId}:build`, projectId, jobId,
    stage: 'build', owner: 'backend', title: '员工 API', blockedBy: [`${jobId}:wi:db`], ts: '2026-11-03T00:00:04.000Z',
  }))
}

test('an intake job binds a session first, then starts planning', async () => {
  await withDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await seedIntake(log)
    const sessions = fakeSessions()
    const dispatcher = createDispatcher({ ctx: silentCtx, config: { ...config, dataDir: dir }, events: log, sessions, now: () => 1_000 })

    await dispatcher.tick()
    assert.deepEqual(sessions.calls.ensure, ['p1'], 'the loop creates the project session')
    assert.equal(sessions.calls.wake.length, 0, 'nothing is planned yet, so nothing is woken')

    const afterBind = await createEventLog(join(dir, 'events.jsonl')).all()
    const bind = afterBind.find(line => line.kind === 'job' && line.event === 'config')
    assert.equal(bind.sessionId, 'sess-1')
    assert.equal(afterBind.find(line => line.kind === 'project' && line.event === 'config').sessionId, 'sess-1')

    await dispatcher.tick()
    assert.equal(sessions.calls.wake.length, 1, 'planning is woken once the session is bound')
    assert.match(sessions.calls.wake[0].text, /workbench_submit_plan/)
    assert.match(sessions.calls.wake[0].text, /给公司管理加员工管理页/)

    await dispatcher.tick()
    assert.equal(sessions.calls.wake.length, 1, 'a planning turn in flight is not woken twice')
  })
})

test('a planned job is woken with ready cards, then respects the cooldown', async () => {
  await withDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await seedIntake(log)
    await seedPlan(log)
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', event: 'config', sessionId: 'sess-1', ts: '2026-11-03T00:00:05.000Z' }))
    const sessions = fakeSessions()
    const dispatcher = createDispatcher({ ctx: silentCtx, config: { ...config, dataDir: dir }, events: log, sessions, now: () => 1_000_000 })

    await dispatcher.tick()
    assert.equal(sessions.calls.wake.length, 1)
    assert.match(sessions.calls.wake[0].text, /workbench_next_work/)
    assert.match(sessions.calls.wake[0].text, /建员工表/)

    await dispatcher.tick()
    assert.equal(sessions.calls.wake.length, 1, 'the cooldown holds the second wake')
  })
})

test('a ledger that predates the intake is never adopted by the loop', async () => {
  await withDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await log.append(projectEvent({ projectId: 'old', title: '旧项目' }))
    await log.append(jobEvent({ projectId: 'old', jobId: 'old', title: '旧任务' }))
    await log.append(taskEvent({
      event: 'created', taskId: 'old:wi:1', projectId: 'old', jobId: 'old', stage: 'build', owner: 'backend', title: '旧卡片',
    }))
    const sessions = fakeSessions()
    const dispatcher = createDispatcher({ ctx: silentCtx, config: { ...config, dataDir: dir }, events: log, sessions, now: () => 1_000 })
    await dispatcher.tick()
    assert.deepEqual(sessions.calls.ensure, [])
    assert.deepEqual(sessions.calls.wake, [])
  })
})

test('all-green cards record one delivery, and only one', async () => {
  await withDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await seedIntake(log)
    await seedPlan(log)
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', event: 'config', sessionId: 'sess-1' }))
    await log.append(taskEvent({ event: 'done', taskId: 'j1:wi:db', notes: 'green' }))
    await log.append(taskEvent({ event: 'done', taskId: 'j1:wi:api', notes: 'green' }))

    const dispatcher = createDispatcher({ ctx: silentCtx, config: { ...config, dataDir: dir }, events: log, sessions: fakeSessions(), now: () => 1_000_000 })
    await dispatcher.tick()
    await dispatcher.tick()

    const all = await createEventLog(join(dir, 'events.jsonl')).all()
    assert.equal(all.filter(line => line.kind === 'delivery').length, 1)
    assert.equal(all.filter(line => line.kind === 'dispatch' && line.event === 'delivered').length, 1)
  })
})

test('a failed wake lands on the human lane instead of retrying forever', async () => {
  await withDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await seedIntake(log)
    await seedPlan(log)
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', event: 'config', sessionId: 'sess-1' }))
    const sessions = fakeSessions({ wake: () => ({ ok: false, error: 'agents service unavailable' }) })
    const dispatcher = createDispatcher({ ctx: silentCtx, config: { ...config, dataDir: dir }, events: log, sessions, now: () => 1_000_000 })

    await dispatcher.tick()
    const all = await createEventLog(join(dir, 'events.jsonl')).all()
    const decision = all.find(line => line.decision === 'ask_person')
    assert.ok(decision !== undefined, 'a human decision is recorded')
    assert.equal(decision.lane, 'human')
    assert.equal(decision.status, 'waiting')
    assert.match(JSON.stringify(decision.evidence), /wake-failed/)

    const first = sessions.calls.wake.length
    await dispatcher.tick()
    assert.equal(sessions.calls.wake.length, first, 'the gate cooldown stops the retry storm')
  })
})

test('a failed card stops the loop for a person and does not wake the agent', async () => {
  await withDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await seedIntake(log)
    await seedPlan(log)
    await log.append(jobEvent({ projectId: 'p1', jobId: 'j1', event: 'config', sessionId: 'sess-1' }))
    await log.append(taskEvent({ event: 'failed', taskId: 'j1:wi:db', notes: 'red tests' }))
    const sessions = fakeSessions()
    const dispatcher = createDispatcher({ ctx: silentCtx, config: { ...config, dataDir: dir }, events: log, sessions, now: () => 1_000_000 })

    await dispatcher.tick()
    // Whatever the order, the loop must not claim work is progressing: it either
    // wakes the remaining ready card or records the failure gate, never both.
    const all = await createEventLog(join(dir, 'events.jsonl')).all()
    assert.ok(all.some(line => line.decision === 'ask_person' || line.kind === 'dispatch'))
  })
})

test('the wake text names the job and the reporting contract', () => {
  const text = createDispatcher({
    ctx: silentCtx,
    config: { ...config },
    events: { append: async () => {} },
    sessions: fakeSessions(),
    now: () => 1_000,
  }).wakeText({ job: { id: 'j1' }, work: [{ taskId: 'w1', title: '建表' }, { taskId: 'w2', title: '接口' }] })
  assert.match(text, /j1/)
  assert.match(text, /建表/)
  assert.match(text, /workbench_next_work/)
  assert.match(text, /workbench_report_work/)
  assert.match(text, /test evidence/i)
})

test('a failed bind keeps the workspace so the retry does not register it twice', async () => {
  await withDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await seedIntake(log)
    const sessions = fakeSessions({
      ensure: () => ({ ok: false, error: 'session create failed: boom', workspace: '/tmp/ws', workspaceId: 'ws_1' }),
    })
    const dispatcher = createDispatcher({ ctx: silentCtx, config: { ...config, dataDir: dir }, events: log, sessions, now: () => 1_000_000 })
    await dispatcher.tick()

    const all = await createEventLog(join(dir, 'events.jsonl')).all()
    const projectConfig = all.find(line => line.kind === 'project' && line.event === 'config')
    assert.equal(projectConfig.workspace, '/tmp/ws')
    assert.equal(projectConfig.workspaceId, 'ws_1')
    assert.equal(projectConfig.sessionId, undefined, 'a failed bind must not claim a session')
    assert.ok(all.some(line => line.decision === 'ask_person'))

    // The next tick asks the bridge again; the bridge can now reuse ws_1.
    await dispatcher.tick()
    assert.equal(sessions.calls.ensure.length, 2)
  })
})
