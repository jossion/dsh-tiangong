/**
 * Host half of the Company bundle.
 *
 * Company modules for the Tiangong workbench: the staff directory, the
 * organization chart and the finance dashboard, all read from the delivered
 * company app's SQLite file (or its exported bank statements), plus the
 * lifecycle of the app's own HTTP server.
 *
 * This is the single-tenant half of the split: the workspace is a plugin
 * setting (`config.workspace`), not a per-project property. Every route is
 * `/company/*` and goes through the same host connection fence as the
 * workbench half, so the two plugins can share one profile without either
 * becoming the other's trust hole.
 *
 * Everything registered here is owned by this plugin's context, so unloading
 * the plugin removes its routes and stops any app server it started.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { createStore } from './store.js'
import { AppDbError, createEmployee, deleteEmployee, listEmployees, updateEmployee } from './appdb.js'
import {
  OrgError, createCompany, createDepartment, createJobLevel, deleteCompany, deleteDepartment, deleteJobLevel,
  listCompanies, listDepartments, listJobLevels, renameCompany, updateDepartment, updateJobLevel,
} from './orgdb.js'
import { disposeAll, listServices, ServiceError, startService, stopService } from './services.js'
import { readFinanceLedger } from './ledgerdb.js'
import {
  DEFAULT_FINANCE_DIR,
  fileFingerprint,
  filterTransactions,
  resolveRange,
  statementSheets,
  summarizeFinance,
  toTransactions,
} from './finance.js'

/**
 * The company half registers no agent tools; its routes only need `webServer`,
 * which is injected as an optional sub-fiber below (a headless profile stays
 * silent rather than broken).
 */
export const inject = []

/**
 * The plugin's tunables, in the official form: `export const Config` makes the
 * Loader validate the row's `config` and fill defaults at activation.
 *
 * Schemastery is resolved from the host installation at load time. Tests (and
 * any embedder without the host package) fall back to the same contract as a
 * Standard Schema, so validation stays honest instead of disappearing.
 */
const CONFIG_DEFAULTS = Object.freeze({
  workspace: '',
  dataDir: '',
  financeDb: '',
  appPort: 4321,
})

function validateConfigFallback(value) {
  const issues = []
  const input = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const out = { ...CONFIG_DEFAULTS }
  for (const key of ['workspace', 'dataDir', 'financeDb']) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string') issues.push({ message: `${key} must be a string`, path: [{ key }] })
    else out[key] = input[key]
  }
  if (input.appPort !== undefined) {
    const port = Number(input.appPort)
    if (!Number.isInteger(port) || port < 0) issues.push({ message: 'appPort must be a non-negative integer', path: [{ key: 'appPort' }] })
    else out.appPort = port
  }
  return issues.length > 0 ? { issues } : { value: out }
}

const fallbackConfig = {
  '~standard': { version: 1, vendor: 'jos-company', validate: validateConfigFallback },
}

let Config = fallbackConfig
try {
  const schemastery = await import('@deepseek-ai/schemastery')
  const z = schemastery.default ?? schemastery
  if (typeof z?.object === 'function') {
    Config = z.object({
      workspace: z.string().description('Absolute path of the delivered company project; empty means the plugin serves nothing but its config.').default(''),
      dataDir: z.string().description('Where finance state is stored; empty means ~/.dsh/company.').default(''),
      financeDb: z.string().description('Default SQLite ledger path for the finance source; empty means the saved source only.').default(''),
      appPort: z.number().min(0).description('Port the delivered app server listens on.').default(4321),
    })
  }
} catch {
  /* host package unavailable (unit tests): the Standard Schema fallback runs */
}

export { Config }

const DEFAULTS = {
  workspace: '',
  dataDir: '',
  financeDb: '',
  appPort: 4321,
}

/** The panel reads this to know which workspace and port it is bound to. */
export const CONFIG_PATH = '/company/config'

/** Staff directory, backed by the delivered app's SQLite file. */
export const EMPLOYEES_PATH = '/company/employees'

/** Organization chart: companies, departments, job levels. */
export const ORG_PATH = '/company/organization'

/** Finance: statements in, dashboard out; read on GET, import/configure on POST. */
export const FINANCE_PATH = '/company/finance'

/** The delivered app's dependencies: what they need, whether up, controls. */
export const SERVICES_PATH = '/company/services'

function resolveDataDir(configured) {
  if (configured) return configured
  return join(homedir(), '.dsh', 'company')
}

