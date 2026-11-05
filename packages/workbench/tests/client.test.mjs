import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The panel is browser code, so it has no renderer here. This harness loads
 * the real bundle with a stub React and calls the components directly: enough
 * to catch a missing variable or a broken hook order, which otherwise shows up
 * as an empty slot and a console error in the live app.
 */
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8')
let factory = null
globalThis.window = {
  __ModuleLoader__: { load: module => { factory = module.factory } },
}
// eslint-disable-next-line no-new-func
new Function('window', code)(globalThis.window)
assert.equal(typeof factory, 'function', 'the bundle registers a factory')

function stubReact() {
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.length <= 1 ? children[0] : children },
  })
  const useState = initial => [
    typeof initial === 'function' ? initial() : initial,
    () => {},
  ]
  return {
    createElement,
    useState,
    useEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useRef: () => ({ current: null }),
  }
}

const module = factory(name => {
  if (name !== 'react') throw new Error(`unexpected require: ${name}`)
  return stubReact()
})
const { ProjectCard, ProjectDetail, ProjectHome, TaskList, TeamGraphCard, FloatingPanel, Dialog, JobConversation, createSessionBridge, teamGraph } = module.__components

const project = {
  id: 'prj_1',
  title: '公司管理',
  brief: '一句话需求',
  artifactDir: null,
  totals: { tasks: 3, done: 1, active: 1, blocked: 1, failed: 0, todo: 0, waiting: 0, decisions: 2, costUsd: 0 },
  progress: { done: 1, total: 3, ratio: 0.33 },
  stages: [{ key: 'build', order: 3, tasks: [], counts: { tasks: 3, done: 1, active: 1, blocked: 1, failed: 0, todo: 0, waiting: 0, decisions: 0, costUsd: 0 } }],
  agents: [{ owner: 'backend', role: '后端开发', counts: { tasks: 2, done: 1, active: 1, blocked: 0, failed: 0, todo: 0, waiting: 0, decisions: 0, costUsd: 0 }, gates: 0 }],
  gates: [{ id: 'g1', taskId: 'prj_1:wi:db', title: '建表', action: 'merge_pull_request', status: 'requested', irreversible: true }],
  roots: [{
    id: 'prj_1:wi:db',
    title: '建表',
    owner: 'backend',
    role: '后端开发',
    stage: 'build',
    status: 'active',
    instructions: '建表',
    blockedBy: [],
    openBlockers: [],
    decisions: 2,
    children: [],
  }],
}

const t = key => key

test('the project detail page renders instead of throwing', () => {
  const element = ProjectDetail({ t, project, summary: { decisions: 2, lanes: { counts: {}, split: {} } }, events: [], onBack: () => {} })
  assert.equal(element.type, 'div')
  assert.ok(Array.isArray(element.props.children), 'the page has sections')
})

test('the team graph draws every card it was given', () => {
  const element = TeamGraphCard({ t, project })
  let svg = null
  walk(element, node => { if (node.type === 'svg') svg = node })
  assert.ok(svg, 'the graph card contains an svg')
  // Zoom/pan now live on the wrapper div, so the SVG renders at natural size
  // and a tiny project is not stretched to fill the card.
  let moved = null
  walk(element, node => {
    const transform = node.props && node.props.style && node.props.style.transform
    if (typeof transform === 'string' && transform.includes('translate(') && transform.includes('scale(')) moved = node
  })
  assert.ok(moved, 'a wrapper carries the zoom/pan transform')
})

test('the task dialog renders with its confirm label', () => {
  const element = Dialog({ title: 'x', confirmLabel: '开工', cancelLabel: '取消', onCancel: () => {}, onConfirm: () => {} })
  assert.equal(element.type, 'div')
})

/** Depth-first walk over the stub element tree. */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  // A function-type node is a component: render it the way the loader would.
  if (typeof node.type === 'function') { walk(node.type(node.props), visit); return }
  visit(node)
  if (node.props && node.props.children !== undefined) walk(node.props.children, visit)
}

test('every small control is at least a 32px touch target', () => {
  const element = TeamGraphCard({ t, project })
  const controls = []
  walk(element, node => {
    if (node.props && (node.props.title === 'zoom in' || node.props.title === 'zoom out' || node.props.title === 'fit')) {
      controls.push(node)
    }
  })
  assert.equal(controls.length, 3, 'zoom out, zoom in and fit')
  for (const control of controls) {
    assert.equal(control.props.style.minWidth, '32px', `${control.props.title} min width`)
    assert.equal(control.props.style.minHeight, '32px', `${control.props.title} min height`)
    assert.equal(control.props.style.display, 'inline-flex')
  }
})

test('the detail header back chip and the dialog cancel carry the same target size', () => {
  const page = ProjectDetail({ t, project, summary: {}, events: [], onBack: () => {} })
  let back = null
  walk(page, node => {
    if (node.props && node.props.children === 'backToCards') back = node
  })
  assert.ok(back, 'the back chip is rendered')
  assert.equal(back.props.style.minHeight, '32px')

  const dialog = Dialog({ title: 'x', confirmLabel: 'ok', cancelLabel: 'cancel', onCancel: () => {}, onConfirm: () => {} })
  let cancel = null
  walk(dialog, node => {
    if (node.props && node.props.children === 'cancel') cancel = node
  })
  assert.ok(cancel, 'the cancel button is rendered')
  assert.equal(cancel.props.style.minHeight, '32px')
})

test('the detail header back chip and the dialog cancel carry the same target size', () => {
  const page = ProjectDetail({ t, project, summary: {}, events: [], onBack: () => {} })
  let back = null
  walk(page, node => {
    if (node.props && node.props.children === 'backToCards') back = node
  })
  assert.ok(back, 'the back chip is rendered')
  assert.equal(back.props.style.minHeight, '32px')

  const dialog = Dialog({ title: 'x', confirmLabel: 'ok', cancelLabel: 'cancel', onCancel: () => {}, onConfirm: () => {} })
  let cancel = null
  walk(dialog, node => {
    if (node.props && node.props.children === 'cancel') cancel = node
  })
  assert.ok(cancel, 'the cancel button is rendered')
  assert.equal(cancel.props.style.minHeight, '32px')
})

test('cards are floating nodes with drag handlers, and each lane has a grip', () => {
  const element = TeamGraphCard({ t, project })
  const draggableCards = []
  const grips = []
  walk(element, node => {
    const props = node.props || {}
    if (typeof props.onPointerDown !== 'function') return
    if (props.style && props.style.position !== 'absolute') return
    if (typeof props.title === 'string' && props.title.endsWith('· drag')) grips.push(node)
    else draggableCards.push(node)
  })
  assert.ok(draggableCards.length >= 1, 'at least one card is draggable')
  assert.ok(grips.length >= 1, 'the lane chip is the group drag handle')
  assert.equal(draggableCards[0].props.style.left.endsWith('px'), true, 'positions are explicit pixels')
})

