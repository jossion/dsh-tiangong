/**
 * Seeds a realistic shift of decisions so the panel can be inspected without
 * running a real delivery (which needs a model provider and a live profile).
 *
 * It goes through the real router and the real summarizer, so the numbers in
 * the preview are produced by the same code the plugin runs. Only the model
 * calls are simulated.
 *
 * Usage: npm run preview   (or: node preview/seed.mjs)
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createEventLog } from '../events.js'
import { decide, evidence } from '../router.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_HTML = join(HERE, 'dashboard.html')

/** One plausible work item's worth of decisions. */
function shift() {
  const batch = []
  const runId = 'run_demo'
  const task = '给销售团队做一个报价单系统'

  batch.push(decide('which_skill', {
    runId, task, value: 'workbench_plan_software',
    confidence: evidence.route({ hits: 1, total: 1 }), rule: 'route:single-candidate',
  }))
  batch.push(decide('which_file', {
    runId, task, value: 'src/quote/pricing.ts',
    confidence: evidence.file({ hits: 1, topScore: 1 }), rule: 'file:single-hit',
  }))
  batch.push(decide('which_tool', {
    runId, task, value: 'grep',
    confidence: evidence.route({ hits: 1, total: 3 }), rule: 'tool:exact-match',
  }))
  batch.push(decide('which_file', {
    runId, task, value: 'src/quote/export.ts',
    confidence: evidence.file({ hits: 4 }), rule: 'file:four-candidates',
  }))
  batch.push(decide('diff_risk', {
    runId, task, value: 6.4,
    confidence: evidence.stage({ items: 3 }), rule: 'static:blast-radius',
    evidence: { filesTouched: 6, linesChanged: 240, touchesMigration: true },
  }))
  batch.push(decide('which_model', {
    runId, task, value: 'deepseek-chat',
    confidence: 0.74, rule: 'difficulty:mid', costUsd: 0.0021,
  }))
  batch.push(decide('retry_or_stop', {
    runId, task, value: 'retry',
    confidence: 0.58, rule: 'test:same-failure-twice',
  }))
  batch.push(decide('is_done', {
    runId, task, value: 'planned',
    confidence: evidence.done({ exitCode: 0, testsPassed: 14 }), rule: 'tests:green',
  }))
  batch.push(decide('keep_result', {
    runId, task, value: 'hold',
    confidence: 0.45, rule: 'review:high-risks:1',
  }))
  batch.push(decide('injection', {
    runId, task, value: 'no',
    confidence: 0.96, rule: 'scan:patterns-clean',
  }))
  batch.push(decide('ask_person', {
    runId, task, value: 'yes',
    confidence: 0.2, rule: 'review:open-questions',
  }))
  batch.push(decide('ask_person', {
    runId, task: '合并 PR #418', value: 'yes', action: 'merge_pull_request',
    confidence: 0.99, rule: 'policy:irreversible',
  }))
  batch.push(decide('ask_person', {
    runId, task: '删除过期分支', value: 'yes', action: 'delete_branch',
    confidence: 0.97, rule: 'policy:irreversible',
  }))

  // A few repeats so the stream looks like a shift rather than one run.
  for (let index = 0; index < 6; index += 1) {
    batch.push(decide('which_file', {
      runId, task: `整理模块 ${index + 1}`,
      value: `src/module-${index + 1}.ts`,
      confidence: evidence.file({ hits: 1, topScore: 0.9 }), rule: 'file:single-hit',
    }))
    batch.push(decide('is_done', {
      runId, task: `整理模块 ${index + 1}`, value: 'yes',
      confidence: evidence.done({ exitCode: 0, testsPassed: 8 + index }), rule: 'tests:green',
    }))
  }

  return batch
}

async function main() {
  const events = shift()

  // Round-trip through the real log so byte-for-byte what the plugin writes
  // is what the preview shows.
  const dir = await mkdtemp(join(tmpdir(), 'workbench-seed-'))
  const log = createEventLog(join(dir, 'events.jsonl'))
  for (const event of events) await log.append(event)
  const summary = await log.summary()
  const tail = (await log.tail(30)).reverse()

  // Keep the raw log next to the preview so it can be inspected by hand.
  await mkdir(join(HERE, 'out'), { recursive: true })
  await writeFile(join(HERE, 'out', 'events.jsonl'), (await log.all()).map(e => `${JSON.stringify(e)}\n`).join(''), 'utf8')
  await writeFile(
    join(HERE, 'out', 'data.js'),
    `window.__WORKBENCH_STATE__ = ${JSON.stringify({ summary, events: tail }, null, 2)}\n`,
    'utf8',
  )
  await rm(dir, { recursive: true, force: true })

  console.log(`seeded ${summary.decisions} decisions, ${summary.forks} forks, ${summary.held} held`)
  console.log(`open ${OUT_HTML}`)
}

await main()
