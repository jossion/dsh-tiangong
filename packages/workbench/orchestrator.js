/**
 * The delivery loop's scheduling state machine.
 *
 * Pure on purpose: no fs, no ctx, no clock. `index.js` builds a snapshot from
 * the board projection plus the live host facts (agent status, planning flag,
 * budget) and calls `nextStep()`. The scheduler then performs exactly the one
 * action the machine returned, which makes every tick idempotent.
 *
 * The rules implement the closed loop described in `docs/workbench-closed-loop.md`:
 * bind a delivery session, let the main agent plan, wake it while cards are
 * ready, stop only for the human lane, and derive completion from leaf cards.
 */

/** Defaults of the loop. Every one of them is a Config field on the plugin. */
export const DEFAULT_LOOP = {
  /** Turn the whole automatic loop off (manual dispatch only). */
  autoRun: true,
  /** A successful wake must not be repeated before the agent had a chance to act. */
  wakeCooldownMs: 15000,
  /** A planning turn that never submits a plan falls back after this. */
  planTimeoutMs: 5 * 60 * 1000,
  /** Wake rounds are the loop's trip counter; beyond it a person takes over. */
  maxRounds: 60,
  /** `null` disables the budget gate. */
  budgetUsd: null,
  /** `null` disables the token gate. Tokens are machine evidence; USD needs a price. */
  budgetTokens: null,
}

const TERMINAL = new Set(['done', 'failed'])
/** Cards a machine may not pick up: done/failed are terminal, blocked needs a person. */
const NOT_READY = new Set(['done', 'failed', 'blocked', 'paused', 'cancelled'])
const DISPATCHABLE = new Set(['build', 'verify'])
const INTERRUPTED = new Set(['paused', 'cancelled'])

/** Flatten a task tree into its leaves. Parents are containers, not work. */
export function leavesOf(roots) {
  const leaves = []
  const walk = nodes => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (Array.isArray(node.children) && node.children.length > 0) walk(node.children)
      else leaves.push(node)
    }
  }
  walk(roots)
  return leaves
}

/** A requested approval freezes exactly its card (and whatever depends on it). */
function frozen(taskId, gates) {
  return (Array.isArray(gates) ? gates : []).some(gate => (
    gate?.status === 'requested'
    && gate?.taskId === taskId
    && (gate?.kind === 'approval' || gate?.irreversible === true)
  ))
}

/**
 * Work the loop may dispatch right now. Mirrors `executor.readyWork()` on the
 * projection's own fields (`openBlockers`, `owner`, `stage`) so there is one
 * definition of readiness, read from one place.
 */
export function readyLeaves(roots, gates = []) {
  return leavesOf(roots).filter(task => (
    task !== null
    && typeof task === 'object'
    && !NOT_READY.has(task.status)
    && DISPATCHABLE.has(task.stage)
    && task.owner !== null
    && task.owner !== undefined
    && task.owner !== 'workbench'
    && (Array.isArray(task.openBlockers) ? task.openBlockers.length === 0 : true)
    && !frozen(task.id, gates)
  ))
}

function countLeaves(roots) {
  const leaves = leavesOf(roots)
  let done = 0
  let failed = 0
  let blocked = 0
  for (const leaf of leaves) {
    if (leaf.status === 'done') done += 1
    if (leaf.status === 'failed') failed += 1
    if (leaf.status === 'blocked') blocked += 1
  }
  return { total: leaves.length, done, failed, blocked, pending: leaves.length - done - failed }
}

/**
 * Normalize a job from `buildBoard()` into the machine's snapshot.
 *
 * `runtime` is owned by the host: it is the live half of the loop (is a
 * planning turn in flight, what is the agent doing, when did we last wake it,
 * how many rounds, how much money).
 */
export function snapshotOf({ job, runtime = {}, config = {}, now = Date.now() }) {
  const gates = Array.isArray(job?.gates) ? job.gates : []
  const ready = readyLeaves(job?.roots ?? [], gates)
  const counted = countLeaves(job?.roots ?? [])
  return {
    now,
    config: { ...DEFAULT_LOOP, ...config },
    job: {
      id: job?.id ?? null,
      projectId: job?.projectId ?? null,
      status: job?.status ?? 'started',
      sessionId: job?.sessionId ?? null,
      planBy: job?.planBy ?? null,
      createdAt: job?.createdAt ?? null,
    },
    progress: {
      done: counted.done,
      total: counted.total,
      failed: counted.failed,
      blocked: counted.blocked,
      pending: counted.pending,
    },
    ready: {
      count: ready.length,
      ids: ready.map(task => task.id),
      titles: ready.map(task => task.title ?? task.id),
    },
    gates: {
      blocking: gates.filter(gate => gate?.status === 'requested'
        && (gate?.kind === 'approval' || gate?.irreversible === true)).length,
      awaiting: gates.filter(gate => gate?.status === 'requested').length,
    },
    usage: {
      tokens: Number(runtime.tokens) || 0,
      costUsd: Number(runtime.costUsd) || 0,
    },
    runtime: {
      planning: runtime.planning === true,
      planningSince: runtime.planningSince ?? null,
      agentStatus: runtime.agentStatus ?? 'absent',
      lastWakeAt: runtime.lastWakeAt ?? 0,
      rounds: Number(runtime.rounds) || 0,
      delivered: runtime.delivered === true,
    },
  }
}