test('the dev page can pause, resume and stop the project', () => {
  const calls = []
  const running = ProjectDetail({
    t,
    project: { ...project, status: 'started' },
    summary: {},
    events: [],
    onBack: () => {},
    onControl: action => calls.push(action),
  })
  const buttons = []
  walk(running, node => { if (node.type === 'button') buttons.push(node) })
  const pause = buttons.find(button => button.props.children === 'pauseRun')
  assert.ok(pause, 'a running project offers pause')
  pause.props.onClick()
  assert.deepEqual(calls, ['pause'])

  const paused = ProjectDetail({
    t,
    project: { ...project, status: 'paused' },
    summary: {},
    events: [],
    onBack: () => {},
    onControl: action => calls.push(action),
  })
  const pausedButtons = []
  walk(paused, node => { if (node.type === 'button') pausedButtons.push(node) })
  pausedButtons.find(button => button.props.children === 'resumeRun').props.onClick()
  assert.deepEqual(calls, ['pause', 'resume'])

  // Terminating only closes the dispatch queue: the toolbar offers resume again,
  // because agents that were already running keep reporting after a stop.
  const cancelled = ProjectDetail({
    t,
    project: { ...project, status: 'cancelled' },
    summary: {},
    events: [],
    onBack: () => {},
    onControl: action => calls.push(action),
  })
  const cancelledButtons = []
  walk(cancelled, node => { if (node.type === 'button') cancelledButtons.push(node) })
  const resume = cancelledButtons.find(button => button.props.children === 'resumeRun')
  assert.ok(resume, 'a stopped project can be resumed')
  resume.props.onClick()
  assert.deepEqual(calls, ['pause', 'resume', 'resume'])
  assert.equal(cancelledButtons.some(button => button.props.children === 'pauseRun'), false, 'pause is not offered on a stopped scope')
})

test('the project page is a canvas carrying HUD panels', () => {
  const page = ProjectDetail({
    t,
    project: { ...project, status: 'started' },
    summary: { decisions: 2, lanes: { counts: {}, split: {} } },
    events: [],
    onBack: () => {},
    onControl: () => {},
  })
  const seen = new Set()
  walk(page, node => {
    const children = (node.props || {}).children
    if (typeof children === 'string') seen.add(children)
  })
  for (const title of ['boardGates', 'boardProgress', 'boardFlowStages', 'boardTasks', 'streamTitle', 'deliverableTitle']) {
    assert.ok(seen.has(title), `${title} is on the canvas`)
  }
})

test('a floating panel carries a draggable header and a collapse control', () => {
  const panel = FloatingPanel({
    t,
    projectId: 'p1',
    panelId: 'gates',
    title: '待你决定',
    node: 'panel-body',
    defaultPos: { x: 24, y: 32 },
    width: 280,
  })
  assert.equal(panel.props.style.position, 'absolute')
  assert.equal(panel.props.style.left, '24px')
  assert.equal(panel.props.style.top, '32px')

  const headers = []
  let body = null
  walk(panel, node => {
    const props = node.props || {}
    if (typeof props.onPointerDown === 'function' && props.style && props.style.cursor === 'grab') headers.push(node)
    if (props.children === 'panel-body') body = node
  })
  assert.equal(headers.length, 1, 'exactly one drag handle: the header')
  assert.ok(body, 'the panel body renders its node')
})

test('panel docking stays inside the canvas on a narrow viewport', () => {
  // Fit is measured by ResizeObserver in the browser; without one the size is
  // zero, and the dock must still clamp to the left edge instead of going off-canvas.
  const element = TeamGraphCard({ t, project, panels: [{ id: 'gates', title: 'g', node: 'x', dock: 'right', width: 300 }], fill: true })
  const positions = []
  walk(element, node => {
    const style = (node.props || {}).style
    // Panels only: corner brackets are absolutely positioned too, at -1px.
    if (style && style.position === 'absolute' && style.zIndex === 6 && typeof style.left === 'string') {
      positions.push(parseInt(style.left, 10))
    }
  })
  assert.ok(positions.every(value => value >= 0), `no panel starts off-canvas: ${positions}`)
})

const jobOf = (id, title, done, total, extra = {}) => ({
  id,
  projectId: 'prj_1',
  title,
  status: 'started',
  progress: { done, total, ratio: total ? done / total : 0 },
  totals: { tasks: total, done, active: 0, blocked: 2, failed: 0, todo: 0, waiting: 0, decisions: 0, costUsd: 0 },
  gates: [{ id: 'g', title: 'q', decision: 'ask_person', status: 'requested', taskId: 't' }],
  stages: [],
  agents: [],
  roots: [],
  artifacts: [],
  ...extra,
})

test('the project page shows deliverables and one way into the tasks', () => {
  const opened = []
  const page = ProjectHome({
    t,
    project: { ...project, jobs: [jobOf('j1', '员工管理', 5, 14), jobOf('j2', '报销流程', 0, 4)], artifacts: ['x/design.json'] },
    onBack: () => opened.push('back'),
    onOpenTasks: () => opened.push('tasks'),
    onNewTask: () => opened.push('new'),
  })
  const strings = []
  let iframes = 0
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
    if (typeof props.text === 'string') strings.push(props.text)
    if (node.type === 'iframe') iframes += 1
    if (typeof props.onClick === 'function' && props.children === 'tabTasks · 2') props.onClick()
  })
  assert.ok(strings.includes('x/design.json'), 'artefacts are the deliverable')
  assert.equal(iframes, 0, 'the deliverables page never embeds an app')
  assert.deepEqual(opened, ['tasks'])
})

test('the task list renders one card per job and opens the right cockpit', () => {
  const jobs = [jobOf('j1', '员工管理', 5, 14), jobOf('j2', '报销流程', 1, 4)]
  const opened = []
  const page = TaskList({
    t,
    project: { ...project, jobs },
    onBack: () => {},
    onOpenJob: id => opened.push(id),
    onNewTask: () => {},
  })
  const cards = []
  const texts = []
  const collect = node => {
    if (!node || typeof node !== 'object') return []
    const props = node.props || {}
    const out = typeof props.children === 'string' ? [props.children] : []
    const children = Array.isArray(props.children) ? props.children : [props.children]
    for (const child of children) out.push(...collect(child))
    return out
  }
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.onClick === 'function') cards.push({ click: props.onClick, labels: collect(node) })
    if (typeof props.children === 'string') texts.push(props.children)
  })
  const target = cards.find(card => card.labels.some(label => label === '员工管理'))
  assert.ok(target, 'a card exists for the task')
  target.click()
  assert.deepEqual(opened, ['j1'], 'clicking a task card opens that job')
  assert.ok(texts.includes('员工管理'))
  assert.ok(texts.includes('报销流程'))
})

test('a running job shows a live badge and the current activity', () => {
  const runningJob = {
    ...jobOf('j1', '员工管理', 5, 14),
    running: 1,
    activity: [{ taskId: 'j1:wi:db', title: '创建员工表', owner: 'backend', note: '正在跑迁移', lastActiveAt: new Date().toISOString(), startedAt: new Date().toISOString() }],
  }
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [runningJob] },
    job: runningJob,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
  })
  const strings = []
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
  })
  assert.ok(strings.includes('● boardLive 1'), 'the header says work is live')
  assert.ok(strings.includes('正在跑迁移'), 'the current activity is on screen')
  assert.ok(strings.includes('boardLive'), 'the live block is rendered')
})

test('the cockpit rails show the same counts without overlapping', () => {
  const page = ProjectDetail({
    t,
    project: { ...project, status: 'started' },
    summary: { decisions: 22, lanes: { counts: {}, split: {} } },
    events: [],
    onBack: () => {},
    onControl: () => {},
  })
  const strings = []
  const floating = []
  walk(page, node => {
    const props = node.props || {}
    const style = props.style || {}
    if (typeof props.children === 'string') strings.push(props.children)
    // Old HUD panels were absolutely positioned; rails are normal blocks.
    // HUD panels carried zIndex 6; graph cards are also absolute but not panels.
    if (style.position === 'absolute' && style.zIndex === 6) floating.push(style.width)
  })
  assert.deepEqual(floating, [], 'no floating HUD panels remain in the cockpit')
  assert.ok(strings.some(text => text.includes('panelsToggle') || text.includes('panelsHide')), 'the rail toggle is on the toolbar')
  assert.ok(strings.includes('0/1'), 'the stages rail still reports its count')
  assert.ok(strings.includes('22'), 'the decision rail still reports its count')
  assert.ok(strings.includes('▸') || strings.includes('▾'), 'rail headers still collapse')
})

