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
const { EmployeeAdmin, OrgAdmin, FinanceTab, ProjectFinance, PathBrowser, ProjectCard, ProjectDetail, ProjectHome, TaskList, TeamGraphCard, FloatingPanel, Dialog, JobConversation, createSessionBridge, teamGraph } = module.__components

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

test('the employee module is rendered by the panel, not embedded', () => {
  const page = EmployeeAdmin({
    t,
    project: { ...project, workspace: '/tmp/app' },
    onBack: () => {},
    onOpenTasks: () => {},
    onShowDeliverables: () => {},
  })
  let iframes = 0
  const strings = []
  walk(page, node => {
    if (node.type === 'iframe') iframes += 1
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
    if (typeof props.placeholder === 'string') strings.push(props.placeholder)
  })
  assert.equal(iframes, 0, 'no iframe: the module is native')
  assert.ok(strings.includes('employeeTitle'))
  assert.ok(strings.includes('employeeSearch'))
  assert.ok(strings.some(text => text.includes('employeeCreate')), 'there is a way to add an employee')
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

test('the employee module shows the dependency status line', () => {
  const page = EmployeeAdmin({
    t,
    project: { ...project, workspace: '/tmp/app' },
    onBack: () => {},
    onOpenTasks: () => {},
    onShowDeliverables: () => {},
  })
  const strings = []
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
  })
  assert.ok(strings.includes('servicesLabel'), 'dependencies are a first-class strip')
  assert.ok(strings.includes('serviceChecking'), 'and they say they are checking, not fake data')
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
  page.props.onClick()
  assert.deepEqual(opened, ['open'])

  const notReady = ProjectCard({ t, project: { ...project, workspace: null }, onOpen: () => {} })
  const labels = []
  walk(notReady, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') labels.push(props.children)
  })
  assert.ok(labels.includes('cardNoApp'), 'a project without an app says so')
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

test('follow-up tasks show their lineage on the task card', () => {
  const parent = jobOf('j1', '员工管理', 4, 4, { status: 'done' })
  const child = { ...jobOf('j2', '修复导出', 1, 2), parentJobId: 'j1', kind: 'fix' }
  const page = TaskList({
    t,
    project: { ...project, jobs: [parent, child] },
    onBack: () => {},
    onOpenJob: () => {},
    onNewTask: () => {},
  })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.some(text => text === 'taskFrom 员工管理'), 'the child names its parent')
  assert.ok(strings.some(text => text.includes('taskFollowUps')), 'the parent counts its follow-ups')
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
  const page = styles.find(style => typeof style.padding === 'string' && style.padding.includes('0 8px'))
  assert.ok(page, 'page padding ends 8px above the window bottom')
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

// ---- finance page -------------------------------------------------------

const financePayload = {
  dir: '/Users/owner/Documents/银行流水',
  dirExists: true,
  dirError: null,
  files: [
    { name: '2026-01.csv', size: 2048, mtime: '2026-02-01T00:00:00.000Z', importedAt: '2026-02-01T00:00:00.000Z', rows: 2 },
    { name: '2026-02.csv', size: 1024, mtime: '2026-03-01T00:00:00.000Z', importedAt: null, rows: null },
  ],
  imports: [],
  categories: ['工资薪酬', '餐饮'],
  summary: {
    count: 2,
    totals: { income: 12000, expense: 38.5, net: 11961.5 },
    byMonth: [{ month: '2026-01', income: 12000, expense: 38.5, count: 2 }],
    byCategory: [
      { category: '工资薪酬', income: 12000, expense: 0, count: 1, total: 12000 },
      { category: '餐饮', income: 0, expense: 38.5, count: 1, total: 38.5 },
    ],
    topCounterparties: [],
    range: { from: '2026-01-01', to: '2026-01-31' },
  },
  transactions: [
    { id: 't1', date: '2026-01-05', description: '工资发放', counterparty: '某某公司', amount: 12000, direction: 'income', category: '工资薪酬' },
    { id: 't2', date: '2026-01-08', description: '美团外卖', counterparty: '美团', amount: 38.5, direction: 'expense', category: '餐饮' },
  ],
  totalTransactions: 2,
  filters: {},
}

test('the finance page turns one payload into totals, split and rows', () => {
  const page = FinanceTab({ t, initialData: financePayload })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('¥12,000.00'), 'income total is formatted, not raw')
  assert.ok(strings.includes('¥38.50'), 'expense total is formatted')
  assert.ok(strings.includes('¥11,961.50'), 'net is the third number')
  assert.ok(strings.includes('2'), 'the count is shown')
  assert.ok(strings.includes('26-01'), 'the month is on the chart')
  assert.ok(strings.includes('工资薪酬'), 'categories are grouped')
  assert.ok(strings.includes('工资发放') && strings.includes('美团外卖'), 'rows are listed')
  assert.ok(strings.includes('+¥12,000.00') && strings.includes('−¥38.50'), 'direction sets the sign and colour')
  assert.ok(strings.includes('2026-01.csv') && strings.includes('2026-02.csv'), 'the folder listing is visible')
  assert.ok(strings.some(text => text.startsWith('financeImported')) && strings.includes('financePending'), 'imported and new files read differently')
  // Filters are chips in the page, because the requirement asks for interaction.
  assert.ok(strings.includes('financePeriodMonth') && strings.includes('financeDirection'), 'period and direction filters render')
  let selects = 0
  walk(page, node => { if (node.type === 'select') selects += 1 })
  assert.equal(selects, 1, 'the category filter is a native select — one control, no custom menu')
})

test('the finance page says it is loading instead of showing zeros', () => {
  const page = FinanceTab({ t })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('loading'), 'no payload means loading, not "0 income"')
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

test('finance opens inside the project, with a way back to the project app', () => {
  const backed = []
  const page = ProjectFinance({ t, project: { ...project, title: '公司管理' }, onBack: () => backed.push('back') })
  const strings = []
  let back = null
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
    if (typeof props.onClick === 'function' && props.children === 'financeBack') back = props
  })
  assert.ok(strings.includes('公司管理'), 'the project name stays on screen')
  assert.ok(back, 'a back chip returns to the project')
  assert.equal(back.style.minHeight, '32px')
  assert.ok(strings.includes('loading'), 'the finance module renders in place of the project app')
  back.onClick()
  assert.deepEqual(backed, ['back'])
})

