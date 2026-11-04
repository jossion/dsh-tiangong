import { test } from 'node:test'
import assert from 'node:assert/strict'

import { inferTests, readyWork, reportEvents, testsGreen, workItemPrompt } from '../executor.js'
import { buildBoard, projectEvent, taskEvent } from '../projects.js'

const ts = n => `2026-11-01T14:0${n}:00.000Z`

/** A tiny project: one finished dependency, two ready items, one blocked. */
function boardFixture() {
  const events = [
    projectEvent({
      projectId: 'p1',
      title: '报价单系统',
      brief: '一个内部报价单系统',
      artifactDir: '/tmp/proj/p1',
      ts: ts(0),
    }),
    taskEvent({ event: 'created', taskId: 'p1:build', projectId: 'p1', stage: 'build', owner: 'workbench', title: '实现', ts: ts(1) }),
    taskEvent({ event: 'created', taskId: 'p1:wi:db', parentId: 'p1:build', projectId: 'p1', stage: 'build', owner: 'backend', role: '后端开发', title: '建表', instructions: '建 quote 表', ts: ts(2) }),
    taskEvent({ event: 'created', taskId: 'p1:wi:api', parentId: 'p1:build', projectId: 'p1', stage: 'build', owner: 'backend', role: '后端开发', title: '写接口', blockedBy: ['p1:wi:db'], ts: ts(3) }),
    taskEvent({ event: 'created', taskId: 'p1:wi:ui', parentId: 'p1:build', projectId: 'p1', stage: 'build', owner: 'frontend', role: '前端开发', title: '做页面', blockedBy: ['p1:wi:api'], ts: ts(4) }),
    taskEvent({ event: 'done', taskId: 'p1:wi:db', ts: ts(5) }),
  ]
  return buildBoard(events)
}

test('a work item is ready only when its dependencies are done', () => {
  const board = boardFixture()
  const { project, work } = readyWork(board)

  assert.equal(project.id, 'p1')
  assert.deepEqual(work.map(item => item.taskId), ['p1:wi:api'], 'db is done, api lost its blocker, ui still waits')

  const afterApi = buildBoard([
    ...boardEvents(board),
    taskEvent({ event: 'done', taskId: 'p1:wi:api', ts: ts(9) }),
  ])
  assert.deepEqual(readyWork(afterApi).work.map(item => item.taskId), ['p1:wi:ui'])
})

/** Rebuilds the events a board was folded from — the board itself is read-only. */
function boardEvents(board) {
  const events = []
  const walk = (tasks, stage) => {
    for (const task of tasks) {
      events.push(taskEvent({
        event: task.status === 'done' ? 'done' : 'created',
        taskId: task.id,
        parentId: task.parentId ?? null,
        projectId: task.projectId,
        stage: task.stage,
        owner: task.owner,
        role: task.role,
        title: task.title,
        instructions: task.instructions,
        blockedBy: task.blockedBy,
        ts: ts(0),
      }))
      walk(task.children, stage)
    }
  }
  walk(board.projects[0].roots, null)
  return events
}

test('the prompt names the plan files and forbids irreversible actions', () => {
  const project = { id: 'p1', title: '报价单系统', artifactDir: '/tmp/proj/p1' }
  const prompt = workItemPrompt({
    project,
    task: { title: '建表', role: '后端开发', instructions: '建 quote 表' },
    siblingTitles: ['写接口'],
  })
  assert.match(prompt, /Implement exactly one work item: 建表/)
  assert.match(prompt, /\/tmp\/proj\/p1\/design\.json/)
  assert.match(prompt, /建 quote 表/)
  assert.match(prompt, /Never merge, push, delete a branch/)
  assert.match(prompt, /"status":"done\|blocked\|failed"/)
})

test('done needs green tests, not a claim', () => {
  assert.equal(testsGreen({ exitCode: 0, passed: 12, failed: 0 }), true)
  assert.equal(testsGreen({ exitCode: 0, passed: 0, failed: 0 }), false, 'unrun tests prove nothing')
  assert.equal(testsGreen({ exitCode: 1, passed: 5, failed: 0 }), false)
  assert.equal(testsGreen({ exitCode: 0, passed: 5, failed: 1 }), false)
  assert.equal(testsGreen(null), false)
})

test('a prose report still yields the test numbers it mentions', () => {
  assert.deepEqual(inferTests('ran it, 12 passed, 0 failed'), { exitCode: 0, passed: 12, failed: 0 })
  assert.deepEqual(inferTests('nothing to run'), { exitCode: 0, passed: 0, failed: 0 })
})

test('a "done" report with failing tests becomes a blocked card on a person', () => {
  const board = boardFixture()
  const project = board.projects[0]
  const task = project.roots[0].children.find(item => item.id === 'p1:wi:api')

  const lines = reportEvents({
    task,
    project,
    report: {
      event: 'done',
      files: ['src/quotes.ts'],
      tests: { exitCode: 0, passed: 3, failed: 2 },
      notes: 'implemented, but two tests fail',
      ts: ts(6),
    },
  })

  assert.equal(lines[0].event, 'blocked', 'the card does not move to done')
  const done = lines.find(line => line.decision === 'is_done')
  assert.equal(done.lane, 'human', 'green tests are what move this to code')
  assert.equal(done.status, 'waiting')
  assert.equal(done.rule, 'tests:red')
})

