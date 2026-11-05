/**
 * The planning protocol.
 *
 * The main agent owns understanding the requirement; the plugin owns the shape
 * of a plan. This module is the boundary: it validates what the agent submits,
 * normalizes it, and turns it into append-only ledger lines. It is pure — the
 * clock, file writes and the log live in `index.js`.
 *
 * A plan is a DAG of work items, not prose: without a validated graph the
 * dispatcher cannot compute readiness, and "done" stops meaning anything.
 */
import { planEvent, taskEvent } from './projects.js'

/** Who can own a card. `workbench` plans and verifies; it does not implement. */
export const OWNERS = ['backend', 'frontend', 'qa', 'workbench']

/**
 * The fixed stage rail.
 *
 * `brief` and `roles` are planning-only: they describe how the plan was
 * understood, and a child agent cannot execute them. Everything else is
 * deliverable work and may be dispatched — including `design`, because a plan
 * legitimately uses it for contracts, data models and interface drafts. (A
 * design card with dependents used to deadlock the whole chain: it could never
 * be handed out, so nothing behind it could become ready.)
 */
export const PLAN_STAGES = ['brief', 'roles', 'design', 'build', 'verify', 'report']

export const PLANNING_STAGES = new Set(['brief', 'roles'])

export const DISPATCH_STAGES = new Set(PLAN_STAGES.filter(stage => !PLANNING_STAGES.has(stage)))

export const PLAN_LIMITS = {
  maxTasks: 200,
  maxId: 64,
  maxTitle: 200,
  maxText: 4000,
  maxBlockers: 32,
  maxRoles: 50,
}

/** A rejected plan carries every issue at once, so one round-trip fixes them. */
export class PlanError extends Error {
  constructor(issues) {
    const list = Array.isArray(issues) && issues.length > 0 ? issues : ['invalid plan']
    super(`invalid plan: ${list[0]}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`)
    this.name = 'PlanError'
    this.issues = list
  }
}

/** Stable identity of a work item in the ledger. */
export function workItemId(jobId, localId) {
  return `${jobId}:wi:${localId}`
}

