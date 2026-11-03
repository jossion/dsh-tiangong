import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The company panel is browser code, so it has no renderer here. This harness
 * loads the real bundle with a stub React and calls the components directly:
 * enough to catch a missing variable or a broken hook order, which otherwise
 * shows up as an empty slot and a console error in the live app. It mirrors the
 * workbench harness, because the panel is a separate DSH web client module.
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

/** Effects run inline, so the module's mount fetch can be observed. */
function eagerReact() {
  const react = stubReact()
  react.useEffect = fn => { fn() }
  return react
}

function apiWith(react) {
  return factory(name => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return react
  })
}

const module = apiWith(stubReact())
const { CompanyPage, EmployeeAdmin, OrgAdmin, FinanceTab, ServicesStrip, Dialog, Panel } = module.__components
const t = key => key

/** Depth-first walk over the stub element tree. */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  // A function-type node is a component: render it the way the loader would.
  if (typeof node.type === 'function') { walk(node.type(node.props), visit); return }
  visit(node)
  if (node.props && node.props.children !== undefined) walk(node.props.children, visit)
}

function stringsOf(tree) {
  const strings = []
  walk(tree, node => {
    const props = node.props || {}
    if (typeof props.children === 'string') strings.push(props.children)
  })
  return strings
}

const financePayload = {
  source: 'files',
  dir: '/Users/example/Documents/statements',
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

test('the plugin registers its own sidebar entry and main surface', () => {
  const registered = []
  const optional = []
  const slots = {
    inject(name, fn) { fn() },
    register(spec) { registered.push({ name: spec.name, id: spec.id, key: spec.key }); return () => {} },
  }
  const locale = { register: () => () => {}, bind: () => key => key }
  apiWith(stubReact()).apply({
    effect(fn) { fn() },
    slots,
    locale,
    inject(names, fn) { optional.push(names); fn({}); return () => {} },
  })
  assert.deepEqual(optional, [], 'the company client needs no optional session services')
  assert.ok(registered.some(entry => entry.name === 'sidebar.panellist' && entry.id === 'company'),
    'without this the Company entry disappears from the DSH sidebar')
  assert.ok(registered.some(entry => entry.name === 'main' && entry.key === 'company'), 'the main surface is registered too')
})

test('the plugin only requires the services it cannot run without', () => {
  assert.deepEqual([...module.inject].sort(), ['locale', 'slots'],
    'the panel must not block the sidebar entry on a slow host service')
})

test('the panel renders the company heading and its three module tabs', () => {
  const strings = stringsOf(Panel({}))
  assert.ok(strings.includes('公司管理'), 'the page paints its heading before any fetch')
  for (const tab of ['员工管理', '组织架构', '财务']) {
    assert.ok(strings.includes(tab), `${tab} is a first-class tab`)
  }
})

test('the company page defaults to employees and can open organization or finance', () => {
  const employees = stringsOf(CompanyPage({ t }))
  assert.ok(employees.includes('employeeTitle'), 'employees is the default module')
  assert.ok(!employees.includes('orgCompanies'), 'organization is not mounted at the same time')

  const org = stringsOf(CompanyPage({ t, initialTab: 'org' }))
  assert.ok(org.includes('orgCompanies'), 'the organization tab mounts the org module')

  const finance = stringsOf(CompanyPage({ t, initialTab: 'finance' }))
  assert.ok(finance.includes('loading'), 'the finance tab mounts the finance module')
})

test('the company page shows the workspace from /company/config as display only', () => {
  const strings = stringsOf(CompanyPage({ t, initialConfig: { workspace: '/tmp/app', financeDb: '/tmp/app/data.db', appPort: 3000 } }))
  assert.ok(strings.some(text => text.includes('/tmp/app')), 'the workspace path is visible')
  assert.ok(strings.some(text => text.includes('3000')), 'the app port is visible')
})

test('the employee module is rendered by the panel, not embedded', () => {
  const page = EmployeeAdmin({ t })
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

test('the employee module reads /company/employees and the org tree without a projectId', () => {
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return { ok: true, json: async () => ({ data: [], total: 0 }) }
  }
  try {
    apiWith(eagerReact()).__components.EmployeeAdmin({ t })
    assert.ok(urls.some(url => url.startsWith('/company/employees?')), `the list loads on mount, got ${urls[0]}`)
    assert.ok(urls.some(url => url.startsWith('/company/organization')), 'the company/department selects are loaded too')
    assert.ok(urls.every(url => !url.includes('projectId')), 'the company plugin is single-workspace')
  } finally {
    delete globalThis.fetch
  }
})

test('the employee form links a company and shows only that company departments', () => {
  assert.ok(code.includes('value: form.values.companyId'), 'the form has a company select')
  assert.ok(code.includes('formDepartments.map'), 'the department select is filled from the chosen company')
  assert.ok(code.includes('loadOrg(next)'), 'changing company reloads its departments')
  assert.ok(code.includes("setValue('departmentId', '')"), 'changing company clears the stale department')
  assert.ok(!/key: 'department'/.test(code), 'no second, free-text department field')
})

test('the dependency strip reads /company/services and can control the app server', () => {
  assert.ok(code.includes("'/company/services'"), 'the strip calls its own route')
  assert.ok(code.includes('serviceId, action'), 'the control action is posted under the company route')
  const page = ServicesStrip({ t })
  const strings = stringsOf(page)
  assert.ok(strings.includes('servicesLabel'), 'dependencies are a first-class strip')
  assert.ok(strings.includes('serviceChecking'), 'and they say they are checking, not fake data')
})

test('the company page loads its config and service status without a projectId', () => {
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return { ok: true, json: async () => ({ data: [] }) }
  }
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  // The services strip polls; the harness keeps the interval out of the loop.
  globalThis.setInterval = () => 0
  globalThis.clearInterval = () => {}
  try {
    stringsOf(apiWith(eagerReact()).__components.CompanyPage({ t }))
    assert.ok(urls.includes('/company/config'), 'the workspace is display-only, read from its own route')
    assert.ok(urls.includes('/company/services'), 'the service strip polls its own route')
    assert.ok(urls.every(url => !url.includes('projectId')), 'no project id anywhere')
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
    delete globalThis.fetch
  }
})

test('the organization module renders company, department and job-level sections', () => {
  const page = OrgAdmin({
    t,
    initialData: {
      companies: [{ id: 1, name: '甲公司' }, { id: 2, name: '乙公司' }],
      company: { id: 1, name: '甲公司' },
      departments: [{ id: 10, companyId: 1, name: '研发部', parentDepartmentId: null, sortOrder: 1 }],
      jobLevels: [{ id: 20, companyId: 1, name: 'P7', rankOrder: 1 }],
    },
  })
  const strings = stringsOf(page)
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

test('the organization module asks only for a company (last bug: request without projectId → 404)', () => {
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return { ok: true, json: async () => ({ data: { company: { id: null, name: '' }, departments: [], jobLevels: [] } }) }
  }
  try {
    apiWith(eagerReact()).__components.OrgAdmin({ t })
    assert.equal(urls.length >= 1, true, 'mounting the module loads it')
    assert.ok(urls[0].startsWith('/company/organization'), `got ${urls[0]}`)
    assert.ok(!urls[0].includes('projectId'), 'the company client must not invent a project id')
  } finally {
    delete globalThis.fetch
  }
})

test('the finance page turns one payload into totals, split and rows', () => {
  const page = FinanceTab({ t, initialData: financePayload })
  const strings = stringsOf(page)
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
  const strings = stringsOf(FinanceTab({ t }))
  assert.ok(strings.includes('loading'), 'no payload means loading, not "0 income"')
})

test('the finance page can read the ledger database instead of a folder', () => {
  const payload = {
    ...financePayload,
    source: 'sqlite',
    dbPath: '/Users/example/app/web/data/ledger.db',
    dbExists: true,
    dbError: null,
    dir: '',
    dirExists: true,
    files: [],
    imports: [],
    companies: ['示例公司'],
  }
  const strings = stringsOf(FinanceTab({ t, initialData: payload }))
  assert.ok(strings.some(text => text.includes('financeSourceSqlite')), 'the source is named')
  assert.ok(strings.some(text => text.includes('/Users/example/app/web/data/ledger.db')), 'the database path is visible')
  assert.ok(!strings.some(text => text.includes('financeImport')), 'a live database has nothing to import')
  assert.ok(!strings.some(text => text.includes('financeFiles')), 'no folder listing for a database')
  assert.ok(strings.includes('¥12,000.00'), 'the metrics still render from the same payload')
})

test('a database that cannot be read explains itself instead of showing zeros', () => {
  const payload = {
    ...financePayload,
    source: 'sqlite',
    dbPath: '/missing/ledger.db',
    dbExists: false,
    dbError: '数据库不存在：/missing/ledger.db',
    dir: '',
    files: [],
    imports: [],
    summary: { count: 0, totals: { income: 0, expense: 0, net: 0 }, byMonth: [], byCategory: [] },
    transactions: [],
    totalTransactions: 0,
  }
  const strings = stringsOf(FinanceTab({ t, initialData: payload }))
  assert.ok(strings.some(text => text.includes('financeDbError')), 'the failure is named')
  assert.ok(strings.some(text => text.includes('/missing/ledger.db')), 'with the path the owner typed')
})

test('the finance module reads /company/finance without a projectId', () => {
  const urls = []
  globalThis.fetch = async url => {
    urls.push(String(url))
    return {
      ok: true,
      json: async () => ({
        source: 'files', dir: '', dirExists: true, files: [], imports: [], categories: [],
        summary: { totals: { income: 0, expense: 0, net: 0 }, count: 0, byCategory: [], byMonth: [] },
        transactions: [], totalTransactions: 0, filters: {},
      }),
    }
  }
  try {
    apiWith(eagerReact()).__components.FinanceTab({ t })
    assert.ok(urls.length >= 1, 'the module loads on mount')
    assert.ok(urls[0].startsWith('/company/finance?'), `got ${urls[0]}`)
    assert.ok(!urls[0].includes('projectId'), 'the ledger belongs to the company workspace, not a project')
  } finally {
    delete globalThis.fetch
  }
})

test('the finance source editor is a typed path plus save, never a native picker', () => {
  assert.ok(!code.includes('/workbench/'), 'the client has no workbench fetches left')
  assert.ok(!code.includes('browse-path'), 'the source editor does not walk the filesystem')
  assert.ok(code.includes("op: 'set-source'"), 'saving posts a source change')
  assert.ok(code.includes('/company/finance'), 'the finance route is the company one')
  assert.ok(code.includes('financeDirPlaceholder') && code.includes('financeDbPlaceholder'), 'both sources get a path input')
})

test('the modal is announced to assistive tech with a label', () => {
  const element = Dialog({ title: '编辑员工', confirmLabel: 'ok', cancelLabel: 'cancel', onCancel: () => {}, onConfirm: () => {} })
  const panel = element.props.children
  assert.equal(panel.props.role, 'dialog')
  assert.equal(panel.props['aria-modal'], 'true')
  assert.equal(panel.props['aria-label'], '编辑员工')
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
