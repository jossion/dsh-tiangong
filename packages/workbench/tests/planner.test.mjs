import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PlanError,
  assertPlan,
  buildCardId,
  checkPlan,
  planEvents,
  workItemId,
} from '../planner.js'
import { buildBoard, foldTasks, jobEvent, projectEvent } from '../projects.js'

const base = {
  jobId: 'job-1',
  projectId: 'prj-1',
  brief: '员工管理',
  tasks: [
    { id: 'db', title: '建员工表', owner: 'backend', stage: 'build' },
    { id: 'api', title: '员工 API', owner: 'backend', stage: 'build', blockedBy: ['db'] },
    { id: 'ui', title: '员工列表页', owner: 'frontend', stage: 'build', blockedBy: ['api'] },
    { id: 'qa', title: '回归测试', owner: 'qa', stage: 'verify', blockedBy: ['ui', 'ui'] },
  ],
}

/* ── normalization ────────────────────────────────────────────────────── */

test('a valid plan normalizes defaults and de-duplicates blockers', () => {
  const { ok, issues, plan } = checkPlan(base)
  assert.equal(ok, true)
  assert.deepEqual(issues, [])
  assert.equal(plan.jobId, 'job-1')
  assert.equal(plan.projectId, 'prj-1')
  assert.equal(plan.tasks.length, 4)
  assert.equal(plan.tasks[0].owner, 'backend')
  assert.equal(plan.tasks[0].stage, 'build')
  assert.deepEqual(plan.tasks[3].blockedBy, ['ui'])
  assert.equal(plan.tasks[0].parentId, null)
})

test('owner and stage have safe defaults, but bad values are rejected', () => {
  const defaults = checkPlan({ ...base, tasks: [{ id: 'a', title: 'x' }] })
  assert.equal(defaults.plan.tasks[0].owner, 'backend')
  assert.equal(defaults.plan.tasks[0].stage, 'build')

  const badOwner = checkPlan({ ...base, tasks: [{ id: 'a', title: 'x', owner: 'designer' }] })
  assert.equal(badOwner.ok, false)
  assert.match(badOwner.issues.join('; '), /owner must be one of/)

  const badStage = checkPlan({ ...base, tasks: [{ id: 'a', title: 'x', stage: 'deploy' }] })
  assert.equal(badStage.ok, false)
  assert.match(badStage.issues.join('; '), /stage must be one of/)
})

/* ── rejection: one round-trip must fix everything ────────────────────── */

test('shape errors are reported together, not one at a time', () => {
  const { ok, issues } = checkPlan({
    jobId: 'j',
    projectId: 'p',
    tasks: [
      { id: 'a', title: '' },
      { id: 'a', title: 'dup' },
      { id: 'b', title: 'x', owner: 'nope' },
      { id: 'c', title: 'y', stage: 'nope' },
      { id: 'd', title: 'z', blockedBy: ['missing'], parentId: 'missing' },
    ],
  })
  assert.equal(ok, false)
  assert.ok(issues.length >= 5, `expected several issues, got ${issues.length}: ${issues.join('; ')}`)
  assert.ok(issues.some(issue => /duplicated/.test(issue)))
  assert.ok(issues.some(issue => /unknown task/.test(issue)))
})

test('empty plans, cycles and self-references are rejected', () => {
  assert.equal(checkPlan({ ...base, tasks: [] }).ok, false)
  assert.match(checkPlan({ ...base, tasks: [] }).issues.join('; '), /non-empty/)

  const cycle = checkPlan({
    ...base,
    tasks: [
      { id: 'a', title: 'a', blockedBy: ['b'] },
      { id: 'b', title: 'b', blockedBy: ['a'] },
    ],
  })
  assert.equal(cycle.ok, false)
  assert.match(cycle.issues.join('; '), /blockedBy contains a cycle/)

  const parentCycle = checkPlan({
    ...base,
    tasks: [
      { id: 'a', title: 'a', parentId: 'b' },
      { id: 'b', title: 'b', parentId: 'a' },
    ],
  })
  assert.equal(parentCycle.ok, false)
  assert.match(parentCycle.issues.join('; '), /parentId contains a cycle/)

  const selfBlock = checkPlan({
    ...base,
    tasks: [{ id: 'a', title: 'a', blockedBy: ['a'] }],
  })
  assert.equal(selfBlock.ok, false)
  assert.match(selfBlock.issues.join('; '), /cannot contain itself/)
})

test('a plan with nothing to dispatch is rejected', () => {
  const { ok, issues } = checkPlan({
    ...base,
    tasks: [
      { id: 'brief', title: '解析需求', stage: 'brief', owner: 'workbench' },
      { id: 'design', title: '数据模型', stage: 'design', owner: 'workbench' },
    ],
  })
  assert.equal(ok, false)
  assert.match(issues.join('; '), /dispatchable work item/)
})