test('a gate can be approved or rejected from the panel', () => {
  const calls = []
  const gate = { id: 'g1', taskId: 'p1:wi:a', action: 'merge_pull_request', title: '合并 PR', status: 'requested', blocking: true, irreversible: true }
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [jobOf('j1', '员工管理', 1, 4)], gates: [gate] },
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: (g, decision) => calls.push([g.id, decision]),
  })
  const buttons = []
  walk(page, node => {
    if (node.type !== 'button') return
    const labels = []
    walk(node.props.children, child => { if (typeof (child.props || {}).children === 'string') labels.push(child.props.children) })
    const own = typeof node.props.children === 'string' ? node.props.children : null
    if (own === 'approve' || own === 'reject') buttons.push(node)
    void labels
  })
  assert.equal(buttons.length >= 2, true, 'approve and reject are rendered for the gate')
  buttons[0].props.onClick()
  buttons[1].props.onClick()
  assert.deepEqual(calls, [['g1', 'approve'], ['g1', 'reject']])
  assert.ok(true)
})

test('the plugin registers its sidebar entry and main surface', () => {
  const registered = []
  const optional = []
  const slots = {
    inject(name, fn) { fn() },
    register(spec) { registered.push({ name: spec.name, id: spec.id }); return () => {} },
  }
  const locale = { register: () => () => {}, bind: () => key => key }
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return stubReact()
  })
  api.apply({
    effect(fn) { fn() },
    slots,
    locale,
    inject(names, fn) { optional.push(names); fn({ sessions: {}, conversation: {}, workspaces: {} }); return () => {} },
  })
  assert.deepEqual(optional, [['sessions', 'conversation', 'workspaces']], 'session services are optional, not startup blockers')
  assert.ok(registered.some(entry => entry.name === 'sidebar.panellist' && entry.id === 'workbench'),
    'without this the Workbench entry disappears from the DSH sidebar')
  assert.ok(registered.some(entry => entry.name === 'main'), 'the main surface is registered too')
})

test('the panel itself renders with its title and no data', () => {
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return stubReact()
  })
  const tree = api.__components.Panel({})
  const strings = []
  const walkTypes = node => {
    if (!node || typeof node !== 'object') return
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
    if (Array.isArray(props.children)) props.children.forEach(walkTypes)
    else walkTypes(props.children)
  }
  walkTypes(tree)
  assert.ok(strings.includes('天工'), 'the panel paints its heading before any fetch')
})

test('edges always drift, but a running edge moves faster', () => {
  const base = code.match(/\.wb-edge \{[^}]*\}/)
  const active = code.match(/\.wb-edge-active \{[^}]*\}/)
  assert.ok(base && /animation\s*:\s*wb-flow/.test(base[0]), 'the dashed flow is part of the look')
  // Without fill:none an open path is filled black: the edge becomes a dark
  // ribbon that runs beside the dashed line instead of along it.
  assert.ok(base && /fill\s*:\s*none/.test(base[0]), 'edges are lines, not filled shapes')
  assert.ok(active && /animation-duration\s*:\s*1\.1s/.test(active[0]), 'a running edge is clearly faster than the base 3.2s')
  const baseDuration = Number((base[0].match(/wb-flow (\d+(?:\.\d+)?)s/) || [])[1])
  assert.ok(baseDuration > 2, 'the resting flow must stay calm')
})

const leaf = (id, owner, status = 'done', title = id) => ({
  id, title, owner, role: owner, stage: 'build', status,
  children: [], openBlockers: [], decisions: 0, lastNote: null,
})

test('the cockpit graph draws the selected job, never its sibling jobs', () => {
  // A project is a container; a job is one requirement. The finance cockpit
  // once showed the employee management cards because the graph read
  // `project.roots` instead of the job's roots.
  const employeeJob = jobOf('j_employee', '员工管理', 1, 1, {
    roots: [leaf('j_employee:wi:db', 'backend', 'done', '创建员工数据库表')],
  })
  const financeJob = jobOf('j_finance', '财务管理', 0, 2, {
    roots: [
      leaf('j_finance:wi:batch', 'backend', 'todo', '创建导入批次与流水交易数据表'),
      leaf('j_finance:wi:dashboard', 'frontend', 'todo', '实现可交互财务数据看板页'),
    ],
  })
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [employeeJob, financeJob] },
    job: financeJob,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
  })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('创建导入批次与流水交易数据表'), 'the job task is on its own canvas')
  assert.ok(strings.includes('实现可交互财务数据看板页'), 'the frontend task is too')
  assert.ok(!strings.includes('创建员工数据库表'), 'the sibling job cards must not leak in')
  assert.ok(strings.includes('财务管理'), 'the lead card names the requirement, not the project')
})

test('the tidy layout never stacks two cards on top of each other', () => {
  const layoutProject = {
    ...project,
    roots: [
      leaf('a1', 'workbench'), leaf('a2', 'workbench'), leaf('a3', 'workbench'),
      leaf('b1', 'backend'), leaf('b2', 'backend'), leaf('b3', 'backend'),
      leaf('c1', 'frontend'), leaf('c2', 'frontend'), leaf('c3', 'frontend'),
      leaf('d1', 'qa'), leaf('d2', 'qa'),
    ],
  }
  const layout = teamGraph(layoutProject)
  const rects = layout.cards.map(card => ({ id: card.id, x: card.x, y: card.y, w: card.w, h: card.h }))
  const overlaps = []
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]
      const b = rects[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push([a.id, b.id])
    }
  }
  assert.deepEqual(overlaps, [], 'default positions must be collision free')
  const laneTops = new Set(layout.cards.map(card => card.x))
  assert.equal(laneTops.size, 4, 'one column per owner')
})

test('a busy lane is highlighted while the rest stays quiet', () => {
  const busyProject = {
    ...project,
    roots: [leaf('a1', 'workbench'), leaf('b1', 'backend', 'active'), leaf('c1', 'frontend')],
  }
  const page = TeamGraphCard({ t, project: busyProject, panels: [], fill: false })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.some(text => text.includes('laneBusy')), 'the running lane is marked')
  assert.ok(strings.filter(text => text.includes('⋮⋮')).length >= 2, 'every lane keeps its grip')
})

test('the conversation bridge talks to the host, not to its own storage', async () => {
  const opened = []
  const entries = [
    { event: { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } } },
    { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } } },
    { event: { type: 'tool/call', data: {} } },
  ]
  const ctx = {
    get(name) {
      const table = {
        sessions: {
          getSnapshot: () => ({ byId: { s1: { id: 's1', title: '员工管理' } } }),
          using: async (id, options, fn) => fn({
            ready: Promise.resolve({
              eventSource: { getSnapshot: () => ({ entries }) },
              session: { prompt: async () => ({ ok: true }) },
            }),
          }),
          create: async options => 's2',
        },
        conversation: { sendSession: async () => ({ ok: true }) },
        uiWorkspace: { openSession: id => opened.push(id) },
      }
      return table[name]
    },
  }
  const bridge = createSessionBridge(ctx)
  assert.equal(bridge.available(), true)
  assert.deepEqual(await bridge.list(), [{ id: 's1', title: '员工管理', updatedAt: 0 }])
  assert.deepEqual(await bridge.transcript('s1'), [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'done' }])
  await bridge.send('s1', 'go')
  await bridge.open('s1')
  assert.deepEqual(opened, ['s1'])
  assert.equal(await bridge.create(), 's2')
})

