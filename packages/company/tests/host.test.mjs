import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  CONFIG_PATH,
  EMPLOYEES_PATH,
  FINANCE_PATH,
  ORG_PATH,
  SERVICES_PATH,
  Config,
  apply,
} from '../index.js'
import { buildXlsx } from './fixtures.mjs'

const standard = Config['~standard'] ?? Config

/**
 * A minimal stand-in for the Cordis context.
 *
 * `webServer` arrives through `inject`, exactly like the real loader does it,
 * so the test reproduces the activation path instead of mounting routes the
 * plugin never registered.
 */
function fakeContext({ withWebServer = true, connection = null } = {}) {
  const routes = []
  const disposers = []

  const webCtx = {
    get(name) {
      if (name !== 'webServer') return undefined
      if (!withWebServer) return undefined
      return {
        register(route) {
          routes.push(route)
          return () => {
            const index = routes.indexOf(route)
            if (index >= 0) routes.splice(index, 1)
          }
        },
      }
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }

  const ctx = {
    // A one-shot read during apply must find nothing, like the real thing.
    get(name) {
      if (name === 'connection' && connection !== null) return connection
      throw new Error(`cannot get property "${name}" without inject`)
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer'], 'the routes must ride a webServer sub-fiber')
      return callback(webCtx)
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    logger: { warn() {} },
  }

  return { ctx, routes, disposers }
}

function fakeResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body
    },
  }
}

function postRequest(body, headers = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

/** A temp data dir plus the company workspace the plugin is configured with. */
async function withCompanyDir(fn) {
  const dataDir = await mkdtemp(join(tmpdir(), 'company-host-'))
  const workspace = join(dataDir, 'workspace')
  mkdirSync(join(workspace, 'web', 'data'), { recursive: true })
  try {
    return await fn({ dataDir, workspace })
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
}

/** Apply the plugin with a row config and hand back the mounted routes. */
function mount({ dataDir, workspace = '', financeDb = '', appPort, connection = null, withWebServer = true }) {
  const { ctx, routes, disposers } = fakeContext({ withWebServer, connection })
  const row = { dataDir, workspace, ...(financeDb === '' ? {} : { financeDb }), ...(appPort === undefined ? {} : { appPort }) }
  apply(ctx, row)
  const route = path => routes.find(item => item.path === path)
  return { ctx, routes, disposers, route }
}

/* ── Config ─────────────────────────────────────────────────────────────── */

test('the exported Config defaults the single-tenant settings', () => {
  assert.equal(typeof standard.validate, 'function', 'activation validates the row config')
  const result = standard.validate({})
  assert.ok(!('issues' in result), 'empty config is valid')
  assert.equal(result.value.workspace, '')
  assert.equal(result.value.dataDir, '')
  assert.equal(result.value.financeDb, '')
  assert.equal(result.value.appPort, 4321)
})

test('bad config values are reported, not silently coerced', () => {
  const result = standard.validate({ workspace: 7, appPort: -1 })
  assert.ok(Array.isArray(result.issues))
  assert.ok(result.issues.length >= 1)
  assert.ok(result.issues.some(issue => /workspace|appPort/.test(issue.message)))

  const partial = standard.validate({ workspace: '/tmp/company', appPort: 5000 })
  assert.equal(partial.value.workspace, '/tmp/company')
  assert.equal(partial.value.appPort, 5000)
  assert.equal(partial.value.dataDir, '', 'untouched fields keep their defaults')
})

/* ── Mounting and the config route ──────────────────────────────────────── */

test('the company plugin mounts its five routes and drops them on dispose', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { routes, disposers, route } = mount({ dataDir, workspace })

    assert.deepEqual(routes.map(item => item.path).sort(),
      [CONFIG_PATH, EMPLOYEES_PATH, ORG_PATH, FINANCE_PATH, SERVICES_PATH].sort())
    assert.equal(CONFIG_PATH, '/company/config')
    assert.equal(EMPLOYEES_PATH, '/company/employees')
    assert.equal(ORG_PATH, '/company/organization')
    assert.equal(FINANCE_PATH, '/company/finance')
    assert.equal(SERVICES_PATH, '/company/services')
    for (const item of routes) {
      assert.equal(item.kind, 'exact')
      assert.equal(typeof item.handler, 'function')
    }

    // A headless profile keeps activating, it just serves no routes.
    const headless = mount({ dataDir, workspace, withWebServer: false })
    assert.equal(headless.routes.length, 0)

    for (const dispose of disposers) dispose?.()
    assert.equal(routes.length, 0, 'a disposed plugin leaves no route behind')
    assert.ok(route(CONFIG_PATH) === undefined)
  })
})

