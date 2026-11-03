import { test } from 'node:test'
import assert from 'node:assert/strict'

import { costOf, foldUsage, totalTokens, usageEvent } from '../usage.js'
import { buildBoard, jobEvent, projectEvent } from '../projects.js'

const assistant = (inputTokens, outputTokens) => ({
  type: 'assistant/message',
  data: { usage: { inputTokens, outputTokens } },
})

test('usage folds only assistant messages that carry a usage block', () => {
  const totals = foldUsage([
    { type: 'user/message', data: {} },
    assistant(100, 20),
    { type: 'assistant/message', data: { usage: null } },
    assistant(50, 5),
    { type: 'tool/result', data: {} },
  ])
  assert.deepEqual(totals, { inputTokens: 150, outputTokens: 25, messages: 2 })
  assert.equal(totalTokens(totals), 175)
  assert.equal(totalTokens(null), 0)
})

test('cost is zero until a price is configured, then it is arithmetic', () => {
  assert.equal(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 0)
  assert.equal(
    costOf({ inputTokens: 1_000_000, outputTokens: 500_000 }, { priceInputPerMTok: 0.5, priceOutputPerMTok: 2 }),
    0.5 + 1,
  )
})

test('a usage line carries absolute totals so replay cannot double-count', () => {
  const line = usageEvent({
    projectId: 'p1',
    jobId: 'j1',
    usage: { inputTokens: 1200, outputTokens: 300 },
    price: { priceInputPerMTok: 1, priceOutputPerMTok: 1 },
    ts: '2026-11-03T00:00:00.000Z',
  })
  assert.equal(line.kind, 'usage')
  assert.equal(line.totalTokens, 1500)
  assert.equal(line.costUsd, 0.0015)

  const replay = usageEvent({ projectId: 'p1', jobId: 'j1', usage: { inputTokens: 1200, outputTokens: 300 } })
  assert.equal(replay.totalTokens, 1500)
})

test('the board projects usage onto the job, latest totals winning', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '公司管理', ts: '2026-11-03T00:00:00.000Z' }),
    jobEvent({ projectId: 'p1', jobId: 'j1', title: '员工管理', ts: '2026-11-03T00:00:01.000Z' }),
    usageEvent({ projectId: 'p1', jobId: 'j1', usage: { inputTokens: 10, outputTokens: 2 }, ts: '2026-11-03T00:00:02.000Z' }),
    usageEvent({ projectId: 'p1', jobId: 'j1', usage: { inputTokens: 40, outputTokens: 8 }, ts: '2026-11-03T00:00:03.000Z' }),
  ]
  const job = buildBoard(events).projects[0].jobs.find(item => item.id === 'j1')
  assert.deepEqual(job.tokens, { inputTokens: 40, outputTokens: 8 })
  assert.equal(job.costUsd, 0)
})
