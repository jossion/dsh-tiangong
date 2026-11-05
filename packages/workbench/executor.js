/**
 * The executor: turns planned cards into assignable work, and turns reports
 * back into ledger lines.
 *
 * A plugin is not an agent. DSH spawns agents (`ctx.subagents` needs a parent
 * Agent, which a plugin context is not), so this module deliberately does not
 * spawn anything: it hands the calling agent a work item **with a complete
 * prompt**, and turns the agent's report into events. The board stays honest
 * because the only way a card moves is a line in the log.
 *
 * Two rules are enforced here rather than trusted to the reporter:
 *
 *  1. `done` requires green tests. A report that says "done" with failing or
 *     missing tests becomes `blocked`, and an `is_done` decision with the real
 *     evidence lands the card on a person. An agent's self-report is not proof.
 *  2. A work item is only ready when every `blockedBy` dependency is done.
 *     Readiness is computed from the log, never from the dispatch order.
 */
import { decide, evidence, riskConfidence, riskScore } from './router.js'
import { DISPATCH_STAGES } from './planner.js'
import { artifactEvent, taskEvent } from './projects.js'

/** The order work is offered in: backend first, because the API unblocks UI. */
const OWNER_ORDER = ['backend', 'frontend', 'qa']

const STATUS_RANK = { active: 0, blocked: 1, todo: 2, done: 3, failed: 4 }

function ownerRank(owner) {
  const index = OWNER_ORDER.indexOf(owner)
  return index === -1 ? OWNER_ORDER.length : index
}

/** Flattens the tree; the board nests work items under a build card. */
function walk(tasks, visit) {
  for (const task of Array.isArray(tasks) ? tasks : []) {
    visit(task)
    walk(task.children, visit)
  }
}

/**
 * The prompt handed to the child agent.
 *
 * It names the artefact files instead of pasting them: the plan is already on
 * disk, and a prompt that repeats it goes stale the moment the design changes.
 */
export function workItemPrompt({ project, task, siblingTitles = [], stale = false }) {
  const dir = project?.artifactDir ?? ''
  const lines = [
    `You are the ${task.role ?? task.owner ?? 'developer'} on "${project?.title ?? project?.id ?? 'a project'}".`,
    '',
    `Implement exactly one work item: ${task.title}`,
  ]
  if (task.instructions) lines.push('', `Instructions: ${task.instructions}`)
  if (typeof task.skill === 'string' && task.skill.trim() !== '') {
    lines.push('', `Suggested skill for this card: ${task.skill}`)
  }
  lines.push(
    '',
    `Skills: before starting, call workbench_find_skill({ projectId: ${JSON.stringify(project?.id ?? '')}, query: <this card> })`,
    'and load the matching installed skill with the skill tool. Name the skills you loaded in your final',
    'report. If a skill the card requires is not installed, say so instead of pretending to load it.',
  )
  if (dir) {
    lines.push(
      '',
      'Read the plan before coding:',
      `- ${dir}/design.json (entities, API surface, work items)`,
      `- ${dir}/roles.json (business roles and permissions)`,
    )
  }
  if (siblingTitles.length > 0) {
    lines.push('', `Other work in this project (do not do these): ${siblingTitles.join('; ')}`)
  }
  if (stale) {
    lines.push(
      '',
      'NOTE: this card is still marked active from an earlier dispatch (the host restarted or the',
      'previous child was lost). Check the workspace first: if the work already exists, run its tests',
      'and report; otherwise complete it. Do not spawn a duplicate without checking.',
    )
  }
  lines.push(
    '',
    'Rules:',
    '- Change as little as the item needs. Do not touch unrelated files.',
    '- Run the tests that cover your change and report the real exit code.',
    '- Never merge, push, delete a branch, or rotate a credential. Those stop for a person.',
    '',
    'Reply with one JSON object and nothing else:',
    '{"status":"done|blocked|failed","files":["path",...],"tests":{"exitCode":0,"passed":12,"failed":0},"notes":"one or two sentences"}',
    'Report status "done" only when the tests you ran actually passed.',
  )
  return lines.join('\n')
}

