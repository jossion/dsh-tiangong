import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DECISIONS,
  DECISION_KEYS,
  IRREVERSIBLE,
  THRESHOLDS,
  decide,
  evidence,
  isIrreversible,
  laneFor,
  riskConfidence,
  riskScore,
} from '../router.js'

test('the router knows exactly ten decisions', () => {
  assert.equal(DECISIONS.length, 10)
  assert.equal(DECISION_KEYS.size, 10)
  // Five about what to do next, five about what makes it risky.
  assert.equal(DECISIONS.filter(entry => entry.group === 'work').length, 5)
  assert.equal(DECISIONS.filter(entry => entry.group === 'risk').length, 5)
})

test('thresholds route to the three lanes on their boundaries', () => {
  assert.equal(laneFor(1), 'code')
  assert.equal(laneFor(THRESHOLDS.exact), 'code')
  assert.equal(laneFor(0.79), 'frontier')
  assert.equal(laneFor(THRESHOLDS.frontier), 'frontier')
  assert.equal(laneFor(0.49), 'human')
  assert.equal(laneFor(0), 'human')
})

test('a missing confidence escalates instead of guessing', () => {
  assert.equal(laneFor(undefined), 'human')
  assert.equal(laneFor(null), 'human')
  assert.equal(laneFor(Number.NaN), 'human')
  assert.equal(laneFor('0.9'), 'human', 'a string is not accepted as certainty')
})

test('an irreversible action always lands on a person', () => {
  assert.equal(isIrreversible('merge_pull_request'), true)
  assert.equal(isIrreversible('edit_file'), false)
  assert.equal(laneFor(0.999, { irreversible: true }), 'human')
  for (const action of IRREVERSIBLE) {
    assert.equal(laneFor(0.99, { irreversible: isIrreversible(action) }), 'human')
  }
})

test('file confidence: one hit is mechanical, a crowd is not', () => {
  const single = evidence.file({ hits: 1 })
  assert.ok(single > THRESHOLDS.exact, `expected ${single} above ${THRESHOLDS.exact}`)
  assert.equal(laneFor(single), 'code')

  const many = evidence.file({ hits: 4 })
  assert.ok(many < THRESHOLDS.frontier, `expected ${many} below ${THRESHOLDS.frontier}`)
  assert.equal(laneFor(many), 'human')

  assert.equal(evidence.file({ hits: 0 }), 0)
})

test('done confidence comes from tests, never from the agent', () => {
  assert.ok(evidence.done({ exitCode: 0, testsPassed: 12 }) >= THRESHOLDS.exact)
  assert.ok(evidence.done({ exitCode: 0, testsPassed: 0 }) === 0, 'unrun tests prove nothing')
  assert.ok(evidence.done({ exitCode: 0, testsPassed: 5, testsFailed: 1 }) <= 0.2)
  assert.ok(evidence.done({ exitCode: 1, testsPassed: 5 }) <= 0.2)
})

test('a broad route table hit is not certainty', () => {
  assert.equal(evidence.route({ hits: 1, total: 1 }), 0.9)
  assert.ok(evidence.route({ hits: 3, total: 4 }) < THRESHOLDS.exact)
  assert.equal(evidence.route({ hits: 0 }), 0)
})

test('risk score rises with blast radius', () => {
  assert.equal(riskScore({}), 0)
  assert.ok(riskScore({ filesTouched: 8, linesChanged: 700, touchesMigration: true, touchesSecrets: true }) >= 9)
  assert.ok(riskScore({ filesTouched: 1, linesChanged: 10 }) < 2)
  assert.equal(riskConfidence(0), 1)
  assert.equal(riskConfidence(10), 0)
})

test('decide() fills the policy fields the panel reads', () => {
  const event = decide('which_file', { value: 'src/auth.ts', confidence: evidence.file({ hits: 1 }), rule: 'file:single-hit' })
  assert.equal(event.decision, 'which_file')
  assert.equal(event.lane, 'code')
  assert.equal(event.status, 'ok')
  assert.equal(event.irreversible, false)
  assert.deepEqual(Object.keys(event).sort(), [
    'action', 'confidence', 'costUsd', 'decision', 'evidence', 'group',
    'irreversible', 'jobId', 'lane', 'owner', 'projectId', 'question', 'rule',
    'runId', 'stage', 'status', 'task', 'taskId', 'value',
  ])
})

test('decide() carries the team attribution the board needs', () => {
  const event = decide('which_file', {
    value: 'src/auth.ts',
    confidence: 0.94,
    projectId: 'prj_1',
    taskId: 'task_7',
    stage: 'build',
    owner: 'frontend',
  })
  assert.equal(event.projectId, 'prj_1')
  assert.equal(event.taskId, 'task_7')
  assert.equal(event.stage, 'build')
  assert.equal(event.owner, 'frontend')

  const anonymous = decide('which_file', { value: 'a' })
  assert.equal(anonymous.taskId, null, 'an unattributed decision is explicit, not missing')
})

test('decide() parks a human decision as waiting and flags the action', () => {
  const event = decide('ask_person', {
    value: 'yes',
    confidence: 0.95,
    action: 'merge_pull_request',
  })
  assert.equal(event.lane, 'human')
  assert.equal(event.irreversible, true)
  assert.equal(event.status, 'waiting')
})

test('decide() clamps and rejects bad input', () => {
  assert.equal(decide('is_done', { confidence: 5 }).confidence, 1)
  assert.equal(decide('is_done', { confidence: -2 }).confidence, 0)
  assert.throws(() => decide('not_a_decision', {}), /unknown decision/)
})
