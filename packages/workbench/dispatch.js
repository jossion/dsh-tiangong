/**
 * The dispatch loop.
 *
 * One tick reads the board, asks `orchestrator.nextStep()` what to do for every
 * managed job, and performs that one action. Events that can change readiness
 * (a tool result, a subagent ending, an agent going idle) schedule another tick;
 * a slow timer is the safety net. All wake-ups are idempotent: the ledger is
 * the state, and the in-memory runtime only holds cooldowns and the budget
 * counters.
 *
 * Only jobs that came through the requirement intake are managed here. A ledger
 * written before this loop existed keeps working exactly as it did — the loop
 * must never adopt and start driving an old project by accident.
 */
import { buildBoard } from './projects.js'
import { DEFAULT_LOOP, nextStep, snapshotOf } from './orchestrator.js'
import { readyWork } from './executor.js'
import { planningDirective } from './requirements.js'
import { decide } from './router.js'

/** A human gate repeats at most this often per job and reason. */
const GATE_COOLDOWN_MS = 60 * 1000

function nowIso(now) {
  return new Date(now()).toISOString()
}

/** The message that starts one planning round in the delivery session. */
export function planningText({ project, job, requirement }) {
  return planningDirective({
    project,
    job: { jobId: job.id, workspace: job.workspace ?? null },
    requirement: {
      text: requirement.text,
      title: requirement.title ?? null,
      source: requirement.source ?? 'text',
    },
    requirementFile: requirement.file ?? null,
  })
}

/** The message that starts one dispatch round: ready cards, then report. */
export function wakeText({ job, work }) {
  const titles = work.map(item => item.title ?? item.taskId).join('; ')
  return [
    `You are the delivery lead for job ${job.id}.`,
    `${work.length} work item(s) are ready: ${titles}.`,
    '',
    'Run one dispatch round now:',
    `1. call workbench_next_work { "jobId": ${JSON.stringify(job.id)}, "limit": 5 } to get the cards and their prompts`,
    '2. spawn one subagent per card with the returned prompt, keeping the work item id',
    '3. when a child returns, call workbench_report_work with that id, its real files and its test evidence; a card is done only with green tests',
    '4. repeat until workbench_next_work returns no work, then stop and summarize in one paragraph',
    '',
    'Do not implement cards yourself and never mark a card done without test evidence.',
    'An irreversible action stays for the human gate; keep working the other cards.',
  ].join('\n')
}

/** One job's in-memory half: cooldowns, rounds, planning state, delivery. */
function factsOf(store, jobId) {
  let facts = store.get(jobId)
  if (facts === undefined) {
    facts = {
      lastWakeAt: 0,
      rounds: 0,
      planning: false,
      planningSince: null,
      delivered: false,
      agentStatus: 'idle',
    }
    store.set(jobId, facts)
  }
  return facts
}