test('the config route reports the workspace, the finance default and the app port', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const financeDb = join(dataDir, 'ledger.db')
    const { route } = mount({ dataDir, workspace, financeDb, appPort: 5001 })
    const response = fakeResponse()
    await route(CONFIG_PATH).handler({ method: 'GET', url: '/company/config' }, response)

    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body).data, { workspace, financeDb, appPort: 5001 })

    const wrong = fakeResponse()
    await route(CONFIG_PATH).handler(postRequest({}), wrong)
    assert.equal(wrong.status, 405)
  })
})

test('workspace-bound routes say so instead of guessing a workspace', async () => {
  await withCompanyDir(async ({ dataDir }) => {
    const { route } = mount({ dataDir, workspace: '' })
    for (const path of [EMPLOYEES_PATH, ORG_PATH, SERVICES_PATH]) {
      const response = fakeResponse()
      await route(path).handler({ method: 'GET', url: path }, response)
      assert.equal(response.status, 404, `${path} must refuse without a workspace`)
      assert.equal(JSON.parse(response.body).error.code, 'workspace-not-configured')
    }
  })
})

test('a cross-origin write is refused everywhere', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { route } = mount({ dataDir, workspace })
    for (const path of [EMPLOYEES_PATH, ORG_PATH, FINANCE_PATH, SERVICES_PATH]) {
      const response = fakeResponse()
      await route(path).handler(postRequest({ op: 'x' }, { origin: 'https://evil.example' }), response)
      assert.equal(response.status, 403, `${path} must refuse a cross-origin POST`)
      assert.equal(JSON.parse(response.body).error.code, 'forbidden')
    }
  })
})

test('every route is fenced by the host connection policy', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const connection = {
      requestRejection: request => (request?.headers?.['x-untrusted'] === '1' ? { code: 'denied' } : undefined),
    }
    const { route } = mount({ dataDir, workspace, connection })

    const denied = fakeResponse()
    await route(CONFIG_PATH).handler({ method: 'GET', url: '/company/config', headers: { 'x-untrusted': '1' } }, denied)
    assert.equal(denied.status, 403)
    assert.equal(JSON.parse(denied.body).error.code, 'untrusted-connection')

    const allowed = fakeResponse()
    await route(CONFIG_PATH).handler({ method: 'GET', headers: {} }, allowed)
    assert.equal(allowed.status, 200, 'a trusted request is unaffected')
  })
})

/* ── Employees ──────────────────────────────────────────────────────────── */

test('employees CRUD reads and writes the configured workspace database', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { route } = mount({ dataDir, workspace })
    const employees = route(EMPLOYEES_PATH)

    const call = async body => {
      const response = fakeResponse()
      await employees.handler(
        body.method === 'GET'
          ? { method: 'GET', url: `/company/employees?search=${encodeURIComponent(body.search ?? '')}` }
          : postRequest(body),
        response,
      )
      return { status: response.status, body: JSON.parse(response.body) }
    }

    const created = await call({ op: 'create', employee: { name: '张三', email: 'zhang@example.com', status: 'active' } })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.email, 'zhang@example.com')
    assert.ok(existsSync(join(workspace, 'web', 'data', 'app.sqlite')), 'the workspace from Config owns the database')

    const listed = await call({ method: 'GET', search: 'zhang' })
    assert.equal(listed.status, 200)
    assert.equal(listed.body.total, 1, 'search is case-insensitive')
    assert.equal(listed.body.data[0].name, '张三')

    const duplicate = await call({ op: 'create', employee: { name: 'dupe', email: 'zhang@example.com' } })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.error.code, 'EMAIL_CONFLICT')

    const updated = await call({ op: 'update', id: created.body.data.id, patch: { status: 'inactive' } })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.status, 'inactive')

    const removed = await call({ op: 'delete', id: created.body.data.id })
    assert.equal(removed.status, 200)
    assert.deepEqual(removed.body.data, { id: created.body.data.id })
    const again = await call({ op: 'delete', id: created.body.data.id })
    assert.equal(again.status, 404)

    const bad = await call({ op: 'create', employee: { name: '', email: 'nope' } })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR')

    const unknown = await call({ op: 'archive' })
    assert.equal(unknown.status, 400)
    assert.match(unknown.body.error.message, /unknown op/)
  })
})

