import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_LOOP,
  describeAction,
  leavesOf,
  nextStep,
  readyLeaves,
  snapshotOf,
} from '../orchestrator.js'

const NOW = 1_000_000

const task = (id, extra = {}) => ({
  id,
  title: id,
  owner: 'backend',
  stage: 'build',
  status: 'todo',
  openBlockers: [],
  children: [],
  ...extra,
})

const job = (extra = {}) => ({
  id: 'j1',
  projectId: 'p1',
  title: '员工管理',
  status: 'started',
  sessionId: 'sess-1',
  planBy: 'agent',
  roots: [],
  gates: [],
  ...extra,
})

const snapshot = ({ job: jobExtra = {}, runtime = {}, config = {} } = {}) => snapshotOf({
  job: job(jobExtra),
  runtime,
  config,
  now: NOW,
})

/* ── snapshot construction ────────────────────────────────────────────── */

test('leaves only: parents are containers, not work', () => {
  const roots = [
    task('stage', {
      stage: 'build',
      children: [task('a'), task('b', { children: [task('b1')] })],
    }),
  ]
  assert.deepEqual(leavesOf(roots).map(item => item.id), ['a', 'b1'])
})

test('snapshot counts leaves and derives the ready set', () => {
  const snap = snapshot({
    job: {
      roots: [
        task('done-1', { status: 'done' }),
        task('ready-1'),
        task('ready-2', { stage: 'verify', owner: 'qa' }),
        task('blocked-1', { openBlockers: ['done-1'] }),
        task('design-1', { stage: 'design', owner: 'workbench' }),
        task('parent', { children: [task('child-ready', { status: 'active' })] }),
      ],
    },
  })
  assert.equal(snap.progress.total, 6)
  assert.equal(snap.progress.done, 1)
  assert.deepEqual(snap.ready.ids, ['ready-1', 'ready-2', 'child-ready'])
  assert.equal(snap.gates.blocking, 0)
})

test('a requested approval freezes exactly its card', () => {
  const roots = [task('a'), task('b')]
  const gates = [{ taskId: 'a', kind: 'approval', status: 'requested' }]
  assert.deepEqual(readyLeaves(roots, gates).map(item => item.id), ['b'])
})

/* ── terminal and manual states ───────────────────────────────────────── */

test('an empty snapshot only asks for a job', () => {
  const action = nextStep(snapshotOf({ job: null }))
  assert.equal(action.action, 'idle')
  assert.equal(action.reason, 'no-job')
})

test('paused and cancelled jobs hand out no work', () => {
  for (const status of ['paused', 'cancelled']) {
    const action = nextStep(snapshot({ job: { status } }))
    assert.equal(action.action, 'idle')
    assert.equal(action.reason, `job-${status}`)
  }
})

test('every leaf done means delivery, and a reported delivery goes idle', () => {
  const roots = [task('a', { status: 'done' }), task('b', { status: 'done' })]
  assert.equal(nextStep(snapshot({ job: { roots } })).action, 'complete')
  assert.equal(nextStep(snapshot({ job: { roots }, runtime: { delivered: true } })).reason, 'delivered')
})

test('auto-run off leaves the loop idle', () => {
  const action = nextStep(snapshot({ config: { autoRun: false }, job: { roots: [task('a')] } }))
  assert.equal(action.action, 'idle')
  assert.equal(action.reason, 'auto-run-off')
})

test('a job without a session asks the host to bind one first', () => {
  const action = nextStep(snapshot({ job: { sessionId: null } }))
  assert.equal(action.action, 'bind-session')
})

/* ── planning ─────────────────────────────────────────────────────────── */

test('a job with no plan and no tasks starts planning', () => {
  const action = nextStep(snapshot({ job: { planBy: null } }))
  assert.equal(action.action, 'start-planning')
  assert.equal(action.sessionId, 'sess-1')
})