test('assertPlan throws one PlanError carrying every issue', () => {
  assert.throws(() => assertPlan({ ...base, tasks: [] }), error => {
    assert.ok(error instanceof PlanError)
    assert.match(error.message, /invalid plan/)
    assert.ok(error.issues.length > 0)
    return true
  })
})

/* ── ledger lines ─────────────────────────────────────────────────────── */

test('planEvents emits the marker, a container card and addressable work items', () => {
  const plan = assertPlan(base)
  const events = planEvents(plan, { now: '2026-11-03T00:00:00.000Z' })

  assert.equal(events.length, 2 + plan.tasks.length)
  assert.equal(events[0].kind, 'plan')
  assert.equal(events[0].by, 'agent')
  assert.equal(events[0].tasks, 4)

  const container = events[1]
  assert.equal(container.taskId, buildCardId('job-1'))
  assert.equal(container.owner, 'workbench')

  const api = events.find(event => event.taskId === workItemId('job-1', 'api'))
  assert.equal(api.parentId, buildCardId('job-1'))
  assert.deepEqual(api.blockedBy, [workItemId('job-1', 'db')])

  const ui = events.find(event => event.taskId === workItemId('job-1', 'ui'))
  assert.equal(ui.owner, 'frontend')
  assert.equal(ui.kind, 'task')
})

test('an explicit parent nests under that card instead of the container', () => {
  const plan = assertPlan({
    ...base,
    tasks: [
      { id: 'api', title: '员工 API', owner: 'backend', stage: 'build' },
      { id: 'api-edit', title: '编辑接口', owner: 'backend', stage: 'build', parentId: 'api' },
    ],
  })
  const events = planEvents(plan)
  const child = events.find(event => event.taskId === workItemId('job-1', 'api-edit'))
  assert.equal(child.parentId, workItemId('job-1', 'api'))
})

/* ── projection: a plan is visible on the board ───────────────────────── */

test('the board exposes the plan marker and keeps skill/acceptance on cards', () => {
  const plan = assertPlan({
    ...base,
    tasks: [{ id: 'db', title: '建员工表', owner: 'backend', skill: 'tdd', acceptance: '迁移可回滚' }],
  })
  const events = [
    projectEvent({ projectId: 'prj-1', title: '公司管理', ts: '2026-11-03T00:00:00.000Z' }),
    jobEvent({ projectId: 'prj-1', jobId: 'job-1', title: '员工管理', ts: '2026-11-03T00:00:01.000Z' }),
    ...planEvents(plan, { now: '2026-11-03T00:00:02.000Z' }),
  ]

  const board = buildBoard(events)
  const job = board.projects[0].jobs[0]
  assert.equal(job.planBy, 'agent')
  assert.equal(job.planAt, '2026-11-03T00:00:02.000Z')

  const { tasks } = foldTasks(events)
  const card = tasks.get(workItemId('job-1', 'db'))
  assert.equal(card.skill, 'tdd')
  assert.equal(card.acceptance, '迁移可回滚')
  assert.equal(card.owner, 'backend')
})

test('design-stage work is dispatchable; brief/roles stay planning-only', () => {
  const design = checkPlan({
    ...base,
    tasks: [{ id: 'contract', title: '接口契约定稿', stage: 'design', owner: 'backend' }],
  })
  assert.equal(design.ok, true, design.issues.join('; '))

  const brief = checkPlan({
    ...base,
    tasks: [{ id: 'brief', title: '需求拆解', stage: 'brief', owner: 'backend' }],
  })
  assert.equal(brief.ok, false)
  assert.match(brief.issues.join('; '), /dispatchable work item/)
})

test('a plan assigns required skills per card, capped and deduplicated', () => {
  const { ok, plan } = checkPlan({
    ...base,
    tasks: [{
      id: 'db', title: '建员工表', owner: 'backend', stage: 'build',
      skills: ['office', 'office', 'create-implementation-plan', 'a', 'b', 'c', 'd'],
    }],
  })
  assert.equal(ok, true)
  assert.deepEqual(plan.tasks[0].requiredSkills, ['office', 'create-implementation-plan', 'a', 'b', 'c', 'd'])
  const events = planEvents(plan, { now: '2026-11-05T00:00:00.000Z' })
  const created = events.find(event => event.kind === 'task' && event.event === 'created' && event.taskId === workItemId('job-1', 'db'))
  assert.deepEqual(created.requiredSkills, ['office', 'create-implementation-plan', 'a', 'b', 'c', 'd'])
})