export function createDispatcher({ ctx, config, events, sessions, now = () => Date.now() }) {
  const runtime = new Map()
  const gated = new Map()
  const agentStatus = new Map()
  let scheduledTimer = null
  let ticking = false
  let attached = false
  let disposed = false

  const loopConfig = () => ({
    ...DEFAULT_LOOP,
    autoRun: config.autoRun !== false,
    wakeCooldownMs: Number(config.wakeCooldownMs) > 0 ? Number(config.wakeCooldownMs) : DEFAULT_LOOP.wakeCooldownMs,
    planTimeoutMs: Number(config.planTimeoutMs) > 0 ? Number(config.planTimeoutMs) : DEFAULT_LOOP.planTimeoutMs,
    maxRounds: Number(config.maxRounds) > 0 ? Number(config.maxRounds) : DEFAULT_LOOP.maxRounds,
    budgetUsd: Number.isFinite(Number(config.budgetUsd)) && config.budgetUsd !== null ? Number(config.budgetUsd) : null,
  })

  function serviceOptional(name) {
    try {
      return typeof ctx.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  /** Only intake-created jobs are auto-driven; old ledgers stay manual. */
  function managed(job) {
    return job?.requirement !== null && job?.requirement !== undefined
  }

  async function gate(project, job, reason, detail = null) {
    const key = `${job.id}:${reason}`
    const last = gated.get(key) ?? 0
    const stamp = now()
    if (stamp - last < GATE_COOLDOWN_MS) return
    gated.set(key, stamp)
    try {
      await events.append(decide('ask_person', {
        runId: job.id,
        projectId: project.id,
        jobId: job.id,
        question: `工作台需要你处理：${reason}`,
        value: reason,
        task: job.title ?? job.id,
        rule: `workbench-loop:${reason}`,
        confidence: 0.2,
        status: 'waiting',
        evidence: detail === null ? { reason } : { reason, detail: String(detail) },
      }))
    } catch {
      /* a gate line is best-effort; the loop must not crash on it */
    }
  }

  async function wakeJob(project, job, text, { mode }) {
    const facts = factsOf(runtime, job.id)
    const result = await sessions.wake(job.sessionId, text)
    facts.lastWakeAt = now()
    facts.rounds += 1
    if (!result.ok) {
      await gate(project, job, 'wake-failed', result.error)
    }
    try {
      await events.append({
        kind: 'dispatch',
        projectId: project.id,
        jobId: job.id,
        event: mode,
        ok: result.ok === true,
        ...(result.ok === true ? {} : { error: String(result.error ?? 'unknown') }),
        ts: nowIso(now),
      })
    } catch {
      /* the dispatch line is an audit trail, not a precondition */
    }
    return result
  }

  async function execute(action, { board, project, job }) {
    const facts = factsOf(runtime, job.id)
    if (job.planBy !== null && job.planBy !== undefined) facts.planning = false

    switch (action.action) {
      case 'bind-session': {
        const bound = await sessions.ensureProjectSession(project)
        if (!bound.ok) {
          await gate(project, job, 'session-unavailable', bound.error)
          return
        }
        const ts = nowIso(now)
        if (project.sessionId === null || project.sessionId === undefined) {
          await events.append({
            kind: 'project', projectId: project.id, event: 'config',
            sessionId: bound.sessionId, workspace: bound.workspace ?? null,
            workspaceId: bound.workspaceId ?? null, ts,
          })
        }
        await events.append({
          kind: 'job', projectId: project.id, jobId: job.id, event: 'config',
          sessionId: bound.sessionId, workspace: bound.workspace ?? null,
          workspaceId: bound.workspaceId ?? null, ts,
        })
        // Later jobs in this same tick read the board snapshot taken before the
        // bind; without this the project would grow one session per job.
        project.sessionId = bound.sessionId
        project.workspace = bound.workspace ?? project.workspace
        project.workspaceId = bound.workspaceId ?? project.workspaceId
        job.sessionId = bound.sessionId
        return
      }
      case 'start-planning': {
        if (job.requirement === null || job.requirement === undefined || String(job.requirement.text ?? '').trim() === '') {
          await gate(project, job, 'missing-requirement')
          return
        }
        const text = planningText({ project, job, requirement: job.requirement })
        facts.planning = true
        facts.planningSince = now()
        const result = await wakeJob(project, job, text, { mode: 'plan' })
        if (!result.ok) facts.planning = false
        return
      }
      case 'plan-timeout': {
        facts.planning = false
        await gate(project, job, 'plan-timeout', 'the planning turn did not submit a plan in time')
        return
      }
      case 'wake': {
        const { work } = readyWork(board, { projectId: project.id, jobId: job.id, limit: 5 })
        if (work.length === 0) return
        const text = wakeText({ job, work })
        await wakeJob(project, job, text, { mode: 'dispatch' })
        return
      }
      case 'human-gate': {
        await gate(project, job, action.reason, action.detail ?? null)
        return
      }
      case 'complete': {
        facts.delivered = true
        const ts = nowIso(now)
        try {
          await events.append({
            kind: 'delivery', projectId: project.id, jobId: job.id,
            summary: `交付完成：${job.title ?? job.id}`, ts,
          })
          await events.append({
            kind: 'dispatch', projectId: project.id, jobId: job.id,
            event: 'delivered', ok: true, ts,
          })
        } catch {
          /* completion is already derived from the cards */
        }
        return
      }
      default:
        return
    }
  }

  /** One pass over every managed, unfinished job. Safe to call concurrently. */
  async function tick() {
    if (ticking || disposed) return
    if (config.autoRun === false) return
    ticking = true
    try {
      const all = await events.all()
      const board = buildBoard(all)
      // A finished job stays in the ledger; the delivery line is written once,
      // when the last card turns green, not on every later tick.
      const delivered = new Set(all
        .filter(line => line?.kind === 'delivery' && typeof line.jobId === 'string')
        .map(line => line.jobId))
      for (const project of board.projects) {
        if (project.status === 'paused' || project.status === 'cancelled') continue
        for (const job of project.jobs ?? []) {
          if (job.status === 'paused' || job.status === 'cancelled') continue
          if (job.status === 'done' && delivered.has(job.id)) continue
          if (!managed(job)) continue
          const facts = factsOf(runtime, job.id)
          if (job.planBy !== null && job.planBy !== undefined) facts.planning = false
          const snapshot = snapshotOf({
            job,
            config: loopConfig(),
            now: now(),
            runtime: {
              ...facts,
              agentStatus: agentStatus.get(job.sessionId) ?? facts.agentStatus,
            },
          })
          const action = nextStep(snapshot)
          await execute(action, { board, project, job })
        }
      }
    } finally {
      ticking = false
    }
  }

  /** Debounced tick: many tool results in one turn become one pass. */
  function schedule(delay = 250) {
    if (disposed || !attached) return
    if (scheduledTimer !== null) return
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null
      tick().catch(() => {})
    }, delay)
    if (typeof scheduledTimer?.unref === 'function') scheduledTimer.unref()
  }

  /**
   * Subscribe to the events that can change readiness, plus a slow safety-net
   * timer. Returns one disposer; a headless fake context simply gets none.
   */
  function attach() {
    if (attached || disposed) return () => {}
    attached = true
    const disposers = []
    const listen = (name, listener) => {
      if (typeof ctx.on !== 'function') return
      try {
        const dispose = ctx.on(name, listener)
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch {
        /* an older host without this event: the timer still drives the loop */
      }
    }
    listen('tools/result', () => schedule())
    listen('subagent/end', () => schedule())
    listen('agent/status', ({ agent, status } = {}) => {
      if (agent?.id !== undefined) agentStatus.set(agent.id, status === 'running' ? 'running' : 'idle')
      schedule()
    })

    const interval = Number(config.loopTickMs) > 0 ? Number(config.loopTickMs) : 10_000
    if (typeof ctx.on === 'function') {
      const timer = setInterval(() => schedule(0), interval)
      if (typeof timer?.unref === 'function') timer.unref()
      disposers.push(() => clearInterval(timer))
    }
    schedule(0)
    return () => {
      disposed = true
      if (scheduledTimer !== null) clearTimeout(scheduledTimer)
      scheduledTimer = null
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          /* already withdrawn */
        }
      }
    }
  }

  /** Test seam: one job's counters. */
  function inspect(jobId) {
    return runtime.get(jobId) ?? null
  }

  return { attach, schedule, tick, inspect, wakeText, planningText }
}
