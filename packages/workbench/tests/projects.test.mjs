import { test } from 'node:test'
import assert from 'node:assert/strict'

import { approvalEvent, artifactEvent, buildBoard, foldTasks, jobEvent, projectEvent, taskEvent } from '../projects.js'
import { summarize } from '../events.js'
import { decide } from '../router.js'

const ts = n => `2026-11-01T13:0${n}:00.000Z`

/* ── write side: a bad line must fail where it is written ─────────────── */

test('task/artefact/approval factories reject lines the board cannot render', () => {
  assert.equal(taskEvent({ event: 'created', taskId: 't1' }).kind, 'task')
  assert.throws(() => taskEvent({ event: 'exploded', taskId: 't1' }), /unknown task event/)
  assert.throws(() => taskEvent({ event: 'created' }), /taskId/)
  assert.throws(() => artifactEvent({ taskId: 't1' }), /path/)
  assert.throws(() => approvalEvent({ taskId: 't1' }), /action/)
  assert.throws(() => approvalEvent({ taskId: 't1', action: 'a', status: 'maybe' }), /approval status/)
  assert.equal(projectEvent({ projectId: 'p1' }).event, 'created')
  assert.throws(() => projectEvent({ projectId: 'p1', event: 'nope' }), /unknown project event/)
})

/* ── folding: tree, identity inheritance, dependency edges ─────────────── */

test('a subtask joins its parent and inherits the project and stage', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '报价单系统', ts: ts(0) }),
    taskEvent({ event: 'created', taskId: 't1', projectId: 'p1', stage: 'design', owner: 'pm', title: '出设计文档', ts: ts(1) }),
    taskEvent({ event: 'created', taskId: 't2', parentId: 't1', owner: 'frontend', title: '登录页', ts: ts(2) }),
  ]

  const { tasks, roots } = foldTasks(events)
  assert.equal(tasks.get('t2').parentId, 't1')
  assert.equal(tasks.get('t2').projectId, null, 'the fold does not invent fields')

  const board = buildBoard(events)
  const project = board.projects[0]
  assert.equal(project.title, '报价单系统')
  assert.equal(project.roots.length, 1)
  const root = project.roots[0]
  assert.equal(root.children.length, 1)
  assert.equal(root.children[0].projectId, 'p1', 'a subtask inherits the project')
  assert.equal(root.children[0].stage, 'design', 'a subtask inherits the stage')
  assert.equal(roots.length, 1)
})

test('a dependency edge blocks the task until the dependency is done', () => {
  const base = [
    taskEvent({ event: 'created', taskId: 'api', projectId: 'p1', stage: 'build', owner: 'backend', ts: ts(0) }),
    taskEvent({ event: 'created', taskId: 'ui', projectId: 'p1', stage: 'build', owner: 'frontend', blockedBy: ['api'], ts: ts(1) }),
    taskEvent({ event: 'created', taskId: 'orphan', projectId: 'p1', stage: 'build', blockedBy: ['ghost'], ts: ts(2) }),
  ]

  const waiting = buildBoard(base)
  assert.equal(waiting.projects[0].totals.blocked, 2, 'ui waits on api, orphan waits on a task that never appeared')

  const unblocked = buildBoard([...base, taskEvent({ event: 'done', taskId: 'api', ts: ts(3) })])
  assert.equal(unblocked.projects[0].totals.blocked, 1, 'a finished dependency releases its waiter')

  const done = buildBoard([
    ...base,
    taskEvent({ event: 'done', taskId: 'api', ts: ts(3) }),
    taskEvent({ event: 'done', taskId: 'orphan', ts: ts(4) }),
  ])
  assert.equal(done.projects[0].totals.blocked, 0)
})

/* ── decisions stay the same record, now attributed ────────────────────── */

test('a decision attaches to its task with owner and cost', () => {
  const events = [
    taskEvent({ event: 'claimed', taskId: 't1', projectId: 'p1', stage: 'build', owner: 'frontend', title: '改报价计算', ts: ts(0) }),
    decide('which_file', {
      value: 'src/quotes/pricing.ts',
      confidence: 0.94,
      rule: 'file:single-hit',
      projectId: 'p1',
      taskId: 't1',
      owner: 'frontend',
      ts: ts(1),
    }),
    decide('which_model', {
      value: 'deepseek-chat',
      confidence: 0.74,
      costUsd: 0.0021,
      projectId: 'p1',
      taskId: 't1',
      owner: 'frontend',
      ts: ts(2),
    }),
    decide('which_file', { value: 'unattributed', confidence: 0.9 }),
  ]

  const { tasks } = foldTasks(events)
  const node = tasks.get('t1')
  assert.equal(node.decisions, 2)
  assert.equal(node.owner, 'frontend')
  assert.equal(node.costUsd, 0.0021)
  assert.equal(tasks.has('unattributed'), false, 'a decision with no taskId belongs to no card')

  const board = buildBoard(events)
  const lane = board.projects[0].agents.find(agent => agent.owner === 'frontend')
  assert.equal(lane.counts.decisions, 2)
  assert.equal(lane.counts.costUsd, 0.0021)
})