/** `~` is only shorthand a person typed; the filesystem wants a real path. */
function expandHome(value) {
  const text = String(value ?? '').trim()
  if (text === '' || text === '~') return text === '~' ? homedir() : ''
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

/** The one workspace this plugin serves: absolute or nothing. */
function resolveWorkspace(configured) {
  const workspace = expandHome(configured)
  if (workspace === '' || !isAbsolute(workspace)) return ''
  return resolve(workspace)
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}

/** Cap the request body: a finance import names files, it does not carry them. */
const MAX_BODY_BYTES = 16 * 1024

/** Read a JSON request body from a Node stream (or a pre-set string in tests). */
async function readJsonBody(request, limit = MAX_BODY_BYTES) {
  if (typeof request.body === 'string') {
    if (request.body.length > limit) throw new Error('body too large')
    return JSON.parse(request.body)
  }
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/**
 * Reject a cross-origin write. A same-origin fetch from the panel may carry an
 * Origin header; a request with none is a local tool (curl, tests) and is
 * allowed, since it never carries a browser's ambient authority.
 */
function isSameOrigin(request) {
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === request.headers?.host
  } catch {
    return false
  }
}

/**
 * The host's own trust fence for raw web routes. `webServer` hands us the full
 * request/response; only `connection` knows the browser authentication and
 * Host/Origin policy, so every route asks it before touching company data.
 *
 * A profile without the connection service keeps its old same-origin check:
 * that is a degraded host, not a reason to stop serving the panel.
 */
function connectionDenied(ctx, request) {
  try {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (connection === null || connection === undefined || typeof connection.requestRejection !== 'function') return false
    const rejection = connection.requestRejection(request)
    return rejection !== null && rejection !== undefined && rejection !== false
  } catch {
    return false
  }
}

/** Roots a path-sensitive route may touch: home, this plugin's data dir, the configured workspace. */
function allowedRoots(config) {
  return [homedir(), config.dataDir, config.workspace]
    .filter(root => typeof root === 'string' && root !== '')
    .map(root => resolve(root))
}

/** Is `target` inside one of the allowed roots (or equal to one)? */
function pathAllowed(target, roots) {
  const resolved = resolve(target)
  return roots.some(root => resolved === root || resolved.startsWith(`${root}${sep}`))
}

export function apply(ctx, row) {
  const config = { ...DEFAULTS, ...(row ?? {}) }
  if (!isAbsolute(config.dataDir)) {
    config.dataDir = resolveDataDir(config.dataDir)
  }
  config.dataDir = resolve(expandHome(config.dataDir))
  config.workspace = resolveWorkspace(config.workspace)
  config.financeDb = expandHome(config.financeDb)
  config.appPort = Number(config.appPort)
  if (!Number.isInteger(config.appPort) || config.appPort < 0) config.appPort = DEFAULTS.appPort

  const store = createStore(config.dataDir)
  const roots = allowedRoots(config)

  /** 404 for routes whose data source is the configured workspace. */
  const noWorkspace = response => {
    sendJson(response, 404, {
      error: {
        code: 'workspace-not-configured',
        message: 'config.workspace is not set: point the plugin at the delivered company project',
      },
    })
  }

  // ---------------------------------------------------------------------------
  // The two DB-backed panel sections read the delivered app's SQLite file.
  // The point is that the panel does not need the app's HTTP server to be up:
  // one company workspace, no iframe.
  // ---------------------------------------------------------------------------

  const configRoute = {
    kind: 'exact',
    path: CONFIG_PATH,
    handler: (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      // `financeDb` is echoed as configured: the panel shows where the default
      // ledger is, but only the finance route decides whether it is readable.
      sendJson(response, 200, {
        data: { workspace: config.workspace, financeDb: config.financeDb, appPort: config.appPort },
      })
    },
  }

  const dbError = (error, response, fallback = 500) => {
    if (error instanceof AppDbError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'EMAIL_CONFLICT' ? 409 : 400
      sendJson(response, status, { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } })
      return
    }
    sendJson(response, fallback, { error: { code: 'INTERNAL_ERROR', message: String(error?.message ?? error) } })
  }

  const employeesRoute = {
    kind: 'exact',
    path: EMPLOYEES_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      if (config.workspace === '') {
        noWorkspace(response)
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      try {
        if (request.method === 'GET') {
          const result = listEmployees(config.workspace, {
            search: url.searchParams.get('search') ?? '',
            status: url.searchParams.get('status') ?? '',
            companyId: url.searchParams.get('companyId') ?? '',
            limit: url.searchParams.get('limit') ?? 50,
            offset: url.searchParams.get('offset') ?? 0,
          })
          sendJson(response, 200, { data: result.rows, total: result.total, limit: result.limit, offset: result.offset })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: { code: 'method-not-allowed' } })
          return
        }
        const body = await readJsonBody(request)
        const op = String(body?.op ?? 'create')
        if (op === 'create') {
          sendJson(response, 201, { data: createEmployee(config.workspace, body?.employee ?? {}) })
          return
        }
        if (op === 'update') {
          sendJson(response, 200, { data: updateEmployee(config.workspace, body?.id, body?.patch ?? {}) })
          return
        }
        if (op === 'delete') {
          deleteEmployee(config.workspace, body?.id)
          sendJson(response, 200, { data: { id: Number(body?.id) } })
          return
        }
        sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: `unknown op ${op}` } })
      } catch (error) {
        dbError(error, response)
      }
    },
  }

  const orgRoute = {
    kind: 'exact',
    path: ORG_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      if (config.workspace === '') {
        noWorkspace(response)
        return
      }
      const workspace = config.workspace
      const url = new URL(request.url ?? '/', 'http://localhost')
      const fail = error => {
        if (error instanceof OrgError) {
          const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'HAS_CHILDREN' ? 409 : 400
          sendJson(response, status, { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } })
          return
        }
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: String(error?.message ?? error) } })
      }
      try {
        if (request.method === 'GET') {
          const companies = listCompanies(workspace)
          const requested = Number(url.searchParams.get('companyId') ?? 0)
          const company = companies.find(item => item.id === requested) ?? companies[0] ?? null
          sendJson(response, 200, {
            data: {
              companies,
              company,
              departments: company === null ? [] : listDepartments(workspace, company.id),
              jobLevels: company === null ? [] : listJobLevels(workspace, company.id),
            },
          })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: { code: 'method-not-allowed' } })
          return
        }
        const body = await readJsonBody(request)
        const op = String(body?.op ?? '')
        if (op === 'company.create') {
          sendJson(response, 201, { data: { company: createCompany(workspace, body) } })
          return
        }
        if (op === 'company.rename') {
          sendJson(response, 200, { data: { company: renameCompany(workspace, Number(body?.id), body) } })
          return
        }
        if (op === 'company.delete') {
          sendJson(response, 200, { data: { deleted: deleteCompany(workspace, Number(body?.id)) } })
          return
        }
        if (op === 'department.create') {
          sendJson(response, 201, { data: { department: createDepartment(workspace, Number(body?.companyId), body) } })
          return
        }
        if (op === 'department.update') {
          sendJson(response, 200, { data: { department: updateDepartment(workspace, Number(body?.id), body) } })
          return
        }
        if (op === 'department.delete') {
          sendJson(response, 200, { data: { deleted: deleteDepartment(workspace, Number(body?.id)) } })
          return
        }
        if (op === 'joblevel.create') {
          sendJson(response, 201, { data: { jobLevel: createJobLevel(workspace, Number(body?.companyId), body) } })
          return
        }
        if (op === 'joblevel.update') {
          sendJson(response, 200, { data: { jobLevel: updateJobLevel(workspace, Number(body?.id), body) } })
          return
        }
        if (op === 'joblevel.delete') {
          sendJson(response, 200, { data: { deleted: deleteJobLevel(workspace, Number(body?.id)) } })
          return
        }
        sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: `unknown op ${op}` } })
      } catch (error) {
        fail(error)
      }
    },
  }

  // ---------------------------------------------------------------------------
  // Finance: bank-statement CSV -> transactions -> one dashboard payload.
  //
  // The host owns the filesystem read. A browser cannot list a directory, and
  // "读取指定目录里的 CSV" is the requirement verbatim, so the panel names a
  // directory and the host answers with the files it may import. Nothing here
  // touches the company app database: statement rows are their own collection,
  // and the read route stays read-only while POST carries the writes.
  //
  // Single-tenant: every book belongs to this plugin's one workspace, so the
  // internal project id is the empty string. Stored rows carry it explicitly
  // and the read path filters by it, exactly like the multi-tenant workbench
  // finance did with a real project id.
  // ---------------------------------------------------------------------------
  const FINANCE_CONFIG_ID = 'finance'
  const FINANCE_PROJECT_ID = ''

  async function financeConfig() {
    const rows = await store.list('financeConfig')
    const row = rows.find(item => item.id === FINANCE_CONFIG_ID)
    return {
      // Two sources: a folder of exported statements, or the app's own ledger
      // database (read-only). `files` is the default so an old config keeps
      // working without a migration.
      source: row?.source === 'sqlite' ? 'sqlite' : 'files',
      dir: expandHome(row?.dir ?? '') || DEFAULT_FINANCE_DIR,
      // The profile-level default is only a fallback: an explicit source choice
      // made from the panel wins.
      dbPath: expandHome(row?.dbPath ?? '') || config.financeDb,
    }
  }

  async function saveFinanceConfig(patch) {
    const rows = await store.list('financeConfig')
    const row = rows.find(item => item.id === FINANCE_CONFIG_ID)
    if (row === undefined) return store.add('financeConfig', { id: FINANCE_CONFIG_ID, projectId: FINANCE_PROJECT_ID, ...patch })
    return store.update('financeConfig', FINANCE_CONFIG_ID, patch)
  }

  /**
   * The CSV files in the configured directory.
   *
   * "Already imported" is matched on name+size instead of hashing every file on
   * every panel poll: a 10 MB statement should not be read to answer "is there
   * anything new". The import itself still fingerprints the bytes, so the
   * double-import guard is exact where it matters.
   */
  async function financeFiles(dir) {
    const imports = (await store.list('financeImports')).filter(item => (item.projectId ?? '') === FINANCE_PROJECT_ID)
    const importedByKey = new Map(imports.map(item => [`${item.file}:${item.size}`, item]))
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const files = []
      for (const entry of entries) {
        if (entry.isFile() === false || /\.(csv|xlsx|xlsm|xls)$/i.test(entry.name) === false) continue
        const info = await stat(join(dir, entry.name))
        const imported = importedByKey.get(`${entry.name}:${info.size}`)
        files.push({
          name: entry.name,
          format: entry.name.split('.').pop().toLowerCase(),
          size: info.size,
          mtime: info.mtime.toISOString(),
          importedAt: imported?.importedAt ?? null,
          rows: imported?.rows ?? null,
        })
      }
      files.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)) || a.name.localeCompare(b.name))
      return { exists: true, files, error: null }
    } catch (error) {
      return { exists: false, files: [], error: String(error?.message ?? error) }
    }
  }

  /** Parse the selected files, refuse rows already on the books, write once. */
  async function financeImport(dir, requested) {
    const listing = await financeFiles(dir)
    if (listing.exists === false) {
      return { imported: [], skipped: [], errors: [{ file: '*', message: listing.error }] }
    }
    const wanted = Array.isArray(requested) && requested.length > 0 ? new Set(requested) : null
    const existingImports = (await store.list('financeImports')).filter(item => (item.projectId ?? '') === FINANCE_PROJECT_ID)
    const importedFingerprints = new Set(existingImports.map(item => item.fingerprint))
    const existing = (await store.list('financeTransactions')).filter(item => (item.projectId ?? '') === FINANCE_PROJECT_ID)
    const seen = new Set(existing.map(item => item.hash))
    const imported = []
    const skipped = []
    const errors = []
    for (const file of listing.files) {
      if (wanted !== null && wanted.has(file.name) === false) continue
      try {
        const buffer = await readFile(join(dir, file.name))
        const fingerprint = fileFingerprint(buffer)
        if (importedFingerprints.has(fingerprint)) {
          skipped.push({ file: file.name, reason: 'already-imported', rows: file.rows ?? 0 })
          continue
        }
        const importId = `fin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        // A workbook may open on a cover tab; take the first sheet whose header
        // maps, not blindly the first sheet.
        const sheets = statementSheets(buffer, file.name)
        let parsed = null
        let sheetName = ''
        for (const sheet of sheets) {
          const candidate = toTransactions(sheet.rows, { file: file.name, importId })
          if (candidate.headerIndex >= 0) {
            parsed = candidate
            sheetName = sheet.name
            break
          }
        }
        if (parsed === null) {
          errors.push({ file: file.name, message: '找不到表头：至少需要一列日期和一列金额' })
          continue
        }
        const fresh = []
        for (const transaction of parsed.transactions) {
          if (seen.has(transaction.hash)) continue
          seen.add(transaction.hash)
          fresh.push({ ...transaction, id: `${importId}_${transaction.line}`, projectId: FINANCE_PROJECT_ID })
        }
        await store.addMany('financeTransactions', fresh)
        const record = {
          id: importId,
          projectId: FINANCE_PROJECT_ID,
          file: file.name,
          dir,
          fingerprint,
          encoding: sheets[0]?.encoding ?? 'utf-8',
          sheet: sheetName,
          format: file.name.split('.').pop().toLowerCase(),
          size: file.size,
          rows: fresh.length,
          skipped: parsed.skipped,
          duplicateRows: parsed.transactions.length - fresh.length,
          importedAt: new Date().toISOString(),
        }
        await store.add('financeImports', record)
        importedFingerprints.add(fingerprint)
        imported.push(record)
      } catch (error) {
        errors.push({ file: file.name, message: String(error?.message ?? error) })
      }
    }
    return { imported, skipped, errors }
  }

  /** One payload feeds the whole finance page: source, files, aggregates, rows. */
  async function financePayload(url) {
    const current = await financeConfig()
    // `preset` is resolved here, not in the browser: one definition of "本月"
    // (the local calendar) instead of one per client.
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    const preset = url.searchParams.get('preset') ?? ''
    const range = from !== '' || to !== '' ? { from, to } : resolveRange(preset)
    const filters = {
      from: range.from,
      to: range.to,
      category: url.searchParams.get('category') ?? '',
      direction: url.searchParams.get('direction') ?? '',
      q: url.searchParams.get('q') ?? '',
      preset,
    }

    if (current.source === 'sqlite') {
      // The ledger database is the source of truth: read it per request instead
      // of copying rows, so an edit in the app shows up here on the next poll.
      try {
        const ledger = await readFinanceLedger(current.dbPath)
        return {
          source: 'sqlite',
          dbPath: current.dbPath,
          dbExists: true,
          dbError: null,
          dir: current.dir,
          dirExists: true,
          files: [],
          imports: [],
          categories: ledger.categories,
          companies: ledger.companies,
          summary: summarizeFinance(ledger.transactions, filters),
          transactions: filterTransactions(ledger.transactions, filters)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)))
            .slice(0, 200),
          totalTransactions: ledger.transactions.length,
          range: ledger.range,
          filters,
        }
      } catch (error) {
        return {
          source: 'sqlite',
          dbPath: current.dbPath,
          dbExists: false,
          dbError: String(error?.message ?? error),
          dir: current.dir,
          dirExists: true,
          files: [],
          imports: [],
          categories: [],
          companies: [],
          summary: summarizeFinance([], filters),
          transactions: [],
          totalTransactions: 0,
          filters,
        }
      }
    }

    const listing = await financeFiles(current.dir)
    const all = (await store.list('financeTransactions')).filter(item => (item.projectId ?? '') === FINANCE_PROJECT_ID)
    const summary = summarizeFinance(all, filters)
    const transactions = filterTransactions(all, filters)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.line).localeCompare(String(a.line)))
      .slice(0, 200)
    const imports = (await store.list('financeImports')).filter(item => (item.projectId ?? '') === FINANCE_PROJECT_ID)
    return {
      source: 'files',
      dir: current.dir,
      dbPath: current.dbPath,
      dirExists: listing.exists,
      dirError: listing.error,
      files: listing.files,
      imports: imports.slice().reverse(),
      categories: [...new Set(all.map(item => item.category))].filter(Boolean).sort(),
      summary,
      transactions,
      totalTransactions: all.length,
      filters,
    }
  }

  const financeRoute = {
    kind: 'exact',
    path: FINANCE_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      if (request.method === 'POST' && !isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      try {
        if (request.method === 'GET' || request.method === 'HEAD') {
          sendJson(response, 200, await financePayload(url))
          return
        }
        const body = await readJsonBody(request)
        const op = String(body?.op ?? '').trim()
        const source = body?.source === 'sqlite' ? 'sqlite' : 'files'
        if (op === 'set-source' || op === 'set-dir') {
          // `set-dir` stays as the folder-only alias an older panel may send.
          const nextSource = op === 'set-dir' ? 'files' : source
          if (nextSource === 'sqlite') {
            const dbPath = expandHome(body?.dbPath)
            if (dbPath === '' || !isAbsolute(dbPath)) {
              sendJson(response, 400, { error: { code: 'bad-request', message: 'dbPath must be an absolute path' } })
              return
            }
            if (!pathAllowed(dbPath, roots)) {
              sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${dbPath}` } })
              return
            }
            try {
              // Validate by reading, not by inspecting: a valid SQLite file
              // without a `finance` table is still the wrong database.
              await readFinanceLedger(dbPath)
            } catch (error) {
              sendJson(response, 400, { error: { code: 'bad-database', message: String(error?.message ?? error) } })
              return
            }
            await saveFinanceConfig({ source: 'sqlite', dbPath })
            sendJson(response, 200, { ok: true, source: 'sqlite', dbPath })
            return
          }
          const dir = expandHome(body?.dir)
          if (dir === '' || !isAbsolute(dir)) {
            sendJson(response, 400, { error: { code: 'bad-request', message: 'dir must be an absolute path' } })
            return
          }
          if (!pathAllowed(dir, roots)) {
            sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${dir}` } })
            return
          }
          try {
            const info = await stat(dir)
            if (!info.isDirectory()) throw new Error('not a directory')
          } catch (error) {
            sendJson(response, 400, {
              error: { code: 'bad-directory', message: `${dir}: ${String(error?.message ?? error)}` },
            })
            return
          }
          await saveFinanceConfig({ source: 'files', dir })
          sendJson(response, 200, { ok: true, source: 'files', dir })
          return
        }
        if (op === 'import') {
          const current = await financeConfig()
          if (current.source === 'sqlite') {
            sendJson(response, 400, {
              error: { code: 'not-applicable', message: 'SQLite 数据源是实时读取的，不需要导入' },
            })
            return
          }
          sendJson(response, 200, { ok: true, result: await financeImport(current.dir, body?.files) })
          return
        }
        sendJson(response, 400, { error: { code: 'bad-request', message: `unknown op ${op}` } })
      } catch (error) {
        sendJson(response, 500, {
          error: { code: 'finance-unavailable', message: String(error?.message ?? error) },
        })
      }
    },
  }

  /** Dependencies of the delivered app: what it needs, whether it is up, controls. */
  const servicesRoute = {
    kind: 'exact',
    path: SERVICES_PATH,
    handler: async (request, response) => {
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { error: { code: 'forbidden', message: 'cross-origin request' } })
        return
      }
      if (config.workspace === '') {
        noWorkspace(response)
        return
      }
      const workspace = config.workspace
      const options = { port: config.appPort }
      try {
        if (request.method === 'GET') {
          sendJson(response, 200, { data: await listServices(workspace, options) })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: { code: 'method-not-allowed' } })
          return
        }
        const body = await readJsonBody(request)
        const serviceId = String(body?.serviceId ?? '')
        const action = String(body?.action ?? '')
        if (action === 'start') {
          if (!pathAllowed(workspace, roots)) {
            sendJson(response, 403, { error: { code: 'path-not-allowed', message: `outside the allowed roots: ${workspace}` } })
            return
          }
          const result = await startService(workspace, 'company', serviceId, options)
          sendJson(response, 200, { data: result })
          return
        }
        if (action === 'stop') {
          const result = await stopService(workspace)
          sendJson(response, 200, { data: result })
          return
        }
        sendJson(response, 400, { error: { code: 'BAD_REQUEST', message: `unknown action ${action}` } })
      } catch (error) {
        if (error instanceof ServiceError) {
          const status = error.code === 'NO_APP' || error.code === 'BAD_REQUEST' ? 400 : 502
          sendJson(response, status, { error: { code: error.code, message: error.message } })
          return
        }
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: String(error?.message ?? error) } })
      }
    },
  }

  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => {
      const webServer = webCtx.get('webServer')
      if (!webServer || typeof webServer.register !== 'function') {
        return () => {}
      }
      // The fence goes on every route: a handler that skips it would be the
      // one endpoint a tunneled or cross-origin request could reach.
      const fencedRoute = candidate => ({
        ...candidate,
        handler: (request, response) => {
          if (connectionDenied(ctx, request)) {
            sendJson(response, 403, {
              error: { code: 'untrusted-connection', message: 'request rejected by the host connection policy' },
            })
            return
          }
          return candidate.handler(request, response)
        },
      })
      const register = candidate => webServer.register(fencedRoute(candidate))
      const disposers = [
        register(configRoute),
        register(employeesRoute),
        register(orgRoute),
        register(financeRoute),
        register(servicesRoute),
      ]
      return () => {
        // A managed app server must not survive its plugin: stop it first.
        disposeAll()
        for (const dispose of disposers) {
          try {
            dispose?.()
          } catch {
            /* already withdrawn */
          }
        }
      }
    }, 'company: routes')
  })
}