/** The build card every work item hangs under unless it names a parent. */
export function buildCardId(jobId) {
  return `${jobId}:build`
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cycleIn(edges) {
  const state = new Map()
  const visit = node => {
    const mark = state.get(node) ?? 0
    if (mark === 1) return true
    if (mark === 2) return false
    state.set(node, 1)
    for (const next of edges.get(node) ?? []) {
      if (visit(next)) return true
    }
    state.set(node, 2)
    return false
  }
  for (const node of edges.keys()) {
    if (visit(node)) return true
  }
  return false
}

/**
 * Validate and normalize one plan submission.
 *
 * Returns `{ ok, issues, plan }` instead of throwing so a tool can report every
 * problem to the agent at once. `assertPlan()` is the throwing form.
 */
export function checkPlan(input, { jobId = null, projectId = null } = {}) {
  const issues = []
  const source = isPlainObject(input) ? input : {}
  const resolvedJobId = text(source.jobId ?? jobId, 120)
  const resolvedProjectId = text(source.projectId ?? projectId, 120)
  if (resolvedJobId === '') issues.push('jobId is required')
  if (resolvedProjectId === '') issues.push('projectId is required')

  const brief = text(source.brief, PLAN_LIMITS.maxText)
  const rawTasks = Array.isArray(source.tasks) ? source.tasks : []
  if (rawTasks.length === 0) issues.push('tasks must be a non-empty array')
  if (rawTasks.length > PLAN_LIMITS.maxTasks) {
    issues.push(`tasks exceeds the ${PLAN_LIMITS.maxTasks}-item limit`)
  }

  const tasks = []
  const seen = new Set()
  for (const [index, raw] of rawTasks.entries()) {
    const at = `tasks[${index}]`
    if (!isPlainObject(raw)) {
      issues.push(`${at} must be an object`)
      continue
    }
    const id = text(raw.id, PLAN_LIMITS.maxId)
    if (id === '') issues.push(`${at}.id is required`)
    else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) issues.push(`${at}.id has unsupported characters: ${id}`)
    else if (seen.has(id)) issues.push(`${at}.id is duplicated: ${id}`)
    if (id !== '') seen.add(id)

    const title = text(raw.title, PLAN_LIMITS.maxTitle)
    if (title === '') issues.push(`${at}.title is required`)

    const owner = text(raw.owner, 40) || 'backend'
    if (!OWNERS.includes(owner)) issues.push(`${at}.owner must be one of ${OWNERS.join(', ')}: ${owner}`)

    const stage = text(raw.stage, 40) || 'build'
    if (!PLAN_STAGES.includes(stage)) issues.push(`${at}.stage must be one of ${PLAN_STAGES.join(', ')}: ${stage}`)

    const parentId = text(raw.parentId, PLAN_LIMITS.maxId) || null
    const blockedBy = Array.isArray(raw.blockedBy)
      ? [...new Set(raw.blockedBy.map(value => text(value, PLAN_LIMITS.maxId)).filter(Boolean))]
      : []
    const requiredSkills = (() => {
      const list = Array.isArray(raw.requiredSkills) ? raw.requiredSkills : (Array.isArray(raw.skills) ? raw.skills : [])
      const out = []
      for (const value of list) {
        const name = text(value, 120)
        if (name === '' || out.includes(name)) continue
        out.push(name)
        if (out.length >= 6) break
      }
      return out
    })()
    if (blockedBy.length > PLAN_LIMITS.maxBlockers) issues.push(`${at}.blockedBy exceeds ${PLAN_LIMITS.maxBlockers} entries`)
    if (parentId !== null && parentId === id) issues.push(`${at}.parentId cannot point at itself`)
    if (blockedBy.includes(id)) issues.push(`${at}.blockedBy cannot contain itself`)

    tasks.push({
      id,
      title,
      owner,
      stage,
      parentId,
      blockedBy,
      instructions: text(raw.instructions, PLAN_LIMITS.maxText) || null,
      acceptance: text(raw.acceptance, 500) || null,
      skill: text(raw.skill, 120) || null,
      requiredSkills,
    })
  }

  // Every reference must resolve inside this one submission: a plan cannot
  // depend on a card that does not exist yet.
  for (const task of tasks) {
    if (task.parentId !== null && !seen.has(task.parentId)) {
      issues.push(`tasks.${task.id}.parentId names an unknown task: ${task.parentId}`)
    }
    for (const blocker of task.blockedBy) {
      if (!seen.has(blocker)) issues.push(`tasks.${task.id}.blockedBy names an unknown task: ${blocker}`)
    }
  }

  if (seen.size > 0) {
    const blockedEdges = new Map(tasks.map(task => [task.id, task.blockedBy]))
    if (cycleIn(blockedEdges)) issues.push('blockedBy contains a cycle')
    const parentEdges = new Map(tasks.filter(task => task.parentId !== null).map(task => [task.id, [task.parentId]]))
    if (cycleIn(parentEdges)) issues.push('parentId contains a cycle')
  }

  const dispatchable = tasks.some(task => DISPATCH_STAGES.has(task.stage) && task.owner !== 'workbench')
  if (tasks.length > 0 && !dispatchable) {
    issues.push('a plan needs at least one dispatchable work item (a stage other than brief/roles, owner other than workbench)')
  }

  const roles = Array.isArray(source.roles)
    ? source.roles.filter(isPlainObject).slice(0, PLAN_LIMITS.maxRoles).map(role => ({
      role: text(role.role, 120),
      permissions: Array.isArray(role.permissions)
        ? role.permissions.map(value => text(value, 200)).filter(Boolean)
        : [],
    })).filter(role => role.role !== '')
    : []
  const design = isPlainObject(source.design) ? source.design : null

  if (issues.length > 0) {
    return { ok: false, issues, plan: null }
  }

  return {
    ok: true,
    issues: [],
    plan: {
      jobId: resolvedJobId,
      projectId: resolvedProjectId,
      brief,
      roles,
      design,
      tasks,
    },
  }
}

/** Throwing form used by the host tool. */
export function assertPlan(input, options) {
  const { ok, issues, plan } = checkPlan(input, options)
  if (!ok) throw new PlanError(issues)
  return plan
}

/**
 * The ledger lines one plan becomes: a `plan` marker, a build container card,
 * and one addressable card per work item. Appending them in this order means a
 * crash mid-write leaves a small, explainable partial plan rather than cards
 * with dangling parents.
 */
export function planEvents(plan, { now = new Date().toISOString(), by = 'agent' } = {}) {
  const idOf = localId => workItemId(plan.jobId, localId)
  const container = buildCardId(plan.jobId)
  const events = [
    planEvent({
      projectId: plan.projectId,
      jobId: plan.jobId,
      by,
      brief: plan.brief,
      roles: plan.roles,
      design: plan.design,
      tasks: plan.tasks.length,
      ts: now,
    }),
    taskEvent({
      event: 'created',
      taskId: container,
      projectId: plan.projectId,
      jobId: plan.jobId,
      stage: 'build',
      owner: 'workbench',
      role: '规划智能体',
      title: `实现（${plan.tasks.length} 个工作项）`,
      ts: now,
    }),
  ]

  for (const task of plan.tasks) {
    events.push(taskEvent({
      event: 'created',
      taskId: idOf(task.id),
      parentId: task.parentId === null ? container : idOf(task.parentId),
      projectId: plan.projectId,
      jobId: plan.jobId,
      stage: task.stage,
      owner: task.owner,
      title: task.title,
      instructions: task.instructions,
      acceptance: task.acceptance,
      skill: task.skill,
      ...(task.requiredSkills.length > 0 ? { requiredSkills: task.requiredSkills } : {}),
      blockedBy: task.blockedBy.map(idOf),
      ts: now,
    }))
  }
  return events
}