test('task lines do not leak into the decision panel numbers', () => {
  const events = [
    taskEvent({ event: 'created', taskId: 't1', ts: ts(0) }),
    decide('which_file', { value: 'a', confidence: 0.9, lane: 'code', ts: ts(1) }),
  ]
  assert.equal(summarize(events).decisions, 1, 'the board and the panel share one file, not one schema')
})

test('a log written before `kind` existed still reads as decisions', () => {
  const legacy = [
    { seq: 0, decision: 'which_file', lane: 'code', confidence: 0.94, ts: ts(0) },
    { seq: 1, decision: 'is_done', lane: 'human', confidence: 0.19, status: 'waiting', lane2: 'x', ts: ts(1) },
  ]
  const summary = summarize(legacy)
  assert.equal(summary.decisions, 2)
  assert.equal(summary.held, 1)

  const board = buildBoard(legacy)
  assert.deepEqual(board.projects, [], 'no tasks means no board cards, not a crash')
  assert.equal(board.totals.tasks, 0)
})

/* ── board aggregation ────────────────────────────────────────────────── */

test('the stage rail follows the pipeline order, not the arrival order', () => {
  const events = [
    taskEvent({ event: 'done', taskId: 'v1', projectId: 'p1', stage: 'verify', ts: ts(0) }),
    taskEvent({ event: 'claimed', taskId: 'b1', projectId: 'p1', stage: 'build', ts: ts(1) }),
    taskEvent({ event: 'done', taskId: 'r1', projectId: 'p1', stage: 'roles', ts: ts(2) }),
  ]
  const board = buildBoard(events)
  assert.deepEqual(board.projects[0].stages.map(stage => stage.key), ['roles', 'build', 'verify'])
})

test('progress counts leaves, so a parent never inflates the denominator', () => {
  const events = [
    taskEvent({ event: 'created', taskId: 'epic', projectId: 'p1', stage: 'build', title: '实现报价单', ts: ts(0) }),
    taskEvent({ event: 'created', taskId: 'c1', parentId: 'epic', owner: 'fe', ts: ts(1) }),
    taskEvent({ event: 'created', taskId: 'c2', parentId: 'epic', owner: 'be', ts: ts(2) }),
    taskEvent({ event: 'done', taskId: 'c1', ts: ts(3) }),
  ]
  const project = buildBoard(events).projects[0]
  assert.deepEqual(project.progress, { done: 1, total: 2, ratio: 0.5 })
  assert.equal(project.totals.tasks, 3, 'every card is still counted as a task')
})

test('gates collect approval requests and waiting decisions, and nothing else', () => {
  const events = [
    taskEvent({ event: 'claimed', taskId: 't1', projectId: 'p1', stage: 'report', owner: 'lead', title: '开 PR', ts: ts(0) }),
    approvalEvent({ taskId: 't1', action: 'merge_pull_request', irreversible: true, ts: ts(1) }),
    approvalEvent({ taskId: 't1', action: 'add_label', status: 'approved', ts: ts(2) }),
    decide('ask_person', {
      value: 'yes',
      confidence: 0.46,
      action: 'delete_branch',
      projectId: 'p1',
      taskId: 't1',
      owner: 'lead',
      ts: ts(3),
    }),
  ]

  const project = buildBoard(events).projects[0]
  assert.equal(project.gates.length, 2, 'the approved gate is history, not work')
  assert.equal(project.gates[0].title, '开 PR')
  assert.equal(project.totals.waiting, 1)

  const approvalsOnly = project.gates.filter(gate => gate.action === 'merge_pull_request')
  assert.equal(approvalsOnly.length, 1)
  assert.equal(approvalsOnly[0].irreversible, true)
  const asks = project.gates.filter(gate => gate.decision === 'ask_person')
  assert.equal(asks.length, 1, 'a waiting decision is a gate too')
})

