import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEventLog, parseLines, summarize } from '../events.js'

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-events-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('parseLines survives a truncated or hand-edited file', () => {
  const text = [
    '{"decision":"which_file","lane":"code"}',
    '',
    'not json at all',
    '{"decision":"is_done","lane":"code"}',
    '{"decision":"half',
  ].join('\n')

  const events = parseLines(text)
  assert.equal(events.length, 2)
  assert.equal(events[1].decision, 'is_done')
  assert.deepEqual(parseLines(''), [])
  assert.deepEqual(parseLines(null), [])
})

test('summarize projects the panel numbers from the log', () => {
  const events = [
    { seq: 0, decision: 'which_file', lane: 'code', confidence: 0.94, costUsd: 0 },
    { seq: 1, decision: 'which_file', lane: 'code', confidence: 0.8, costUsd: 0 },
    { seq: 2, decision: 'which_model', lane: 'frontier', confidence: 0.6, costUsd: 0.0021 },
    { seq: 3, decision: 'ask_person', lane: 'human', confidence: 0.4, status: 'waiting', costUsd: 0 },
    { seq: 4, decision: 'keep_result', lane: 'frontier', confidence: 0.55, costUsd: 0.001 },
  ]

  const summary = summarize(events)
  assert.equal(summary.decisions, 5)
  assert.equal(summary.forks, 4, 'distinct decision kinds, not call count')
  assert.equal(summary.held, 1)
  assert.equal(summary.lanes.counts.code, 2)
  assert.equal(summary.lanes.counts.frontier, 2)
  assert.equal(summary.lanes.counts.human, 1)
  assert.equal(summary.lanes.split.code, 40)
  assert.equal(summary.lanes.split.frontier, 40)
  assert.equal(summary.lanes.split.human, 20)
  assert.equal(summary.spentUsd, 0.0031)
  assert.equal(summary.confidence.length, 5)
  assert.equal(summary.waiting[0].decision, 'ask_person')
  assert.equal(summary.recent[0].seq, 4, 'newest first')
})

test('summarize of an empty log is zero, not NaN', () => {
  const summary = summarize([])
  assert.equal(summary.decisions, 0)
  assert.equal(summary.perDecisionUsd, 0)
  assert.deepEqual(summary.lanes.split, { code: 0, frontier: 0, human: 0 })
  assert.deepEqual(summary.waiting, [])
})

test('appends are numbered, persisted, and readable back', async () => {
  await withTempDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'), {
      clock: () => '2026-11-01T12:00:00.000Z',
      idFactory: (() => {
        let n = 0
        return () => `ev_${++n}`
      })(),
    })

    await log.append({ decision: 'which_file', lane: 'code', confidence: 0.9 })
    await log.append({ decision: 'is_done', lane: 'code', confidence: 0.85 })

    const all = await log.all()
    assert.deepEqual(all.map(event => event.seq), [0, 1])
    assert.equal(all[0].id, 'ev_1')
    assert.equal(all[0].ts, '2026-11-01T12:00:00.000Z')

    const tail = await log.tail(1)
    assert.equal(tail.length, 1)
    assert.equal(tail[0].decision, 'is_done')

    const onDisk = await readFile(log.path, 'utf8')
    assert.equal(onDisk.trim().split('\n').length, 2, 'one line per decision')

    const summary = await log.summary()
    assert.equal(summary.decisions, 2)
    assert.equal(summary.lanes.split.code, 100)
  })
})

test('concurrent appends all land on their own line', async () => {
  await withTempDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      log.append({ decision: 'is_done', lane: 'code', confidence: 0.9, value: index })))

    const lines = (await readFile(log.path, 'utf8')).trim().split('\n')
    assert.equal(lines.length, 12)
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line))
    assert.deepEqual((await log.all()).map(event => event.seq), [...Array(12).keys()])
  })
})

test('a missing log file reads as empty and is created on first append', async () => {
  await withTempDir(async dir => {
    const log = createEventLog(join(dir, 'nested', 'events.jsonl'))
    assert.deepEqual(await log.all(), [])
    await log.append({ decision: 'which_skill', lane: 'code', confidence: 0.9 })
    assert.equal((await log.all()).length, 1)
  })
})

test('subscribers are notified on append, and a throwing one is isolated', async () => {
  await withTempDir(async dir => {
    const log = createEventLog(join(dir, 'events.jsonl'))
    let notifications = 0
    log.subscribe(() => { notifications += 1 })
    log.subscribe(() => { throw new Error('broken subscriber') })
    await log.append({ decision: 'is_done', lane: 'code', confidence: 0.9 })
    assert.equal(notifications, 1)
  })
})

test('a corrupt file degrades to the parsable lines', async () => {
  await withTempDir(async dir => {
    const path = join(dir, 'events.jsonl')
    await writeFile(path, '{"decision":"is_done","lane":"code"}\n{{{\n', 'utf8')
    const log = createEventLog(path)
    const events = await log.all()
    assert.equal(events.length, 1)
    assert.equal(events[0].seq, 0)
  })
})