test('the conversation shows the owner and the final answer, not the process', async () => {
  const entries = [
    { event: { type: 'turn/start', data: { turn: 1 } } },
    { event: { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'You are the delivery lead for the Workbench project "公司管理".' }] } } },
    { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '先看一眼目录…' }] } } } },
    { event: { type: 'tool/call', data: {} } },
    { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '计划已提交：4 张卡。' }] } } } },
    { event: { type: 'turn/end', data: { turn: 1 } } },
    { event: { type: 'turn/start', data: { turn: 2 } } },
    { event: { type: 'user/message', data: { source: { kind: 'agent-message' }, content: [{ type: 'text', text: 'Agent 123 sent a message: done' }] } } },
    { event: { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '把蛇改得好看一点' }] } } },
    { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好，我安排。' }] } } } },
  ]
  const ctx = {
    get(name) {
      if (name !== 'sessions') return undefined
      return {
        using: async (id, options, fn) => fn({
          ready: Promise.resolve({
            eventSource: { getSnapshot: () => ({ entries }) },
            session: { prompt: async () => ({ ok: true }) },
          }),
        }),
      }
    },
  }
  const bridge = createSessionBridge(ctx)
  assert.deepEqual(await bridge.transcript('s1'), [
    { role: 'assistant', text: '计划已提交：4 张卡。' },
    { role: 'user', text: '把蛇改得好看一点' },
    { role: 'assistant', text: '好，我安排。' },
  ], 'one answer per turn, no directives, no subagent notices')
})

test('the cockpit offers conversation and workspace controls per task', () => {
  const job = jobOf('j1', '员工管理', 1, 4, { sessionId: 's1', workspace: '/tmp/app' })
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [job] },
    job,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => true, list: async () => [], transcript: async () => [], create: async () => 'x', open: async () => {}, send: async () => {} },
    onJobConfig: async () => {},
  })
  const strings = []
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
  })
  assert.ok(strings.some(text => text.includes('convoOpen') || text.includes('convoClosed')), 'the toolbar shows the conversation state')
  assert.ok(strings.some(text => text.includes('workspaceButton')), 'a task can set its workspace')
})

test('a project card is an app launcher, never a task dashboard', () => {
  const opened = []
  const page = ProjectCard({
    t,
    project: { ...project, workspace: '/tmp/app' },
    onOpen: () => opened.push('open'),
  })
  const strings = []
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
  })
  assert.ok(strings.includes('cardEnterApp'), 'the card says it opens the app')
  assert.ok(!strings.some(text => /\d+\/\d+/.test(text)), 'no task counts on an app entry')
  assert.ok(!strings.includes('boardProgress'), 'no progress label')
  let openButton = null
  walk(page, node => {
    if (node.type === 'button' && String(node.props?.className ?? '').includes('wb-card')) openButton = node
  })
  assert.ok(openButton, 'the card itself is still a button')
  openButton.props.onClick()
  assert.deepEqual(opened, ['open'])

  const notReady = ProjectCard({ t, project: { ...project, workspace: null }, onOpen: () => {} })
  const labels = []
  walk(notReady, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') labels.push(props.children)
  })
  assert.ok(labels.includes('cardNoApp'), 'a project without an app says so')
})

test('a project card carries its delete control in the corner', () => {
  const deleted = []
  const page = ProjectCard({
    t,
    project: { ...project, workspace: '/tmp/app' },
    onOpen: () => {},
    onDelete: () => deleted.push('x'),
  })
  let control = null
  walk(page, node => {
    const props = node.props || {}
    if (node.type === 'button' && typeof props['aria-label'] === 'string' && props['aria-label'].startsWith('deleteCard')) control = node
  })
  assert.ok(control, 'the delete control exists on the card')
  let stopped = false
  control.props.onClick({ stopPropagation: () => { stopped = true } })
  assert.equal(stopped, true, 'clicking delete must not open the project')
  assert.deepEqual(deleted, ['x'])
})

test('the plugin only requires the services it cannot run without', () => {
  assert.deepEqual(
    [...module.inject].sort(),
    ['locale', 'slots'],
    'session services must stay optional, or a slow host blocks the sidebar entry',
  )
})

test('the bridge reads sessions from the injected service, not from a lookup', async () => {
  const sessions = {
    list: { getSnapshot: () => ({ byId: { s9: { id: 's9', title: '报价单' } } }) },
    using: async (id, options, fn) => fn({ ready: Promise.resolve({ eventSource: { getSnapshot: () => ({ entries: [] }) } }) }),
    create: async () => 's10',
  }
  const ctx = { sessions, conversation: {}, workspaces: {} }
  const bridge = createSessionBridge(ctx)
  assert.equal(bridge.available(), true)
  assert.deepEqual(await bridge.list(), [{ id: 's9', title: '报价单', updatedAt: 0 }])
})

test('conversations are listed inside the task workspace, and created there', async () => {
  const created = []
  const ctx = {
    workspaces: {
      list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws_1', path: '/tmp/app', title: 'app' }] }) },
      create: async ({ path }) => { created.push(['ws', path]); return { workspaceId: 'ws_2' } },
    },
    sessions: {
      list: { getSnapshot: () => ({ byId: {
        a: { id: 'a', title: 'in workspace', workspaceId: 'ws_1' },
        b: { id: 'b', title: 'elsewhere', workspaceId: 'ws_2' },
        c: { id: 'c', title: 'untagged' },
      } }) },
      create: async options => { created.push(['session', options.workspaceId]); return 's_new' },
    },
  }
  const bridge = createSessionBridge(ctx)
  assert.equal(await bridge.resolveWorkspace('/tmp/app/'), 'ws_1', 'an existing workspace is reused')
  assert.equal(await bridge.resolveWorkspace('/tmp/other'), 'ws_2', 'a new path registers a workspace')
  const inWorkspace = await bridge.list('ws_1')
  assert.deepEqual(inWorkspace.map(row => row.id), ['a'], 'tagged sessions are filtered by workspace')
  assert.equal(await bridge.create('/tmp/app'), 's_new')
  assert.deepEqual(created, [['ws', '/tmp/other'], ['session', 'ws_1']], 'a new conversation is created inside the workspace')

  // A host that does not tag sessions must not make them disappear silently.
  const untagged = createSessionBridge({ sessions: { list: { getSnapshot: () => ({ byId: { c: { id: 'c' } } }) } } })
  assert.deepEqual((await untagged.list('ws_1')).map(row => row.id), ['c'])
})

test('every label the UI asks for exists in both languages', () => {
  const used = new Set([...code.matchAll(/\bt\('([a-zA-Z0-9_]+)'\)/g)].map(match => match[1]))
  const enBlock = code.slice(code.indexOf('en: {'), code.indexOf('zh: {'))
  const zhBlock = code.slice(code.indexOf('zh: {'), code.indexOf('const STATUS_COLOR'))
  const missingEn = [...used].filter(key => !enBlock.includes(`${key}:`))
  const missingZh = [...used].filter(key => !zhBlock.includes(`${key}:`))
  assert.deepEqual(missingEn, [], 'a missing English label renders the raw key')
  assert.deepEqual(missingZh, [], 'a missing Chinese label renders the raw key')
})