test('the project header offers the finance module beside employee management', () => {
  const opened = []
  const page = EmployeeAdmin({
    t,
    project: { ...project, jobs: [jobOf('j1', '员工管理', 4, 4, { status: 'done' }), jobOf('j2', '财务管理', 17, 17, { status: 'done' })] },
    onBack: () => {},
    onOpenTasks: () => {},
    onOpenFinance: () => opened.push('finance'),
  })
  const buttons = []
  const strings = []
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
    if (typeof props.onClick === 'function' && typeof props.children === 'string' && props.children.includes('financeTab')) buttons.push(props)
  })
  assert.ok(strings.some(text => text.includes('employeeModule')), 'employee is the active module')
  assert.ok(buttons.length >= 1, 'finance is a clickable module chip')
  buttons[0].onClick()
  assert.deepEqual(opened, ['finance'])
})

test('the finance page can read the ledger database instead of a folder', () => {
  const payload = {
    ...financePayload,
    source: 'sqlite',
    dbPath: '/Users/owner/codes/app/web/data/hzy.db',
    dbExists: true,
    dbError: null,
    dir: '',
    dirExists: true,
    files: [],
    imports: [],
    companies: ['华之语'],
  }
  const page = FinanceTab({ t, initialData: payload })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.some(text => text.includes('financeSourceSqlite')), 'the source is named')
  assert.ok(strings.some(text => text.includes('/Users/owner/codes/app/web/data/hzy.db')), 'the database path is visible')
  assert.ok(!strings.some(text => text.includes('financeImport')), 'a live database has nothing to import')
  assert.ok(!strings.some(text => text.includes('financeFiles')), 'no folder listing for a database')
  assert.ok(strings.includes('¥12,000.00'), 'the metrics still render from the same payload')
})

test('a database that cannot be read explains itself instead of showing zeros', () => {
  const payload = {
    ...financePayload,
    source: 'sqlite',
    dbPath: '/missing/hzy.db',
    dbExists: false,
    dbError: '数据库不存在：/missing/hzy.db',
    dir: '',
    files: [],
    imports: [],
    summary: { count: 0, totals: { income: 0, expense: 0, net: 0 }, byMonth: [], byCategory: [] },
    transactions: [],
    totalTransactions: 0,
  }
  const page = FinanceTab({ t, initialData: payload })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.some(text => text.includes('financeDbError')), 'the failure is named')
  assert.ok(strings.some(text => text.includes('/missing/hzy.db')), 'with the path the owner typed')
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

test('the project page exposes employee and organization modules', () => {
  const page = EmployeeAdmin({
    t,
    project: { ...project, jobs: [jobOf('j1', '员工管理', 4, 4, { status: 'done' })] },
    onBack: () => {},
    onOpenTasks: () => {},
    onShowDeliverables: () => {},
  })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('employeeModule'), 'employee module tab')
  assert.ok(strings.includes('orgModule'), 'organization module tab exists — this was the missing entry')
})