/* ── Organization ───────────────────────────────────────────────────────── */

test('the organization route manages several companies with departments and job levels', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { route } = mount({ dataDir, workspace })
    const org = route(ORG_PATH)

    const get = async (query = '') => {
      const response = fakeResponse()
      await org.handler({ method: 'GET', url: `/company/organization${query}` }, response)
      return { status: response.status, body: JSON.parse(response.body) }
    }
    const post = async body => {
      const response = fakeResponse()
      await org.handler(postRequest(body), response)
      return { status: response.status, body: JSON.parse(response.body) }
    }

    const empty = await get()
    assert.deepEqual(empty.body.data.companies, [])
    assert.equal(empty.body.data.company, null)

    const a = await post({ op: 'company.create', name: '甲公司' })
    const b = await post({ op: 'company.create', name: '乙公司' })
    assert.equal(a.status, 201)
    assert.equal((await get()).body.data.companies.length, 2)

    const aRoot = await post({ op: 'department.create', companyId: a.body.data.company.id, name: '研发部' })
    const bRoot = await post({ op: 'department.create', companyId: b.body.data.company.id, name: '财务部' })
    assert.equal(aRoot.status, 201)
    const crossParent = await post({
      op: 'department.create',
      companyId: b.body.data.company.id,
      name: '串门',
      parentDepartmentId: aRoot.body.data.department.id,
    })
    assert.equal(crossParent.status, 400, 'a parent must belong to the same company')

    const levelA = await post({ op: 'joblevel.create', companyId: a.body.data.company.id, name: 'P7', rankOrder: 1 })
    const levelB = await post({ op: 'joblevel.create', companyId: b.body.data.company.id, name: 'P5', rankOrder: 1 })
    assert.equal(levelA.status, 201)

    const scopedA = await get(`?companyId=${a.body.data.company.id}`)
    const scopedB = await get(`?companyId=${b.body.data.company.id}`)
    assert.deepEqual(scopedA.body.data.departments.map(item => item.name), ['研发部'])
    assert.deepEqual(scopedB.body.data.departments.map(item => item.name), ['财务部'])
    assert.deepEqual(scopedA.body.data.jobLevels.map(item => item.name), ['P7'])

    const renamed = await post({ op: 'company.rename', id: a.body.data.company.id, name: '甲公司（更名）' })
    assert.equal(renamed.status, 200)

    const blockedCompany = await post({ op: 'company.delete', id: a.body.data.company.id })
    assert.equal(blockedCompany.status, 409, 'a company with structure is not deleted silently')

    const child = await post({ op: 'department.create', companyId: a.body.data.company.id, name: '后端', parentDepartmentId: aRoot.body.data.department.id })
    const parentDelete = await post({ op: 'department.delete', id: aRoot.body.data.department.id })
    assert.equal(parentDelete.status, 409, 'a department with children is not deleted silently')

    await post({ op: 'department.delete', id: child.body.data.department.id })
    await post({ op: 'department.delete', id: aRoot.body.data.department.id })
    await post({ op: 'joblevel.delete', id: levelA.body.data.jobLevel.id })
    const deleted = await post({ op: 'company.delete', id: a.body.data.company.id })
    assert.equal(deleted.status, 200)
    assert.equal((await get()).body.data.companies.length, 1, 'only 乙公司 remains')
    void bRoot
    void levelB

    const unknown = await post({ op: 'nope' })
    assert.equal(unknown.status, 400)
  })
})