/**
 * Decide the single next action. The order encodes the loop's safety rules:
 * terminal states first, then the human lane, then planning, then dispatch.
 *
 * Actions:
 *  - idle            nothing to do (paused/cancelled/delivered/manual mode)
 *  - bind-session    a job without a delivery session
 *  - start-planning  no plan yet and no planning turn in flight
 *  - plan-timeout    the planning turn overran its budget
 *  - wake            ready cards and an idle main agent
 *  - wait            let the in-flight turn finish / cooldown / dependencies
 *  - human-gate      a person must act (approval, failure, budget, rounds)
 *  - complete        every leaf card is done
 */
export function nextStep(snapshot) {
  const { job, progress, ready, gates, runtime, config, now } = snapshot

  if (job === null || job.id === null) return { action: 'idle', reason: 'no-job' }
  if (INTERRUPTED.has(job.status)) return { action: 'idle', reason: `job-${job.status}`, jobId: job.id }

  // Delivery is derived from leaf cards, never from "planning finished".
  if (progress.total > 0 && progress.done === progress.total) {
    return runtime.delivered
      ? { action: 'idle', reason: 'delivered', jobId: job.id }
      : { action: 'complete', jobId: job.id, projectId: job.projectId }
  }

  if (!config.autoRun) return { action: 'idle', reason: 'auto-run-off', jobId: job.id }
  if (job.sessionId === null || job.sessionId === undefined || job.sessionId === '') {
    return { action: 'bind-session', jobId: job.id, projectId: job.projectId }
  }

  // Planning precedes dispatch. A legacy job that already has cards but no plan
  // marker is treated as planned, so old ledgers keep running.
  if (job.planBy === null || job.planBy === undefined) {
    if (progress.total === 0) {
      if (!runtime.planning) return { action: 'start-planning', jobId: job.id, projectId: job.projectId, sessionId: job.sessionId }
      const elapsed = now - (runtime.planningSince ?? now)
      if (elapsed >= config.planTimeoutMs) {
        return { action: 'plan-timeout', jobId: job.id, projectId: job.projectId, sessionId: job.sessionId, elapsed }
      }
      return { action: 'wait', reason: 'planning', jobId: job.id }
    }
  }

  // Budget and rounds are the loop's own circuit breakers: they hand the job to
  // a person instead of burning tokens forever.
  if (config.budgetUsd !== null && snapshot.usage.costUsd >= config.budgetUsd) {
    return { action: 'human-gate', reason: 'budget', jobId: job.id, costUsd: snapshot.usage.costUsd, budgetUsd: config.budgetUsd }
  }
  if (config.budgetTokens !== null && snapshot.usage.tokens >= config.budgetTokens) {
    return { action: 'human-gate', reason: 'budget-tokens', jobId: job.id, tokens: snapshot.usage.tokens, budgetTokens: config.budgetTokens }
  }
  if (runtime.rounds >= config.maxRounds) {
    return { action: 'human-gate', reason: 'rounds', jobId: job.id, rounds: runtime.rounds, maxRounds: config.maxRounds }
  }

  if (ready.count > 0) {
    if (runtime.agentStatus === 'running') return { action: 'wait', reason: 'agent-running', jobId: job.id }
    if (now - runtime.lastWakeAt < config.wakeCooldownMs) return { action: 'wait', reason: 'cooldown', jobId: job.id }
    return { action: 'wake', jobId: job.id, sessionId: job.sessionId, readyIds: ready.ids, readyTitles: ready.titles }
  }

  // Nothing dispatchable: explain why, in the order a person would ask.
  if (gates.blocking > 0) return { action: 'human-gate', reason: 'approval', jobId: job.id, gates: gates.blocking }
  if (progress.failed > 0) return { action: 'human-gate', reason: 'failed', jobId: job.id, failed: progress.failed }
  // A card whose "done" claim had no green tests is blocked, not done. With no
  // other card to run, only a person can decide how to proceed.
  if (progress.blocked > 0) return { action: 'human-gate', reason: 'blocked', jobId: job.id, blocked: progress.blocked }
  return { action: 'wait', reason: progress.pending > 0 ? 'dependencies' : 'no-work', jobId: job.id }
}

/** One line per action, for the decision log and the tests. */
export function describeAction(action) {
  switch (action.action) {
    case 'wake': return `wake ${action.jobId}: ${action.readyIds.length} ready card(s)`
    case 'start-planning': return `plan ${action.jobId}`
    case 'plan-timeout': return `planning timeout ${action.jobId} after ${Math.round(action.elapsed / 1000)}s`
    case 'human-gate': return `human gate ${action.jobId}: ${action.reason}`
    case 'complete': return `delivered ${action.jobId}`
    case 'bind-session': return `bind a delivery session to ${action.jobId}`
    case 'wait': return `wait ${action.jobId ?? ''}: ${action.reason}`
    default: return `${action.action} ${action.jobId ?? ''}`
  }
}
