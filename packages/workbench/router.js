/**
 * The decision router.
 *
 * Every judgement the delivery workflow makes is one of ten decisions. The
 * router answers two questions about each one and nothing else:
 *
 *   how sure are we?         -> `confidence`, derived from machine evidence
 *   who is allowed to act?   -> `lane`, decided by a threshold and by risk
 *
 * It deliberately never asks a model how confident it is. A model's
 * self-report is not evidence; a test exit code, a grep hit count, or a
 * static-analysis score is. Everything in this file is a pure function of
 * observable facts, which is what makes the log trustworthy.
 *
 * Lanes:
 *   code      exact rule, free and fast
 *   frontier  the judgement needs a model
 *   human     irreversible, or too uncertain to guess
 */

/** Left-to-right lane order used by the panel. */
export const LANES = ['code', 'frontier', 'human']

/**
 * At or above `exact` the answer is mechanical. Between `frontier` and
 * `exact` a model arbitrates. Below `frontier` a person does.
 */
export const THRESHOLDS = { exact: 0.8, frontier: 0.5 }

/**
 * The ten decisions, split the way the panel draws them: what to do next,
 * and what makes doing it risky.
 */
export const DECISIONS = [
  { key: 'which_file', group: 'work', question: '改哪个文件', kind: 'choice', lane: 'code' },
  { key: 'which_tool', group: 'work', question: '用哪个工具', kind: 'choice', lane: 'code' },
  { key: 'retry_or_stop', group: 'work', question: '重试还是停', kind: 'choice', lane: 'code' },
  { key: 'is_done', group: 'work', question: '真的干完了吗', kind: 'choice', lane: 'code' },
  { key: 'keep_result', group: 'work', question: '这版结果留不留', kind: 'choice', lane: 'code' },
  { key: 'which_skill', group: 'risk', question: '调哪个技能', kind: 'choice', lane: 'code' },
  { key: 'diff_risk', group: 'risk', question: '改动风险多大', kind: 'score', lane: 'code' },
  { key: 'which_model', group: 'risk', question: '用哪个模型', kind: 'choice', lane: 'frontier' },
  { key: 'injection', group: 'risk', question: '输入是否夹带', kind: 'choice', lane: 'frontier' },
  { key: 'ask_person', group: 'risk', question: '要不要问人', kind: 'choice', lane: 'human' },
]

export const DECISION_KEYS = new Set(DECISIONS.map(entry => entry.key))

/**
 * Operations that cannot be undone. Any decision carrying one of these
 * action kinds goes to the human lane regardless of confidence — the
 * `irreversible, never auto` rule from the panel.
 */
export const IRREVERSIBLE = new Set([
  'delete_branch',
  'merge_pull_request',
  'send_client_reply',
  'approve_schema_change',
  'rotate_deploy_key',
  'drop_table',
  'force_push',
  'publish_release',
])

export function isIrreversible(action) {
  return typeof action === 'string' && IRREVERSIBLE.has(action)
}

/**
 * Confidence -> lane. Failures land on the safe side: a missing or
 * non-numeric confidence is treated as zero uncertainty and escalates.
 */
export function laneFor(confidence, { irreversible = false } = {}) {
  if (irreversible) return 'human'
  // A non-number is an upstream bug, not a lucky string: refuse it rather
  // than letting `Number('0.9')` quietly pass as certainty.
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'human'
  if (confidence < THRESHOLDS.frontier) return 'human'
  if (confidence >= THRESHOLDS.exact) return 'code'
  return 'frontier'
}

const clamp01 = value => Math.min(1, Math.max(0, value))

/**
 * Evidence-derived confidence helpers.
 *
 * These are heuristics, not probabilities, and they are named as such: a
 * rule `file:single-hit` at 0.94 means "one exact match, trust it", not
 * "94% likely correct". Keeping the number tied to a named rule is what
 * makes a wrong route explainable after the fact.
 */