test('agent lanes show who holds what, and an unowned task is visible', () => {
  const events = [
    taskEvent({ event: 'claimed', taskId: 'f1', projectId: 'p1', stage: 'build', owner: 'frontend', role: '前端开发', ts: ts(0) }),
    taskEvent({ event: 'claimed', taskId: 'f2', projectId: 'p1', stage: 'build', owner: 'frontend', role: '前端开发', ts: ts(1) }),
    taskEvent({ event: 'claimed', taskId: 'b1', projectId: 'p1', stage: 'build', owner: 'backend', role: '后端开发', ts: ts(2) }),
    taskEvent({ event: 'created', taskId: 'x1', projectId: 'p1', stage: 'build', ts: ts(3) }),
  ]
  const lanes = buildBoard(events).projects[0].agents
  assert.deepEqual(lanes.map(lane => lane.owner), ['frontend', 'backend', 'unassigned'])
  assert.equal(lanes[0].role, '前端开发')
  assert.equal(lanes[0].counts.tasks, 2)
})

test('projects are separate boards, and a finished project keeps its title', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '报价单系统', ts: ts(0) }),
    projectEvent({ projectId: 'p2', title: '排班系统', ts: ts(1) }),
    taskEvent({ event: 'done', taskId: 'a1', projectId: 'p1', stage: 'brief', ts: ts(2) }),
    taskEvent({ event: 'created', taskId: 'b1', projectId: 'p2', stage: 'brief', ts: ts(3) }),
  ]
  const board = buildBoard(events)
  assert.equal(board.projects.length, 2)
  const boardP1 = board.projects.find(project => project.id === 'p1')
  assert.equal(boardP1.title, '报价单系统')
  assert.equal(boardP1.progress.ratio, 1)
  assert.equal(board.totals.tasks, 2)
})

test('a waiting gate carries the questions a person must answer', () => {
  const events = [
    taskEvent({ event: 'created', taskId: 'review', projectId: 'p1', stage: 'verify', title: '评审计划风险', ts: ts(0) }),
    decide('ask_person', {
      value: 'yes',
      confidence: 0.2,
      projectId: 'p1',
      taskId: 'review',
      owner: 'workbench',
      evidence: { questions: ['折扣审批几级？', '要不要版本历史？'] },
      ts: ts(1),
    }),
  ]
  const gate = buildBoard(events).projects[0].gates[0]
  assert.deepEqual(gate.questions, ['折扣审批几级？', '要不要版本历史？'])
})

test('the tree follows the log, and the rail order beats arrival order', () => {
  const events = [
    { ...taskEvent({ event: 'created', taskId: 'build-2', projectId: 'p1', stage: 'build', title: '第二件事' }), seq: 2, ts: ts(2) },
    { ...taskEvent({ event: 'created', taskId: 'build-1', projectId: 'p1', stage: 'build', title: '第一件事' }), seq: 1, ts: ts(1) },
    { ...taskEvent({ event: 'created', taskId: 'roles-1', projectId: 'p1', stage: 'roles', title: '角色' }), seq: 3, ts: ts(3) },
  ]
  const roots = buildBoard(events).projects[0].roots
  assert.deepEqual(roots.map(task => task.id), ['roles-1', 'build-1', 'build-2'],
    'roles stage first, then log order inside the build stage')
})

test('a project lists the artefacts its tasks produced', () => {
  const events = [
    taskEvent({ event: 'created', taskId: 't1', projectId: 'p1', stage: 'design', ts: ts(0) }),
    { ...artifactEvent({ taskId: 't1', path: 'deliveries/x/design.json' }), ts: ts(1) },
    { ...artifactEvent({ taskId: 't1', path: 'deliveries/x/roles.json' }), ts: ts(2) },
    { ...artifactEvent({ taskId: 't1', path: 'deliveries/x/design.json' }), ts: ts(3) },
  ]
  const project = buildBoard(events).projects[0]
  assert.deepEqual(project.artifacts, ['deliveries/x/design.json', 'deliveries/x/roles.json'])
})

test('two jobs in one project keep their cards and progress apart', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '公司管理', ts: ts(0) }),
    jobEvent({ projectId: 'p1', jobId: 'j1', title: '员工管理', brief: '加卡片', ts: ts(1) }),
    jobEvent({ projectId: 'p1', jobId: 'j2', title: '报销流程', brief: '报销', ts: ts(2) }),
    taskEvent({ event: 'created', taskId: 'j1:build', projectId: 'p1', jobId: 'j1', stage: 'build', owner: 'workbench', title: '实现', ts: ts(3) }),
    taskEvent({ event: 'done', taskId: 'j1:build', ts: ts(4) }),
    taskEvent({ event: 'created', taskId: 'j2:build', projectId: 'p1', jobId: 'j2', stage: 'build', owner: 'workbench', title: '实现', ts: ts(5) }),
  ]

  const project = buildBoard(events).projects[0]
  assert.equal(project.jobs.length, 2, 'a project holds one job per planning run')
  const j1 = project.jobs.find(job => job.id === 'j1')
  const j2 = project.jobs.find(job => job.id === 'j2')
  assert.equal(j1.title, '员工管理')
  assert.deepEqual(j1.roots.map(task => task.id), ['j1:build'], 'job 1 sees only its own cards')
  assert.deepEqual(j2.roots.map(task => task.id), ['j2:build'])
  assert.equal(j1.progress.done, 1)
  assert.equal(j2.progress.done, 0, 'job 1 finishing does not finish job 2')
  assert.equal(project.totals.tasks, 2, 'the project still aggregates both')
})