test('employees can be linked to a company and a department of that company', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { route } = mount({ dataDir, workspace })
    const org = route(ORG_PATH)
    const employees = route(EMPLOYEES_PATH)

    const orgCall = async body => {
      const response = fakeResponse()
      await org.handler(postRequest(body), response)
      return JSON.parse(response.body).data
    }
    const a = (await orgCall({ op: 'company.create', name: '甲公司' })).company
    const b = (await orgCall({ op: 'company.create', name: '乙公司' })).company
    const aDev = (await orgCall({ op: 'department.create', companyId: a.id, name: '研发部' })).department
    const bFin = (await orgCall({ op: 'department.create', companyId: b.id, name: '财务部' })).department

    const call = async body => {
      const response = fakeResponse()
      await employees.handler(
        body.method === 'GET'
          ? { method: 'GET', url: `/company/employees?companyId=${body.companyId ?? ''}&search=` }
          : postRequest(body),
        response,
      )
      return { status: response.status, body: JSON.parse(response.body) }
    }

    const created = await call({ op: 'create', employee: { name: '张三', email: 'z@x.com', companyId: a.id, departmentId: aDev.id } })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.companyName, '甲公司')
    assert.equal(created.body.data.departmentName, '研发部')

    const mismatched = await call({ op: 'create', employee: { name: '李四', email: 'l@x.com', companyId: b.id, departmentId: aDev.id } })
    assert.equal(mismatched.status, 400, 'a department must belong to the chosen company')

    await call({ op: 'create', employee: { name: '赵六', email: 'zg@x.com', companyId: b.id, departmentId: bFin.id } })

    const onlyA = await call({ method: 'GET', companyId: a.id })
    assert.equal(onlyA.body.total, 1, 'the list can be scoped to one company')

    const moved = await call({ op: 'update', id: created.body.data.id, patch: { departmentId: bFin.id } })
    assert.equal(moved.status, 400, 'a bare department move across companies is refused')
    const movedOk = await call({ op: 'update', id: created.body.data.id, patch: { companyId: b.id, departmentId: bFin.id } })
    assert.equal(movedOk.status, 200)
    assert.equal(movedOk.body.data.companyName, '乙公司')
  })
})

/* ── Services ───────────────────────────────────────────────────────────── */

test('the services route lists dependencies, refuses a phantom start and uses Config.appPort', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { route } = mount({ dataDir, workspace, appPort: 43999 })
    const services = route(SERVICES_PATH)

    const listed = fakeResponse()
    await services.handler({ method: 'GET', url: '/company/services' }, listed)
    assert.equal(listed.status, 200)
    const rows = JSON.parse(listed.body).data
    // No delivered app under this workspace: the database row is all there is.
    assert.deepEqual(rows.map(service => service.id), ['db'])
    assert.equal(rows[0].status, 'missing', 'no database file yet')

    const bad = fakeResponse()
    await services.handler(postRequest({ serviceId: 'db', action: 'start' }), bad)
    assert.equal(bad.status, 400, 'a file dependency has no start action')
    assert.equal(JSON.parse(bad.body).error.code, 'BAD_REQUEST')

    const noApp = fakeResponse()
    await services.handler(postRequest({ serviceId: 'web', action: 'start' }), noApp)
    assert.equal(noApp.status, 400)
    assert.equal(JSON.parse(noApp.body).error.code, 'NO_APP')

    const unknown = fakeResponse()
    await services.handler(postRequest({ serviceId: 'web', action: 'explode' }), unknown)
    assert.equal(unknown.status, 400)
    assert.equal(JSON.parse(unknown.body).error.code, 'BAD_REQUEST')

    // A workspace that still ships an app lists the server row on the configured port.
    mkdirSync(join(workspace, 'web'), { recursive: true })
    await writeFile(join(workspace, 'web', 'package.json'), '{"scripts":{"start":"next start"}}')
    const withApp = fakeResponse()
    await services.handler({ method: 'GET', url: '/company/services' }, withApp)
    const withRows = JSON.parse(withApp.body).data
    assert.deepEqual(withRows.map(service => service.id), ['db', 'web'])
    assert.equal(withRows[1].port, 43999, 'the configured appPort is what the panel shows')
    assert.ok(['running', 'stopped'].includes(withRows[1].status))

    const stopped = fakeResponse()
    await services.handler(postRequest({ serviceId: 'web', action: 'stop' }), stopped)
    assert.equal(stopped.status, 200)
    assert.equal(JSON.parse(stopped.body).data.status, 'stopped')
  })
})

/* ── Finance ────────────────────────────────────────────────────────────── */