test('a planning turn in flight waits, then times out into the human lane', () => {
  const waiting = nextStep(snapshot({
    job: { planBy: null },
    runtime: { planning: true, planningSince: NOW - 1_000 },
  }))
  assert.equal(waiting.action, 'wait')
  assert.equal(waiting.reason, 'planning')

  const overran = nextStep(snapshot({
    job: { planBy: null },
    runtime: { planning: true, planningSince: NOW - DEFAULT_LOOP.planTimeoutMs - 1 },
  }))
  assert.equal(overran.action, 'plan-timeout')
})

test('a legacy job whose cards predate the plan marker is treated as planned', () => {
  const action = nextStep(snapshot({ job: { planBy: null, roots: [task('a')] } }))
  assert.equal(action.action, 'wake')
})

/* ── dispatch ─────────────────────────────────────────────────────────── */

test('ready work wakes an idle agent once the cooldown passed', () => {
  const action = nextStep(snapshot({
    job: { roots: [task('a'), task('b', { stage: 'verify' })] },
    runtime: { agentStatus: 'idle', lastWakeAt: NOW - 10_000 },
  }))
  assert.equal(action.action, 'wake')
  assert.deepEqual(action.readyIds, ['a', 'b'])
  assert.match(describeAction(action), /wake j1: 2 ready card/)
})

test('a running agent and an open cooldown both mean wait', () => {
  const running = nextStep(snapshot({ job: { roots: [task('a')] }, runtime: { agentStatus: 'running' } }))
  assert.equal(running.reason, 'agent-running')
  const cooling = nextStep(snapshot({ job: { roots: [task('a')] }, runtime: { agentStatus: 'idle', lastWakeAt: NOW - 500 } }))
  assert.equal(cooling.reason, 'cooldown')
})

test('pending cards with open dependencies wait instead of gating', () => {
  const action = nextStep(snapshot({
    job: { roots: [task('a', { openBlockers: ['x'] })] },
    runtime: { agentStatus: 'idle' },
  }))
  assert.equal(action.action, 'wait')
  assert.equal(action.reason, 'dependencies')
})

/* ── the human lane ───────────────────────────────────────────────────── */

test('a blocking approval gates only when nothing else is dispatchable', () => {
  const frozenJob = { roots: [task('a')], gates: [{ taskId: 'a', kind: 'approval', status: 'requested' }] }
  const gated = nextStep(snapshot({ job: frozenJob, runtime: { agentStatus: 'idle' } }))
  assert.equal(gated.action, 'human-gate')
  assert.equal(gated.reason, 'approval')

  const withSibling = nextStep(snapshot({
    job: { roots: [task('a'), task('b')], gates: [{ taskId: 'a', kind: 'approval', status: 'requested' }] },
    runtime: { agentStatus: 'idle', lastWakeAt: NOW - 10_000 },
  }))
  assert.equal(withSibling.action, 'wake')
  assert.deepEqual(withSibling.readyIds, ['b'])
})

test('an advisory decision never blocks the queue', () => {
  const action = nextStep(snapshot({
    job: { roots: [task('a')], gates: [{ taskId: 'a', kind: 'decision', status: 'requested' }] },
    runtime: { agentStatus: 'idle', lastWakeAt: NOW - 10_000 },
  }))
  assert.equal(action.action, 'wake')
})

test('failed cards, budget and rounds all land on a person', () => {
  const failed = nextStep(snapshot({ job: { roots: [task('a', { status: 'failed' })] } }))
  assert.equal(failed.reason, 'failed')

  const budget = nextStep(snapshot({
    job: { roots: [task('a')] },
    runtime: { costUsd: 3 },
    config: { budgetUsd: 2 },
  }))
  assert.equal(budget.reason, 'budget')

  const rounds = nextStep(snapshot({
    job: { roots: [task('a')] },
    runtime: { rounds: DEFAULT_LOOP.maxRounds },
  }))
  assert.equal(rounds.reason, 'rounds')
})

test('a token budget hands the job to a person', () => {
  const action = nextStep(snapshot({
    job: { roots: [task('a')] },
    runtime: { tokens: 5000 },
    config: { budgetTokens: 4000 },
  }))
  assert.equal(action.action, 'human-gate')
  assert.equal(action.reason, 'budget-tokens')
})