test('a log written before jobs existed still reads as one implicit job', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '老项目', ts: ts(0) }),
    taskEvent({ event: 'created', taskId: 'p1:build', projectId: 'p1', stage: 'build', title: '实现', ts: ts(1) }),
  ]
  const project = buildBoard(events).projects[0]
  assert.equal(project.jobs.length, 1)
  assert.equal(project.jobs[0].id, 'p1', 'the project id doubles as the implicit job id')
  assert.equal(project.jobs[0].title, '老项目')
  assert.deepEqual(project.jobs[0].roots.map(task => task.id), ['p1:build'])
})

test('an in-progress card carries what the agent said it is doing', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '公司管理', ts: ts(0) }),
    jobEvent({ projectId: 'p1', jobId: 'j1', title: '员工管理', ts: ts(1) }),
    taskEvent({ event: 'created', taskId: 'j1:wi:db', projectId: 'p1', jobId: 'j1', stage: 'build', owner: 'backend', title: '建表', ts: ts(2) }),
    taskEvent({ event: 'progress', taskId: 'j1:wi:db', notes: '正在写 schema.sql', ts: ts(3) }),
    taskEvent({ event: 'progress', taskId: 'j1:wi:db', notes: '正在跑迁移', ts: ts(4) }),
  ]
  const job = buildBoard(events).projects[0].jobs[0]
  assert.equal(job.running, 1)
  assert.equal(job.activity.length, 1)
  assert.equal(job.activity[0].taskId, 'j1:wi:db')
  assert.equal(job.activity[0].note, '正在跑迁移', 'the latest note wins')
  assert.equal(job.activity[0].startedAt, ts(3))
  assert.equal(job.activity[0].lastActiveAt, ts(4))

  const card = job.roots.find(task => task.id === 'j1:wi:db')
  assert.equal(card.status, 'active')
  assert.equal(card.lastNote, '正在跑迁移')
})

test('a job reads as done once every leaf card is done', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '公司管理', ts: ts(0) }),
    jobEvent({ projectId: 'p1', jobId: 'j1', title: '员工管理', ts: ts(1) }),
    taskEvent({ event: 'created', taskId: 'j1:build', projectId: 'p1', jobId: 'j1', stage: 'build', ts: ts(2) }),
    taskEvent({ event: 'created', taskId: 'j1:wi:a', parentId: 'j1:build', projectId: 'p1', jobId: 'j1', stage: 'build', title: 'A', ts: ts(3) }),
    taskEvent({ event: 'done', taskId: 'j1:wi:a', ts: ts(4) }),
  ]
  const project = buildBoard(events).projects[0]
  assert.equal(project.jobs[0].status, 'done', 'the job is finished, even though only planning announced it')
  assert.equal(project.status, 'done', 'the project mirrors its jobs')

  const cancelled = buildBoard([
    projectEvent({ projectId: 'p2', title: 'x', event: 'cancelled', ts: ts(0) }),
    jobEvent({ projectId: 'p2', jobId: 'p2', title: 'x', event: 'cancelled', ts: ts(1) }),
  ]).projects[0]
  assert.equal(cancelled.status, 'cancelled', 'a cancelled project stays cancelled')
})

test('a deleted project card disappears from the board but keeps its history', () => {
  const events = [
    projectEvent({ projectId: 'p1', title: '公司管理', ts: ts(0) }),
    jobEvent({ projectId: 'p1', jobId: 'j1', title: '员工管理', ts: ts(1) }),
    taskEvent({ event: 'created', taskId: 'j1:wi:a', projectId: 'p1', jobId: 'j1', stage: 'build', title: 'A', ts: ts(2) }),
    projectEvent({ projectId: 'p1', event: 'deleted', ts: ts(3) }),
  ]
  const board = buildBoard(events)
  assert.equal(board.projects.length, 0, 'the deleted card is gone from the board')
  assert.equal(board.totals.tasks, 0, 'and it stops contributing totals')

  const folded = foldTasks(events)
  assert.ok(folded.deletedProjects.has('p1'), 'the deletion is part of the folded history')
  assert.ok(folded.projects.has('p1') === false, 'but the project meta is not resurrected')
})