test('a new workspace is registered with the host so the sidebar sees it', async () => {
  const calls = []
  const bridge = createSessionBridge({
    workspaces: {
      list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws_1', title: '旧项目', path: '/tmp/old' }] }) },
      create: async options => { calls.push(options); return { workspaceId: 'ws_9', title: options.title, path: options.path } },
    },
  })
  const listed = await bridge.workspaceList()
  assert.deepEqual(listed, [{ id: 'ws_1', title: '旧项目', path: '/tmp/old' }])
  const created = await bridge.createWorkspace({ path: '/tmp/new', title: '新项目' })
  assert.deepEqual(created, { id: 'ws_9', path: '/tmp/new', title: '新项目' })
  assert.deepEqual(calls, [{ path: '/tmp/new', title: '新项目' }], 'the host owns workspace creation')
})

test('a bound conversation takes a side column instead of covering the cockpit', () => {
  const job = jobOf('j1', '员工管理', 1, 4, { sessionId: 's1', workspace: '/tmp/app', workspaceId: 'ws_1' })
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [job] },
    job,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => true, list: async () => [], transcript: async () => [], create: async () => 'x', open: async () => {}, send: async () => {} },
    onJobConfig: async () => {},
  })
  let overlays = 0
  let columns = 0
  walk(page, node => {
    const style = (node.props || {}).style || {}
    if (style.position === 'absolute' && style.width === '380px') overlays += 1
    if (style.width === '100%' && style.height === '100%' && style.flexDirection === 'column') columns += 1
  })
  assert.equal(overlays, 0, 'the conversation must not float over the cockpit')
  assert.ok(columns >= 1, 'it is a real column beside the canvas')
})

test('a docked panel follows its dock when the canvas narrows', () => {
  const renderAt = x => FloatingPanel({
    t,
    projectId: 'prj_x',
    panelId: 'gates',
    title: '待你决定',
    node: 'body',
    defaultPos: { x, y: 12 },
    width: 300,
    bounds: { w: 1400, h: 600 },
  })
  const leftOf = tree => {
    let left = null
    walk(tree, node => {
      const style = (node.props || {}).style || {}
      if (left === null && style.position === 'absolute' && typeof style.left === 'string') left = style.left
    })
    return left
  }
  assert.equal(leftOf(renderAt(900)), '900px', 'wide canvas docks right')
  assert.equal(leftOf(renderAt(520)), '520px', 'after the conversation column opens, the same panel re-docks')
})

test('images ride the host draft path and are referenced by id', async () => {
  const calls = { drafts: [], sends: [] }
  globalThis.File = class { constructor(parts, name, options) { this.name = name; this.type = options.type } }
  globalThis.fetch = async () => ({ blob: async () => ({}) })
  const ctx = {
    sessions: { using: async (id, options, fn) => fn({ ready: Promise.resolve({ session: { prompt: async () => ({ ok: true }) } }) }) },
    conversation: {
      createDrafts: (sessionId, files) => { calls.drafts.push({ sessionId, names: files.map(file => file.name) }); return files.map((file, index) => ({ id: `draft_${index}`, kind: 'image' })) },
      sendSession: async (session, text, attachmentIds, mode) => { calls.sends.push({ text, attachmentIds, mode }); return { ok: true } },
    },
  }
  const bridge = createSessionBridge(ctx)
  const images = [
    { name: 'shot.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
    { name: 'diagram.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,BBBB' },
  ]
  await bridge.send('s1', '看一下这两张图', images)
  assert.deepEqual(calls.drafts, [{ sessionId: 's1', names: ['shot.png', 'diagram.png'] }], 'browser files are registered as drafts')
  assert.deepEqual(calls.sends, [{ text: '看一下这两张图', attachmentIds: ['draft_0', 'draft_1'], mode: 'queue' }], 'sendSession receives draft ids, not objects')
})

test('the composer offers an image input and says when it cannot.', () => {
  const job = jobOf('j1', '员工管理', 1, 4, { sessionId: 's1', workspace: '/tmp/app', workspaceId: 'ws_1' })
  const page = JobConversation({
    t,
    job,
    bridge: { available: () => true, transcript: async () => [], list: async () => [], create: async () => 'x', open: async () => {}, send: async () => true },
    onConfig: async () => {},
    onClose: () => {},
    onNeedWorkspace: () => {},
  })
  let fileInputs = 0
  const strings = []
  walk(page, node => {
    const props = node.props || {}
    if (node.type === 'input' && props.type === 'file' && props.accept === 'image/*') fileInputs += 1
    if (typeof props.children === 'string') strings.push(props.children)
  })
  assert.equal(fileInputs, 1, 'a file picker exists for images')
  assert.ok(strings.includes('attachImage') || strings.includes('🖼'), 'and a visible way to add them')
})

test('the workbench uses 90% of the surface instead of leaving wide margins', () => {
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return stubReact()
  })
  const tree = api.__components.Panel({})
  let innerWidth = null
  walk(tree, node => {
    const style = (node.props || {}).style || {}
    if (style.width === '90%' && style.margin === '0 auto') innerWidth = style.width
  })
  assert.equal(innerWidth, '90%', 'the page column should take 90% of the viewport')
})

test('a finished task reads as a result, not as a percentage', () => {
  const doneJob = { ...jobOf('j1', '员工管理', 14, 14), status: 'done', artifacts: ['a', 'b', 'c'], totals: { ...jobOf('j1', 'x', 14, 14).totals, done: 14, blocked: 0 } }
  const runningJob = { ...jobOf('j2', '报价流程', 3, 9), status: 'started', artifacts: [] }
  const page = TaskList({
    t,
    project: { ...project, jobs: [doneJob, runningJob] },
    onBack: () => {},
    onOpenJob: () => {},
    onNewTask: () => {},
  })
  const meters = []
  const texts = []
  walk(page, node => {
    const props = node.props || {}
    if (props.style && props.style.height === '4px') meters.push(props.style.height)
    if (typeof props.children === 'string') texts.push(props.children)
  })
  // One bar only: the running task's. A finished task shows its result instead.
  assert.equal(meters.length, 1, 'completed cards drop the 100% progress bar')
  assert.ok(texts.includes('✓'), 'a completed task is marked with a check')
  assert.ok(texts.some(text => text.includes('taskDoneMeta')), 'and summarises what it produced')
  assert.ok(texts.some(text => text.includes('taskOpenDone')), 'the action points at the result')
})

test('a delivered task offers a change request instead of rewriting itself', () => {
  const doneJob = jobOf('j1', '员工管理', 4, 4, { status: 'done' })
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [doneJob] },
    job: doneJob,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => true, list: async () => [], transcript: async () => [], create: async () => 'x', open: async () => {}, send: async () => {} },
    onJobConfig: async () => {},
  })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.some(text => text.includes('followUp')), 'a done task shows a change-request action')
})