/**
 * Work the caller may start right now: a leaf card on a dispatchable stage
 * (`design` / `build` / `verify` / `report`), not done, with no open dependency.
 * Planning-only cards (`brief` / `roles`) are never handed out.
 */
export function readyWork(board, { projectId = null, jobId = null, limit = 3, now = Date.now(), leaseMs = 600_000 } = {}) {
  const projects = Array.isArray(board?.projects) ? board.projects : []
  const project = projectId === null
    ? projects[0]
    : projects.find(item => item.id === projectId)
  if (project === undefined) return { project: null, job: null, work: [] }

  // Work is scoped to one job when asked: two jobs in a project are two
  // queues, and card #1 finishing must not unlock card #2's dependencies.
  const job = jobId === null ? null : (project.jobs || []).find(item => item.id === jobId) || null
  const scopeRoots = job === null ? project.roots : job.roots
  const scopeStatus = job === null ? project.status : job.status

  // A paused or cancelled scope hands out no work: stopping must mean the
  // queue stops, not that the dispatcher politely looks away.
  if (scopeStatus === 'paused' || scopeStatus === 'cancelled') {
    return { project, job, work: [], stopped: scopeStatus }
  }

  const items = []
  walk(scopeRoots, task => {
    if (task.children.length > 0) return
    // A blocked card reported "done" with no green tests; it must not be handed
    // out again as ready work, or the loop would retry it forever.
    if (task.status === 'done' || task.status === 'failed' || task.status === 'blocked') return
    // An active card is already being carried by a child. Handing it out again
    // made the loop wake the same card every cooldown and ask the agent to
    // spawn it twice. Only a claim older than the lease is re-offered: that is
    // a lost child (host restart), not work in progress.
    if (task.status === 'active') {
      // claimedAt is an ISO string from the ledger; Number() on that is NaN and
      // would silently disable the lease, so parse the clock value explicitly.
      const claimedAt = typeof task.claimedAt === 'number'
        ? task.claimedAt
        : Date.parse(String(task.claimedAt ?? ''))
      if (Number.isFinite(claimedAt) && now - claimedAt < leaseMs) return
    }
    if (!DISPATCH_STAGES.has(task.stage)) return
    if (task.openBlockers.length > 0) return
    if (task.owner === null || task.owner === 'workbench') return
    // A blocking approval freezes THIS card and its dependents only; the rest
    // of the job keeps moving. Advisory decisions never block.
    if ((task.gates || []).some(gate => gate.status === 'requested' && gate.blocking === true)) return
    items.push(task)
  })

  items.sort((a, b) => ownerRank(a.owner) - ownerRank(b.owner)
    || STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || (a.seq ?? 0) - (b.seq ?? 0))

  const work = items.slice(0, Math.max(1, limit)).map(task => ({
    taskId: task.id,
    title: task.title,
    owner: task.owner,
    role: task.role,
    stage: task.stage,
    // The board's current state, so the caller can tell a fresh card from one
    // already running (a re-called next_work must not claim it twice).
    status: task.status,
    // True only for an active card whose claim lease expired: its previous
    // child is gone, so the prompt tells the agent to check before redoing it.
    stale: task.status === 'active',
    // "Do not do these" is about the *other* items: a child should never be
    // told to avoid the one thing it was asked to build.
    prompt: workItemPrompt({
      project,
      task,
      stale: task.status === 'active',
      siblingTitles: items.filter(other => other.id !== task.id).map(other => other.title),
    }),
  }))

  return { project, job, work }
}

/**
 * Does this report prove the work is finished?
 *
 * Only machine evidence counts: an exit code and a positive pass count with no
 * failures. "The model says it is done" is exactly what this check refuses.
 */
export function testsGreen(tests) {
  if (tests === null || typeof tests !== 'object') return false
  const exitCode = Number(tests.exitCode ?? 0)
  const passed = Number(tests.passed ?? 0)
  const failed = Number(tests.failed ?? 0)
  return exitCode === 0 && failed === 0 && passed > 0
}