test('the finance route reads a directory of bank CSVs and imports it once', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { route } = mount({ dataDir, workspace })
    const finance = route(FINANCE_PATH)

    const bankDir = join(dataDir, 'bank')
    mkdirSync(bankDir, { recursive: true })
    await writeFile(join(bankDir, '2026-01.csv'), [
      '交易日期,交易摘要,对方户名,交易金额,收支,余额',
      '2026-01-05,工资发放,某某公司,12000.00,收入,12000.00',
      '2026-01-08,美团外卖,美团,-38.50,支出,11961.50',
      '2026-02-01,房租,张房东,-5000.00,支出,6961.50',
    ].join('\n'), 'utf8')

    const refused = fakeResponse()
    await finance.handler(postRequest({ op: 'set-dir', dir: 'relative/path' }), refused)
    assert.equal(refused.status, 400, 'a directory must be absolute')

    const outside = fakeResponse()
    await finance.handler(postRequest({ op: 'set-dir', dir: '/etc' }), outside)
    assert.equal(outside.status, 403, 'a directory outside the allowed roots is refused')
    assert.equal(JSON.parse(outside.body).error.code, 'path-not-allowed')

    const configured = fakeResponse()
    await finance.handler(postRequest({ op: 'set-dir', dir: bankDir }), configured)
    assert.equal(configured.status, 200)
    assert.equal(JSON.parse(configured.body).dir, bankDir)

    const listed = fakeResponse()
    await finance.handler({ method: 'GET', url: '/company/finance' }, listed)
    const before = JSON.parse(listed.body)
    assert.equal(before.source, 'files')
    assert.equal(before.dirExists, true)
    assert.equal(before.files.length, 1, 'one CSV is offered, nothing else')
    assert.equal(before.files[0].name, '2026-01.csv')
    assert.equal(before.files[0].importedAt, null, 'not imported yet')
    assert.equal(before.totalTransactions, 0)

    const imported = fakeResponse()
    await finance.handler(postRequest({ op: 'import' }), imported)
    assert.equal(imported.status, 200)
    const result = JSON.parse(imported.body).result
    assert.equal(result.imported.length, 1)
    assert.equal(result.imported[0].rows, 3)
    assert.equal(result.imported[0].encoding, 'utf-8')
    assert.equal(result.imported[0].skipped, 0)

    const january = fakeResponse()
    await finance.handler({ method: 'GET', url: '/company/finance?from=2026-01-01&to=2026-01-31' }, january)
    const after = JSON.parse(january.body)
    assert.equal(after.files[0].importedAt !== null, true, 'the file shows as imported')
    assert.equal(after.totalTransactions, 3, 'all rows are on the books')
    assert.equal(after.summary.totals.income, 12000)
    assert.equal(after.summary.totals.expense, 38.5)
    assert.equal(after.summary.count, 2, 'the window really filters')
    assert.equal(after.transactions.length, 2)
    assert.ok(after.categories.includes('工资薪酬'), 'categories are derived for grouping')

    const again = fakeResponse()
    await finance.handler(postRequest({ op: 'import' }), again)
    const second = JSON.parse(again.body).result
    assert.equal(second.imported.length, 0, 're-importing the same export is a no-op')
    assert.equal(second.skipped[0].reason, 'already-imported')

    // The statements actually arrive as Excel; the same route has to take them.
    await writeFile(join(bankDir, '流水-2026-03.xlsx'), buildXlsx())
    const xlsxImport = fakeResponse()
    await finance.handler(postRequest({ op: 'import' }), xlsxImport)
    const xlsxResult = JSON.parse(xlsxImport.body).result
    assert.equal(xlsxResult.imported.length, 1)
    assert.equal(xlsxResult.imported[0].format, 'xlsx')
    assert.equal(xlsxResult.imported[0].sheet, '流水', 'the statement tab, not the cover tab')
    assert.equal(xlsxResult.imported[0].rows, 3)

    const listedXlsx = fakeResponse()
    await finance.handler({ method: 'GET', url: '/company/finance' }, listedXlsx)
    const withXlsx = JSON.parse(listedXlsx.body)
    assert.equal(withXlsx.totalTransactions, 6, 'csv rows and xlsx rows share one ledger')
    assert.ok(withXlsx.files.some(file => file.format === 'xlsx'), 'the folder listing names the format')

    const unknown = fakeResponse()
    await finance.handler(postRequest({ op: 'reconcile' }), unknown)
    assert.equal(unknown.status, 400)

    const crossOrigin = fakeResponse()
    await finance.handler(postRequest({ op: 'import' }, { origin: 'https://evil.example' }), crossOrigin)
    assert.equal(crossOrigin.status, 403, 'a cross-origin import is refused')
  })
})