test('a task group is one card plus its listed changes', () => {
  const parent = jobOf('j1', '员工管理', 4, 4, { status: 'done', child: 1 })
  const child = { ...jobOf('j2', '修复导出', 1, 2), parentJobId: 'j1', kind: 'fix' }
  const opened = []
  const page = TaskList({
    t,
    project: { ...project, jobs: [parent, child] },
    onBack: () => {},
    onOpenJob: id => opened.push(id),
    onNewTask: () => {},
  })
  const strings = []
  const buttons = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
    if (node.type === 'button') buttons.push(node)
  })
  // One grid cell for the group: the root card counts its change requests and
  // the change itself is a compact row instead of a second card.
  assert.ok(strings.some(text => text.includes('taskFollowUps')), 'the root card counts its changes')
  assert.ok(strings.some(text => text === '修复导出'), 'the change is listed under its group')
  assert.ok(strings.some(text => text === 'followUpsTitle'), 'the change list has a heading')
  const childNodes = node => Array.isArray(node.props?.children)
    ? node.props.children
    : node.props?.children === undefined ? [] : [node.props.children]
  const changeRow = buttons.find(button => childNodes(button).some(child => child?.props?.children === '修复导出'))
  assert.ok(changeRow !== undefined, 'the change row is a button')
  changeRow.props.onClick()
  assert.deepEqual(opened, ['j2'], 'clicking the change opens that job')
})

test('the cockpit shows the task group and steps between changes', () => {
  const parent = jobOf('j1', '员工管理', 4, 4, { status: 'done' })
  const child = { ...jobOf('j2', '修复导出', 1, 2), parentJobId: 'j1', kind: 'fix' }
  const opened = []
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [parent, child] },
    job: child,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => false },
    onJobConfig: async () => {},
    onOpenJob: id => opened.push(id),
  })
  const strings = []
  const buttons = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
    if (node.type === 'button') buttons.push(node)
  })
  assert.ok(strings.some(text => text === 'taskGroupLabel'), 'the cockpit names the group')
  assert.ok(strings.some(text => text === '员工管理'), 'the ancestor job is shown')
  const ancestor = buttons.find(button => button.props.children === '员工管理')
  assert.ok(ancestor !== undefined, 'the ancestor is a link back')
  ancestor.props.onClick()
  assert.deepEqual(opened, ['j1'], 'clicking the ancestor opens that job')
})

test('every task submission goes through the closed-loop intake', async () => {
  // The cockpit used to open jobs on the legacy /workbench/start route, which
  // the dispatcher never adopts — the change request then sat at 0/N forever.
  assert.equal(code.includes("'/workbench/start'"), false, 'the panel no longer uses the legacy start route')
  assert.match(code, /'\/workbench\/requirements'/, 'new tasks and change requests share one intake')
})

test('the cockpit fills the measured height instead of a hard-coded 100vh offset', () => {
  const job = jobOf('j1', '员工管理', 1, 4, { sessionId: 's1', workspace: '/tmp/app', workspaceId: 'ws_1' })
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [job] },
    job,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => true, list: async () => [], transcript: async () => [], create: async () => 'x', open: async () => {}, send: async () => true },
    onJobConfig: async () => {},
  })
  const styles = []
  walk(page, node => { styles.push((node.props || {}).style || {}) })
  assert.ok(!styles.some(style => typeof style.height === 'string' && style.height.includes('100vh')), 'no viewport arithmetic')
  assert.ok(styles.some(style => style.flex === '1 1 auto' && style.minHeight === '360px'), 'the body takes the remaining height')
})

test('the page column is a measured flex column with an 8px bottom inset', () => {
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return stubReact()
  })
  const tree = api.__components.Panel({})
  const styles = []
  walk(tree, node => { styles.push((node.props || {}).style || {}) })
  const page = styles.find(style => style.padding === '8px 0')
  assert.ok(page, 'page owns the 8px gaps above and below the viewport')
  assert.ok(page.flexDirection === 'column' && page.overflow === 'hidden', 'page is a full-height column')
  assert.ok(styles.some(style => style.flex === '1 1 auto' && style.minHeight === 0), 'inner content stretches')
})

test('the workflow branches pass the height chain down instead of collapsing it', () => {
  const flexWrappers = (code.match(/gap: '12px', flex: '1 1 auto', minHeight: 0/g) || []).length
  // ProjectDetail + its four WorkflowTab branches (job / tasks / home / grid).
  assert.ok(flexWrappers >= 4, 'a wrapper without flex:1 collapses the cockpit height')
  assert.ok(/inner: \{[^}]*flex: '1 1 auto', minHeight: 0/.test(code), 'the page column also stretches')
})

test('on a narrow surface the panel toggle opens a drawer instead of doing nothing', () => {
  const widthSeed = 900
  const narrowReact = () => {
    const base = stubReact()
    base.useState = initial => [initial === 0 ? widthSeed : (typeof initial === 'function' ? initial() : initial), () => {}]
    return base
  }
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return narrowReact()
  })
  const job = jobOf('j1', '员工管理', 4, 4, { status: 'done' })
  const page = api.__components.ProjectDetail({
    t,
    project: { ...project, jobs: [job] },
    job,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => true, list: async () => [], transcript: async () => [], create: async () => 'x', open: async () => {}, send: async () => true },
    onJobConfig: async () => {},
  })
  const drawers = []
  walk(page, node => {
    const style = (node.props || {}).style || {}
    if (style.position === 'absolute' && style.width === '340px') drawers.push(style)
  })
  assert.equal(drawers.length, 1, 'the narrow layout renders the panel drawer')
  assert.ok(drawers[0].overflowY === 'auto', 'and the drawer itself scrolls')
})

test('the panel is the projects board, not a tab bar with finance on it', () => {
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return stubReact()
  })
  const tree = api.__components.Panel({})
  const strings = []
  walk(tree, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('天工'), 'the panel heading is still there')
  assert.ok(!strings.includes('财务管理'), 'finance is not a sibling tab of the projects board')
  assert.ok(!strings.includes('financeTab'), 'no placeholder for a removed tab')
})

test('a planned but unexecuted job reads as "ready to execute"', () => {
  const planned = { ...jobOf('j1', '员工管理修改', 5, 17), status: 'started', running: 0 }
  const page = TaskList({
    t,
    project: { ...project, jobs: [planned] },
    onBack: () => {},
    onOpenJob: () => {},
    onNewTask: () => {},
  })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('statusPlanned'), 'planning done is not running')
})

test('the cockpit can hand an unexecuted plan to the bound agent session', () => {
  const sent = []
  const job = jobOf('j1', '员工管理修改', 5, 17, { status: 'started', running: 0, sessionId: 'session-x' })
  const tExec = key => key === 'execPrompt'
    ? 'plan for {jobId} is ready: call workbench_next_work per card'
    : key
  const page = ProjectDetail({
    t: tExec,
    project: { ...project, jobs: [job] },
    job,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => true, send: async (id, text) => { sent.push([id, text]); return true }, list: async () => [], transcript: async () => [], create: async () => 'x', open: async () => {} },
    onJobConfig: async () => {},
  })
  let button = null
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.onClick === 'function' && typeof props.children === 'string' && props.children.includes('execStart')) button = props
  })
  assert.ok(button, 'the cockpit offers "start execution" while cards remain')
  button.onClick()
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'session-x')
  assert.ok(sent[0][1].includes('workbench_next_work'), 'the handoff prompt names the tools to use')
  assert.ok(sent[0][1].includes('j1'), 'and which job to execute')
})