export const evidence = {
  /** One exact hit is near-certain; a room full of candidates is not. */
  file({ hits, topScore = 1 } = {}) {
    const count = Number(hits)
    if (!Number.isInteger(count) || count <= 0) return 0
    if (count === 1) return clamp01(Math.min(0.98, 0.8 + 0.14 * Number(topScore)))
    return clamp01(0.6 / (count - 1) + 0.2)
  },

  /** Test results speak for themselves; unrun tests say nothing. */
  done({ exitCode, testsPassed = 0, testsFailed = 0 } = {}) {
    if (Number(testsFailed) > 0) return 0.1
    if (Number(exitCode) !== 0) return 0.2
    const passed = Number(testsPassed)
    if (!Number.isFinite(passed) || passed <= 0) return 0
    return clamp01(0.82 + Math.min(0.16, passed * 0.02))
  },

  /** A one-item route table hit is mechanical; an empty table is a guess. */
  route({ hits = 1, total = 1 } = {}) {
    const hitCount = Number(hits)
    const totalCount = Number(total)
    if (!Number.isFinite(hitCount) || hitCount <= 0) return 0
    if (hitCount === 1) return 0.9
    return clamp01(0.9 * (1 - (hitCount - 1) / Math.max(1, totalCount)))
  },

  /** Scale a confidence by how much of the expected work actually completed. */
  stage({ parsed = true, attempts = 1, items = 1 } = {}) {
    if (!parsed) return 0.2
    const count = Number(items)
    if (!Number.isFinite(count) || count <= 0) return 0.3
    if (Number(attempts) > 1) return 0.62
    return 0.86
  },
}

/**
 * Scores a diff 0..10 from static facts. Higher is riskier.
 * The result feeds `diff_risk` as a score rather than a confidence, so it
 * is inverted by `riskConfidence` before routing.
 */
export function riskScore({ filesTouched = 0, linesChanged = 0, touchesMigration = false, touchesConfig = false, touchesSecrets = false } = {}) {
  const files = Math.max(0, Number(filesTouched) || 0)
  const lines = Math.max(0, Number(linesChanged) || 0)
  let score = Math.min(4, files * 0.4) + Math.min(3, lines / 200)
  if (touchesMigration) score += 2
  if (touchesConfig) score += 1.5
  if (touchesSecrets) score += 3
  return Math.round(Math.min(10, score) * 10) / 10
}

/** A risky diff routes to a person; a trivial one does not. */
export function riskConfidence(score) {
  const value = Number(score)
  if (!Number.isFinite(value)) return 0
  return clamp01(1 - value / 10)
}

/**
 * Builds the event record for one decision. The caller supplies what it
 * observed; this function supplies the policy.
 *
 * @param {string} key one of DECISION_KEYS
 * @param {object} input
 * @param {*} input.value what was decided
 * @param {number} input.confidence evidence-derived confidence
 * @param {string} [input.rule] the named evidence rule behind the number
 * @param {string} [input.action] an action kind, checked against IRREVERSIBLE
 * @param {string} [input.runId]
 * @param {string} [input.task]
 * @param {number} [input.costUsd]
 * @param {string} [input.status] `ok` | `waiting` | `failed`
 * @param {object} [input.evidence]
 * @param {string} [input.projectId] which project the judgement belongs to
 * @param {string} [input.taskId] which board task it was made for
 * @param {string} [input.stage] pipeline stage (`brief` … `report`)
 * @param {string} [input.owner] which agent made it
 */
export function decide(key, input = {}) {
  const definition = DECISIONS.find(entry => entry.key === key)
  if (!definition) throw new Error(`unknown decision: ${key}`)

  const irreversible = isIrreversible(input.action)
  const reported = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
    ? clamp01(input.confidence)
    : null
  const lane = laneFor(reported, { irreversible })

  return {
    decision: key,
    group: definition.group,
    question: definition.question,
    value: input.value ?? null,
    confidence: reported === null ? 0 : Math.round(reported * 100) / 100,
    lane,
    rule: input.rule ?? 'unspecified',
    irreversible,
    action: input.action ?? null,
    runId: input.runId ?? null,
    task: input.task ?? null,
    costUsd: Number.isFinite(Number(input.costUsd)) ? Number(input.costUsd) : 0,
    status: input.status ?? (lane === 'human' ? 'waiting' : 'ok'),
    evidence: input.evidence ?? null,
    // Attribution. A single agent's judgement is auditable with `rule` alone;
    // a team's is not — the board has to say whose judgement it was, for which
    // task, so a wrong call can be traced to a role instead of "the system".
    projectId: input.projectId ?? null,
    jobId: input.jobId ?? null,
    taskId: input.taskId ?? null,
    stage: input.stage ?? null,
    owner: input.owner ?? null,
  }
}