test('a green report writes the transition, the files and the decisions', () => {
  const board = boardFixture()
  const project = board.projects[0]
  const task = project.roots[0].children.find(item => item.id === 'p1:wi:api')

  const lines = reportEvents({
    task,
    project,
    report: {
      event: 'done',
      files: ['src/quotes.ts'],
      linesChanged: 40,
      tests: { exitCode: 0, passed: 12, failed: 0 },
      notes: '12 passed',
      ts: ts(7),
    },
  })

  assert.equal(lines[0].kind, 'task')
  assert.equal(lines[0].event, 'done')
  assert.ok(lines.some(line => line.kind === 'artifact' && line.path === 'src/quotes.ts'))

  const whichFile = lines.find(line => line.decision === 'which_file')
  assert.equal(whichFile.lane, 'code')
  assert.equal(whichFile.value, 'src/quotes.ts')
  assert.equal(whichFile.rule, 'file:reported:1')

  const done = lines.find(line => line.decision === 'is_done')
  assert.equal(done.lane, 'code', 'one file and green tests is mechanical')
  assert.equal(done.rule, 'tests:green')

  const risk = lines.find(line => line.decision === 'diff_risk')
  assert.ok(risk.value < 3, 'one small file is a small diff')
  assert.equal(risk.rule, 'diff:static')

  for (const line of lines.filter(item => item.decision)) {
    assert.equal(line.owner, 'backend', 'every judgement names the agent that made it')
    assert.equal(line.taskId, 'p1:wi:api')
    assert.equal(line.projectId, 'p1')
  }
})

test('a wide report is a less certain "which file"', () => {
  const board = boardFixture()
  const project = board.projects[0]
  const task = project.roots[0].children.find(item => item.id === 'p1:wi:api')
  const lines = reportEvents({
    task,
    project,
    report: { event: 'done', files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'], tests: { exitCode: 0, passed: 4, failed: 0 } },
  })
  const whichFile = lines.find(line => line.decision === 'which_file')
  assert.equal(whichFile.value, '4 个文件')
  assert.ok(whichFile.confidence < 0.5, 'four files is not a precise answer')
})

test('claiming a card does not open a gate: progress writes no decisions', () => {
  const board = boardFixture()
  const project = board.projects[0]
  const task = project.roots[0].children.find(item => item.id === 'p1:wi:api')

  const lines = reportEvents({ task, project, report: { event: 'progress', notes: 'agent took it' } })
  assert.equal(lines.length, 1, 'one task line, no decision lines')
  assert.equal(lines[0].kind, 'task')
  assert.equal(lines[0].event, 'progress')
})

test('a queue is scoped to one job, and a paused job hands out nothing', () => {
  const leaf = (id, owner) => ({ id, title: id, owner, role: owner, stage: 'build', status: 'todo', children: [], openBlockers: [], decisions: 0 })
  const board = {
    projects: [{
      id: 'p1',
      status: 'started',
      roots: [],
      jobs: [
        { id: 'j1', status: 'started', roots: [leaf('j1:wi:a', 'backend')] },
        { id: 'j2', status: 'paused', roots: [leaf('j2:wi:b', 'frontend')] },
      ],
    }],
  }
  assert.deepEqual(readyWork(board, { jobId: 'j1' }).work.map(item => item.taskId), ['j1:wi:a'])
  const paused = readyWork(board, { jobId: 'j2' })
  assert.deepEqual(paused.work, [])
  assert.equal(paused.stopped, 'paused', 'the job status, not the project status, gates the queue')
})

test('a design-stage contract card is dispatchable work', () => {
  const board = buildBoard([
    projectEvent({ projectId: 'p1', title: '报价单系统', ts: ts(0) }),
    taskEvent({ event: 'created', taskId: 'p1:build', projectId: 'p1', stage: 'build', owner: 'workbench', title: '实现', ts: ts(1) }),
    taskEvent({
      event: 'created', taskId: 'p1:wi:contract', parentId: 'p1:build', projectId: 'p1',
      stage: 'design', owner: 'backend', role: '后端开发', title: '接口契约定稿', ts: ts(2),
    }),
    taskEvent({
      event: 'created', taskId: 'p1:wi:data', parentId: 'p1:build', projectId: 'p1',
      stage: 'build', owner: 'backend', role: '后端开发', title: '数据层', blockedBy: ['p1:wi:contract'], ts: ts(3),
    }),
    // A planning-only card is still never handed out, even when it is a leaf.
    taskEvent({
      event: 'created', taskId: 'p1:wi:brief', parentId: 'p1:build', projectId: 'p1',
      stage: 'brief', owner: 'backend', role: '后端开发', title: '需求拆解', ts: ts(4),
    }),
  ])
  assert.deepEqual(
    readyWork(board).work.map(item => item.taskId),
    ['p1:wi:contract'],
    'the design card is ready and the build card behind it is not',
  )
})