test('an auto-driven job does not offer a manual execution round', () => {
  // The closed loop dispatches intake jobs itself; a manual round would race
  // it and spawn a second child per card, so the cockpit hides the button.
  const job = jobOf('j1', '贪吃蛇修改', 1, 4, {
    status: 'started', running: 0, sessionId: 'session-x',
    requirement: { text: '改蛇' }, planBy: 'agent',
  })
  const page = ProjectDetail({
    t,
    project: { ...project, jobs: [job] },
    job,
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
    onDecide: () => {},
    bridge: { available: () => true, send: async () => true, list: async () => [], transcript: async () => [], create: async () => 'x', open: async () => {} },
    onJobConfig: async () => {},
  })
  let manual = null
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.onClick === 'function' && typeof props.children === 'string' && props.children.includes('execStart')) manual = props
  })
  assert.equal(manual, null, 'the loop-driven job has no manual execute control')
})

test('the task dialog can attach a requirement document, and only offers it when supported', () => {
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return stubReact()
  })
  const t = key => key
  const withUpload = api.__components.TaskDialog({
    t,
    brief: '',
    error: null,
    busy: false,
    file: null,
    fileError: null,
    onPickFile: () => {},
    onClearFile: () => {},
    onChange: () => {},
    onCancel: () => {},
    onConfirm: () => {},
  })
  const inputs = []
  walk(withUpload, node => {
    if (node.props && node.props.type === 'file') inputs.push(node.props)
  })
  assert.equal(inputs.length, 1, 'a document input is offered')
  assert.equal(inputs[0].accept, '.md,.markdown,.txt')
  assert.equal(inputs[0].disabled, false)

  const withoutUpload = api.__components.TaskDialog({
    t,
    brief: '',
    error: null,
    busy: false,
    onChange: () => {},
    onCancel: () => {},
    onConfirm: () => {},
  })
  const none = []
  walk(withoutUpload, node => {
    if (node.props && node.props.type === 'file') none.push(node.props)
  })
  assert.equal(none.length, 0, 'the follow-up dialog stays text-only')
})

test('a job created by the requirement intake shows its automatic state', () => {
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return stubReact()
  })
  const t = key => key
  const job = jobOf('j1', '员工管理', false, 0, {
    requirement: { text: '给公司管理加员工管理页', source: 'text' },
    planBy: null,
  })
  const project = { id: 'prj_1', title: '公司管理', jobs: [job], progress: { done: 0, total: 1 } }
  const tree = api.__components.TaskList({
    t,
    project,
    onBack: () => {},
    onOpenJob: () => {},
    onNewTask: () => {},
  })
  const strings = []
  walk(tree, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('autoPlanning'), 'before a plan it reads as planning')

  const planned = jobOf('j1', '员工管理', false, 0, {
    requirement: { text: 'x', source: 'text' },
    planBy: 'agent',
  })
  const tree2 = api.__components.TaskList({
    t,
    project: { ...project, jobs: [planned] },
    onBack: () => {},
    onOpenJob: () => {},
    onNewTask: () => {},
  })
  const strings2 = []
  walk(tree2, node => {
    if (typeof (node.props || {}).children === 'string') strings2.push(node.props.children)
  })
  assert.ok(strings2.includes('autoRunning'), 'after a plan it reads as dispatching')
  assert.ok(strings2.includes('autoWaiting'), 'a gate on the job asks for a person')
})

test('the modal is announced to assistive tech with a label', () => {
  const element = Dialog({ title: '创建应用', confirmLabel: 'ok', cancelLabel: 'cancel', onCancel: () => {}, onConfirm: () => {} })
  const panel = element.props.children
  assert.equal(panel.props.role, 'dialog')
  assert.equal(panel.props['aria-modal'], 'true')
  assert.equal(panel.props['aria-label'], '创建应用')
})

const textOf = node => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node !== null && typeof node === 'object') return textOf(node.props?.children)
  return ''
}

test('the create-project wizard offers three project types and their facts', () => {
  const { CreateProjectWizard } = module.__components
  const page = CreateProjectWizard({
    t, name: '公司管理', kind: 'software', workspace: '', busy: false,
    onChangeName() {}, onChangeKind() {}, onChangeWorkspace() {}, onCancel() {}, onConfirm() {},
    initialStep: 2,
  })
  const text = textOf(page)
  for (const key of [
    'typeSoftware', 'typeCopy', 'typeCustom',
    'typeFactPersona', 'typeFactTools', 'typeFactMemory', 'typeFactTemplate',
    'personaSoftware', 'toolsSoftware', 'templateSoftware',
  ]) assert.ok(text.includes(key), `the wizard shows ${key}`)
  const panel = (() => { let found = null; walk(page, node => { if (node.props?.role === 'dialog') found = node.props }); return found })()
  assert.equal(panel.style.width, '560px', 'the wizard is wider than the single-field dialog')
})

test('picking a project type reports it to the caller', () => {
  const { CreateProjectWizard } = module.__components
  const picked = []
  const page = CreateProjectWizard({
    t, name: '公司管理', kind: 'software', workspace: '', busy: false,
    onChangeName() {}, onChangeKind: id => picked.push(id), onChangeWorkspace() {}, onCancel() {}, onConfirm() {},
    initialStep: 2,
  })
  let copyCard = null
  walk(page, node => {
    if (node.type !== 'button' || typeof node.props?.onClick !== 'function') return
    if (textOf(node).includes('typeCopy')) copyCard = node.props
  })
  assert.ok(copyCard, 'the copy card is a button')
  copyCard.onClick()
  assert.deepEqual(picked, ['copy'])
})

test('the workspace step shows the summary and creates on confirm', () => {
  const { CreateProjectWizard } = module.__components
  let confirmed = 0
  const page = CreateProjectWizard({
    t, name: '公司管理', kind: 'copy', workspace: '/tmp/company-copy', busy: false,
    onChangeName() {}, onChangeKind() {}, onChangeWorkspace() {}, onCancel() {}, onConfirm: () => { confirmed += 1 },
    initialStep: 3,
  })
  const parts = []
  walk(page, node => { if (typeof node.props?.children === 'string') parts.push(node.props.children) })
  const text = parts.join(' ')
  let workspaceField = null
  walk(page, node => {
    if (node.type === 'input' && node.props?.placeholder === 'createWorkspacePlaceholder') workspaceField = node.props
  })
  assert.ok(workspaceField, 'the workspace field is offered')
  assert.ok(text.includes('createAdvanced'), 'the read-only advanced block is shown')
  assert.ok(text.includes('workbench-copy'), 'the preset is visible in the read-only advanced block')
  assert.equal(workspaceField.value, '/tmp/company-copy', 'the workspace field holds the path')
  assert.ok(text.includes('createConfirm'), 'the primary action is create')
  let confirmButton = null
  walk(page, node => {
    if (node.type === 'button' && typeof node.props?.onClick === 'function' && textOf(node) === 'createConfirm') confirmButton = node.props
  })
  assert.ok(confirmButton, 'the confirm button exists')
  confirmButton.onClick()
  assert.equal(confirmed, 1, 'confirming on the last step creates the project')
})

test('the workspace step offers a native folder picker next to the path field', () => {
  const { CreateProjectWizard } = module.__components
  let picked = 0
  const page = CreateProjectWizard({
    t, name: '公司管理', kind: 'software', workspace: '', busy: false, picking: false,
    onChangeName() {}, onChangeKind() {}, onChangeWorkspace() {}, onPickWorkspace: () => { picked += 1 },
    onCancel() {}, onConfirm() {}, initialStep: 3,
  })
  let pickButton = null
  walk(page, node => {
    if (node.type === 'button' && typeof node.props?.onClick === 'function' && textOf(node) === 'createWorkspacePick') pickButton = node.props
  })
  assert.ok(pickButton, 'the picker button exists')
  pickButton.onClick()
  assert.equal(picked, 1, 'clicking it asks the host for a folder')
  const parts = []
  walk(page, node => { if (typeof node.props?.children === 'string') parts.push(node.props.children) })
  assert.ok(parts.join(' ').includes('createWorkspaceHint'), 'the hint explains typing and picking')
})