const LINES = [
  { match: /(\d+)\s+(?:tests?\s+)?passed/i, key: 'passed' },
  { match: /(\d+)\s+(?:tests?\s+)?failed/i, key: 'failed' },
]

/** Pulls a test summary out of a child's prose when it omitted the numbers. */
export function inferTests(notes) {
  const text = String(notes ?? '')
  const out = { exitCode: 0, passed: 0, failed: 0 }
  for (const line of LINES) {
    const found = line.match.exec(text)
    if (found !== null) out[line.key] = Number(found[1])
  }
  return out
}

/**
 * The ledger lines for one report.
 *
 * Pure: the host appends them, the tests inspect them. Every judgement the
 * child made becomes a `decision` line with the caller and the card on it, so
 * the panel can say who decided what, on which task, with which evidence.
 */
export function reportEvents({ task, project, report = {} }) {
  const event = ['progress', 'done', 'failed', 'blocked'].includes(report.event) ? report.event : 'progress'
  const tests = report.tests ?? inferTests(report.notes)
  const files = Array.isArray(report.files) ? report.files.filter(file => typeof file === 'string') : []
  const lines = Number(report.linesChanged ?? 0)
  const notes = typeof report.notes === 'string' ? report.notes : ''
  const costUsd = Number.isFinite(Number(report.costUsd)) ? Number(report.costUsd) : 0
  const ts = report.ts ?? undefined
  const taskId = task.id
  const projectId = project?.id ?? null
  const owner = task.owner ?? 'unassigned'
  const stage = task.stage ?? 'build'

  const green = testsGreen(tests)
  // "done" without green tests is a blocked card, not a finished one.
  const actualEvent = event === 'done' && !green ? 'blocked' : event

  const events = [taskEvent({
    event: actualEvent,
    taskId,
    projectId,
    owner,
    role: task.role ?? null,
    notes,
    ts,
  })]

  // Claiming a card is a fact about the team, not a judgement about the code:
  // an in-progress card must not create an is_done gate just because its tests
  // have not run yet. Only a terminal report produces decisions.
  if (actualEvent === 'progress') return events

  for (const file of files) events.push(artifactEvent({ taskId, projectId, path: file, ts }))

  // Which file: one reported file is a precise claim; several is a broad one.
  if (files.length > 0) {
    events.push(decide('which_file', {
      value: files.length === 1 ? files[0] : `${files.length} 个文件`,
      confidence: evidence.file({ hits: files.length }),
      rule: `file:reported:${files.length}`,
      evidence: { files },
      projectId,
      taskId,
      stage,
      owner,
      costUsd,
      ts,
    }))
  }

  // Is it done: the test result, not the sentence around it.
  events.push(decide('is_done', {
    value: actualEvent === 'done' ? 'done' : actualEvent === 'failed' ? 'failed' : 'not done',
    confidence: evidence.done({
      exitCode: tests.exitCode,
      testsPassed: tests.passed,
      testsFailed: tests.failed,
    }),
    rule: green ? 'tests:green' : tests.failed > 0 ? 'tests:red' : 'tests:unproven',
    evidence: { tests, notes: notes.slice(0, 240) },
    projectId,
    taskId,
    stage,
    owner,
    costUsd,
    ts,
  }))

  // How risky was the change: static facts, never the model's opinion.
  if (files.length > 0 || lines > 0) {
    const score = riskScore({
      filesTouched: files.length,
      linesChanged: lines,
      touchesMigration: files.some(file => /migration|schema\./i.test(file)),
    })
    events.push(decide('diff_risk', {
      value: score,
      confidence: riskConfidence(score),
      rule: 'diff:static',
      evidence: { filesTouched: files.length, linesChanged: lines },
      projectId,
      taskId,
      stage,
      owner,
      costUsd,
      ts,
    }))
  }

  return events
}