test('the organization module renders company, department and job-level sections', () => {
  const page = OrgAdmin({
    t,
    project,
    initialData: {
      companies: [{ id: 1, name: '甲公司' }, { id: 2, name: '乙公司' }],
      company: { id: 1, name: '甲公司' },
      departments: [{ id: 10, companyId: 1, name: '研发部', parentDepartmentId: null, sortOrder: 1 }],
      jobLevels: [{ id: 20, companyId: 1, name: 'P7', rankOrder: 1 }],
    },
  })
  const strings = []
  walk(page, node => {
    if (typeof (node.props || {}).children === 'string') strings.push(node.props.children)
  })
  assert.ok(strings.includes('orgCompanies'))
  assert.ok(strings.some(text => text.includes('orgCreateCompany')), 'can create a company')
  assert.ok(strings.includes('orgDeleteCompany'), 'can delete a company')
  assert.ok(strings.some(text => text.includes('orgDepartments')), 'departments section is scoped to a company')
  assert.ok(strings.some(text => text.includes('orgJobLevels')), 'job levels section is scoped to a company')
  assert.ok(strings.some(text => text.includes('orgCreateDepartment')), 'can create a department')
  assert.ok(strings.some(text => text.includes('orgCreateLevel')), 'can create a job level')
  const deletable = []
  walk(page, node => { const props = node.props || {}; if (props.title === 'orgDelete' || props.children === '✕') deletable.push(props) })
  assert.ok(deletable.length >= 2, 'department and job-level rows are deletable')
})

test('the organization module asks for its own project (last bug: request without projectId → 404)', () => {
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return { ok: true, json: async () => ({ data: { company: { id: null, name: '' }, departments: [], jobLevels: [] } }) }
  }
  const react = stubReact()
  react.useEffect = fn => { fn() }
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return react
  })
  api.__components.OrgAdmin({ t, project: { id: 'prj_mvyh9kvx_9ys0ee', title: '公司管理' } })
  assert.equal(urls.length >= 1, true, 'mounting the module loads it')
  assert.ok(urls[0].startsWith('/workbench/organization?projectId=prj_mvyh9kvx_9ys0ee'), `got ${urls[0]}`)
  delete globalThis.fetch
})

test('the finance module reads the ledger of its own project', () => {
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return { ok: true, json: async () => ({ source: 'files', dir: '', dirExists: true, files: [], imports: [], categories: [], companies: [], summary: { totals: { income: 0, expense: 0, net: 0 }, count: 0, byCategory: [], byMonth: [] }, transactions: [], totalTransactions: 0, filters: {} }) }
  }
  const react = stubReact()
  react.useEffect = fn => { fn() }
  const api = factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return react
  })
  api.__components.FinanceTab({ t, projectId: 'prj_mvyh9kvx_9ys0ee' })
  assert.ok(urls.length >= 1, 'the module loads on mount')
  assert.ok(urls[0].includes('projectId=prj_mvyh9kvx_9ys0ee'), `got ${urls[0]}`)
  delete globalThis.fetch
})

test('the finance source editor opens the in-panel browser instead of asking for a typed path', () => {
  assert.ok(code.includes('/workbench/browse-path'), 'the editor walks the filesystem itself')
  assert.ok(code.includes('setBrowserMode'), 'the button opens the browser dialog')
  assert.ok(!/const choosePath = useCallback\(async/.test(code), 'the button never waits on a native dialog first')
})

test('the path browser renders its listing without a native dialog', () => {
  const page = PathBrowser({ t, mode: 'directory', onPick: () => {}, onClose: () => {} })
  const strings = []
  walk(page, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
    if (typeof props.onClick === 'function' && props.children === 'pickChooseFolder') strings.push('pick_chosen')
  })
  assert.ok(strings.includes('pickTitle'))
  assert.ok(strings.includes('pickUp'))
  assert.ok(strings.includes('pick_chosen'), 'directory mode can accept the current folder')
})

test('the employee form links a company and shows only that company departments', () => {
  assert.ok(code.includes("value: form.values.companyId"), 'the form has a company select')
  assert.ok(code.includes("formDepartments.map"), 'the department select is filled from the chosen company')
  assert.ok(code.includes("loadOrg(next)"), 'changing company reloads its departments')
  assert.ok(code.includes("setValue('departmentId', '')"), 'changing company clears the stale department')
  assert.ok(!/key: 'department'/.test(code), 'no second, free-text department field')
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