test('a running cockpit status reads as a green highlight, not a disabled chip', () => {
  const page = ProjectDetail({
    t,
    project: { ...project, status: 'started' },
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
  })
  let chip = null
  walk(page, node => {
    const children = node.props?.children
    if (children === 'statusRunning' || (Array.isArray(children) && children.includes('statusRunning'))) chip = node.props
  })
  assert.ok(chip, 'the running chip is rendered')
  assert.equal(chip.style.color, '#7ee2a8', 'the label uses the bright success green')
  assert.match(String(chip.style.background), /46,160,67/, 'the chip carries a soft success fill')
  assert.equal(chip.style.borderColor, 'rgba(46,160,67,.6)', 'and a success border')

  const cancelled = ProjectDetail({
    t,
    project: { ...project, status: 'cancelled' },
    summary: {},
    events: [],
    onBack: () => {},
    onControl: () => {},
  })
  let stopped = null
  walk(cancelled, node => {
    const children = node.props?.children
    if (children === 'statusCancelled' || (Array.isArray(children) && children.includes('statusCancelled'))) stopped = node.props
  })
  assert.ok(stopped, 'the stopped chip is rendered')
  assert.notEqual(stopped.style.color, '#7ee2a8', 'a stopped scope is not green')
})

test('a paused cockpit explains that resume continues the same children', () => {
  const pausedProject = {
    ...project,
    status: 'paused',
    totals: { ...project.totals, active: 2 },
    roots: [{ ...project.roots[0], status: 'active', childSessionId: 'child-1' }],
  }
  const page = ProjectDetail({
    t, project: pausedProject, summary: {}, events: [],
    onBack: () => {}, onControl: () => {},
  })
  const parts = []
  walk(page, node => {
    if (typeof node.props?.children === 'string') parts.push(node.props.children)
    if (node.props?.title === 'childSessionHint') parts.push('childSessionHint')
  })
  const text = parts.join(' ')
  assert.ok(text.includes('pausedChildrenHint'), 'the paused header says cards still belong to children')
})

test('a task detail sheet shows instructions, acceptance, dependencies and the child session', () => {
  const { TaskDetailDialog } = module.__components
  const task = {
    ...project.roots[0],
    status: 'active', stage: 'build', owner: 'backend', role: '后端开发',
    instructions: '实现逻辑层，不要改页面',
    acceptance: 'pytest 通过且覆盖边界',
    childSessionId: 'child-1',
    blockedBy: ['dep-1'],
    artifacts: ['src/a.py'],
    gates: [{ title: '合并 PR', action: 'merge_pull_request', status: 'requested' }],
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  }
  const page = TaskDetailDialog({ t, task, onClose() {}, onOpenSession() {} })
  const parts = []
  walk(page, node => { if (typeof node.props?.children === 'string') parts.push(node.props.children) })
  const text = parts.join(' ')
  for (const expected of [
    'taskStatusActive', '实现逻辑层', 'pytest 通过且覆盖边界', 'child-1', 'dep-1', 'src/a.py',
    '合并 PR', 'taskOpenChild',
  ]) assert.ok(text.includes(expected), `the sheet shows ${expected}`)
})

test('canvas work cards open the detail sheet', () => {
  const opened = []
  const page = TeamGraphCard({
    t, project, scope: project, onOpenTask: id => opened.push(id),
  })
  const clickable = []
  walk(page, node => {
    if (typeof node.props?.onClick === 'function' && node.props?.title === 'taskOpenHint') clickable.push(node)
  })
  assert.ok(clickable.length > 0, 'work cards on the canvas are clickable')
  clickable[0].props.onClick()
  assert.equal(opened.length, 1, 'a click asks for that card')
  assert.ok(opened[0], 'the opener receives the card id')
})

test('the cockpit canvas receives the card opener', () => {
  const page = ProjectDetail({
    t, project, summary: {}, events: [],
    onBack: () => {}, onControl: () => {},
  })
  let wired = false
  walk(page, node => {
    if (typeof node.props?.onClick === 'function' && node.props?.title === 'taskOpenHint') wired = true
  })
  assert.equal(wired, true, 'clicking a canvas card is wired to the sheet')
})

test('the cockpit fills the viewport with an 8px gap above and below', () => {
  const { fillHeightFor } = module.__components
  // A page mounted at the very top of the route: viewport - 8 top - 8 bottom.
  assert.equal(fillHeightFor(0, 1000, 8), 984)
  // A page mounted below host chrome: it runs to 8px above the viewport bottom.
  assert.equal(fillHeightFor(44, 1000, 8), 948)
  // Scrolled above the viewport still fills instead of bailing out.
  assert.equal(fillHeightFor(-30, 1000, 8), 984)
  // A degenerate viewport never produces a zero-height page.
  assert.equal(fillHeightFor(500, 300, 8), 320)
  assert.equal(fillHeightFor(0, 0, 8), null)
})

test('the card sheet lists the skills the agent loaded', () => {
  const { TaskDetailDialog } = module.__components
  const task = { ...project.roots[0], status: 'done', skills: ['office', 'taste-skill'] }
  const page = TaskDetailDialog({ t, task, onClose() {}, onOpenSession() {} })
  const parts = []
  walk(page, node => { if (typeof node.props?.children === 'string') parts.push(node.props.children) })
  const text = parts.join(' ')
  assert.ok(text.includes('taskSectionSkills'))
  assert.ok(text.includes('office'))
  assert.ok(text.includes('taste-skill'))

  const empty = TaskDetailDialog({ t, task: { ...project.roots[0], status: 'done' }, onClose() {}, onOpenSession() {} })
  const emptyParts = []
  walk(empty, node => { if (typeof node.props?.children === 'string') emptyParts.push(node.props.children) })
  assert.ok(emptyParts.join(' ').includes('taskSkillsNone'), 'an unloaded card says so plainly')
})

test('the new-task dialog shows the selected skill pool', () => {
  const { TaskDialog } = module.__components
  const page = TaskDialog({
    t, brief: '写工具', error: null, busy: false,
    skills: ['create-implementation-plan', 'office'],
    onPickSkills: () => {},
    onChange: () => {}, onCancel: () => {}, onConfirm: () => {},
  })
  const parts = []
  walk(page, node => { if (typeof node.props?.children === 'string') parts.push(node.props.children) })
  const text = parts.join(' ')
  assert.ok(text.includes('create-implementation-plan'))
  assert.ok(text.includes('office'))
  assert.ok(text.includes('skillsPick'))
})

test('the skill picker lists the current selection and the limit', () => {
  const { SkillPickerDialog } = module.__components
  const page = SkillPickerDialog({
    t, selected: ['office', 'create-implementation-plan'], kind: 'software', projectId: 'p1',
    onClose: () => {}, onSave: () => {},
  })
  const parts = []
  walk(page, node => { if (typeof node.props?.children === 'string') parts.push(node.props.children) })
  const text = parts.join(' ')
  assert.ok(text.includes('skillsHint'), 'the picker explains the rules')
  assert.ok(text.includes('office ×'), 'a selected skill can be removed')
  assert.ok(text.includes('create-implementation-plan ×'))
  assert.ok(text.includes('skillsMax'))
})