test('the finance route reads the app ledger database instead of CSV files', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const { route } = mount({ dataDir, workspace })
    const finance = route(FINANCE_PATH)

    // The owner's database: same schema the company app uses.
    const dbPath = join(dataDir, 'ledger.db')
    const database = new DatabaseSync(dbPath)
    database.exec('create table companies (id text primary key, name text)')
    database.exec(`create table finance (
      id text primary key, date text, type text, "catGroup" text, category text,
      company text, dept text, person text, amount real, method text,
      summary text, voucher text, note text)`)
    database.prepare('insert into companies values (?, ?)').run('c1', '示例公司')
    const insert = database.prepare('insert into finance values (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    insert.run('f1', '2026-05-20', '支出', '人力成本', '社保公积金', 'c1', '', '', 4350, '对公转账', '委托收款', '', '交易后余额：543,375.70')
    insert.run('f2', '2026-03-30', '收入', '其他收入', '税费退回', 'c1', '', '', 1615.24, '对公转账', '电子退库', '', '')
    database.close()

    const outside = fakeResponse()
    await finance.handler(postRequest({ op: 'set-source', source: 'sqlite', dbPath: '/etc/passwd' }), outside)
    assert.equal(outside.status, 403, 'a database outside the allowed roots is refused')
    assert.equal(JSON.parse(outside.body).error.code, 'path-not-allowed')

    const configured = fakeResponse()
    await finance.handler(postRequest({ op: 'set-source', source: 'sqlite', dbPath }), configured)
    assert.equal(configured.status, 200)

    const payload = fakeResponse()
    await finance.handler({ method: 'GET', url: '/company/finance?preset=all' }, payload)
    const body = JSON.parse(payload.body)
    assert.equal(body.source, 'sqlite')
    assert.equal(body.dbExists, true)
    assert.equal(body.totalTransactions, 2)
    assert.deepEqual(body.summary.totals, { income: 1615.24, expense: 4350, net: -2734.76 })
    assert.ok(body.categories.includes('人力成本 · 社保公积金'))
    const withBalance = body.transactions.find(row => row.id === 'db_f1')
    assert.equal(withBalance.balance, 543375.7)
    assert.equal(withBalance.company, '示例公司')
    const withoutBalance = body.transactions.find(row => row.id === 'db_f2')
    assert.equal(withoutBalance.balance, null, 'rows without a balance say so')

    const refused = fakeResponse()
    await finance.handler(postRequest({ op: 'import' }), refused)
    assert.equal(refused.status, 400, 'a live source has nothing to import')
    assert.equal(JSON.parse(refused.body).error.code, 'not-applicable')

    const bad = fakeResponse()
    // An allowed path that is not a finance database: rejected by the reader,
    // not by the path fence.
    await finance.handler(postRequest({ op: 'set-source', source: 'sqlite', dbPath: join(dataDir, 'nope.db') }), bad)
    assert.equal(bad.status, 400)
    assert.equal(JSON.parse(bad.body).error.code, 'bad-database')
  })
})

test('Config.financeDb is the default ledger path until the panel overrides it', async () => {
  await withCompanyDir(async ({ dataDir, workspace }) => {
    const financeDb = join(dataDir, 'default.db')
    const { route } = mount({ dataDir, workspace, financeDb })

    const payload = fakeResponse()
    await route(FINANCE_PATH).handler({ method: 'GET', url: '/company/finance' }, payload)
    const body = JSON.parse(payload.body)
    assert.equal(body.source, 'files', 'the default source stays the statement folder')
    assert.equal(body.dbPath, financeDb, 'the configured ledger is shown without being read')

    // A second mount pointed at another workspace reads its own book: the
    // finance store is single-tenant per plugin instance.
    const workbench = join(dataDir, 'other-data')
    mkdirSync(workbench, { recursive: true })
    const other = mount({ dataDir: workbench, workspace })
    const before = fakeResponse()
    await other.route(FINANCE_PATH).handler({ method: 'GET', url: '/company/finance' }, before)
    assert.equal(JSON.parse(before.body).totalTransactions, 0, 'a fresh data dir starts empty')
  })
})
