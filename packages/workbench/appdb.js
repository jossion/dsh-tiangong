/**
 * The workbench's own handle on a delivered app's SQLite database.
 *
 * The generated app is a separate Next.js project; this module lets the panel
 * render that app's data natively instead of embedding it in an iframe. The
 * employee schema mirrors the contract the app was built against.
 */
import { DatabaseSync } from 'node:sqlite'
import { ORG_DDL } from './orgdb.js'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DDL = `
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(email) BETWEEN 3 AND 254),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 32),
  department TEXT CHECK (department IS NULL OR length(department) <= 100),
  job_title TEXT CHECK (job_title IS NULL OR length(job_title) <= 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  hired_at TEXT,
  company_id INTEGER REFERENCES company(id),
  department_id INTEGER REFERENCES departments(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
`

/**
 * The org-link columns live outside DDL on purpose: an older employee table
 * predates them, and `CREATE INDEX ... (company_id)` would fail before
 * `ensureEmployeeColumns()` ever ran. Columns first, indexes after.
 */

const STATUSES = ['active', 'inactive']
const FIELDS = ['name', 'email', 'phone', 'department', 'job_title', 'status', 'hired_at']
const ORG_FIELDS = ['companyId', 'departmentId']

export class AppDbError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.code = code
    this.details = details
  }
}

/** Databases are cached per file so the panel does not reopen the file per request. */
const cache = new Map()

export function databasePath(workspace) {
  return join(workspace, 'web', 'data', 'app.sqlite')
}

export function openAppDb(workspace) {
  const path = databasePath(workspace)
  const cached = cache.get(path)
  if (cached !== undefined) return cached
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(ORG_DDL)   // company/departments/job_levels: employees reference them
  db.exec(DDL)
  ensureEmployeeColumns(db)
  cache.set(path, db)
  return db
}

/**
 * Older employee tables predate the org link. `CREATE TABLE IF NOT EXISTS`
 * cannot add columns, so add the two nullable ones in place — no data loss and
 * no rebuild of the table the delivered app owns.
 */
function ensureEmployeeColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(employees)').all().map(column => column.name))
  if (existing.has('company_id') === false) db.exec('ALTER TABLE employees ADD COLUMN company_id INTEGER REFERENCES company(id)')
  if (existing.has('department_id') === false) db.exec('ALTER TABLE employees ADD COLUMN department_id INTEGER REFERENCES departments(id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id)')
}

export function closeAppDb(workspace) {
  const path = databasePath(workspace)
  const db = cache.get(path)
  if (db === undefined) return
  try {
    db.close()
  } catch {
    /* already closed */
  }
  cache.delete(path)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : value === undefined ? undefined : null
}

/** Validate one employee payload against the contract; returns only known fields. */
export function validateEmployee(input, { partial = false } = {}) {
  if (input === null || typeof input !== 'object') throw new AppDbError('VALIDATION_ERROR', 'body must be an object')
  const details = []
  const out = {}
  const has = field => Object.hasOwn(input, field)

  if (!partial || has('name')) {
    const name = text(input.name)
    if (typeof name !== 'string' || name.length < 1 || name.length > 100) {
      details.push({ field: 'name', message: 'name is required, 1-100 characters' })
    } else {
      out.name = name
    }
  }
  if (!partial || has('email')) {
    const email = text(input.email)
    if (typeof email !== 'string' || email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      details.push({ field: 'email', message: 'email must be a valid address' })
    } else {
      out.email = email
    }
  }
  for (const [field, max] of [['phone', 32], ['department', 100], ['job_title', 100]]) {
    if (!has(field)) continue
    const value = text(input[field])
    if (value === null || value === undefined) {
      out[field] = null
    } else if (typeof value !== 'string' || value.length > max) {
      details.push({ field, message: `${field} must be at most ${max} characters` })
    } else {
      out[field] = value
    }
  }
  if (!partial || has('status')) {
    const status = has('status') ? text(input.status) : 'active'
    if (!STATUSES.includes(status)) details.push({ field: 'status', message: `status must be one of ${STATUSES.join(', ')}` })
    else out.status = status
  }
  if (has('hired_at')) {
    const value = text(input.hired_at)
    if (value === null || value === undefined) {
      out.hired_at = null
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      details.push({ field: 'hired_at', message: 'hired_at must be YYYY-MM-DD' })
    } else {
      out.hired_at = value
    }
  }
  const unknown = Object.keys(input).filter(key => !FIELDS.includes(key) && !ORG_FIELDS.includes(key) && key !== 'id')
  if (unknown.length > 0) details.push({ field: unknown[0], message: 'unknown field' })
  if (details.length > 0) throw new AppDbError('VALIDATION_ERROR', details[0].message, details)
  if (partial && Object.keys(out).length === 0) throw new AppDbError('VALIDATION_ERROR', 'patch needs at least one field')
  return out
}

function toRow(row) {
  if (row === undefined) return null
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    department: row.department ?? null,
    job_title: row.job_title ?? null,
    status: row.status,
    hired_at: row.hired_at ?? null,
    companyId: row.company_id === null || row.company_id === undefined ? null : Number(row.company_id),
    departmentId: row.department_id === null || row.department_id === undefined ? null : Number(row.department_id),
    companyName: row.company_name ?? null,
    departmentName: row.department_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function listEmployees(workspace, { search = '', status = '', companyId = '', limit = 50, offset = 0 } = {}) {
  const db = openAppDb(workspace)
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50))
  const safeOffset = Math.max(0, Number(offset) || 0)
  const where = []
  const params = []
  if (search) {
    where.push('(e.name LIKE ? OR e.email LIKE ? OR e.department LIKE ? OR e.job_title LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like)
  }
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (companyId !== '' && companyId !== undefined && companyId !== null) {
    where.push('e.company_id = ?')
    params.push(Number(companyId))
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS total FROM employees e ${clause}`).get(...params).total
  const rows = db.prepare(
    `SELECT e.*, c.name AS company_name, d.name AS department_name
       FROM employees e
       LEFT JOIN company c ON c.id = e.company_id
       LEFT JOIN departments d ON d.id = e.department_id
       ${clause} ORDER BY e.id ASC LIMIT ? OFFSET ?`,
  ).all(...params, safeLimit, safeOffset)
  return { rows: rows.map(toRow), total: Number(total), limit: safeLimit, offset: safeOffset }
}

export function findEmployee(workspace, id) {
  const db = openAppDb(workspace)
  return toRow(db.prepare(
    `SELECT e.*, c.name AS company_name, d.name AS department_name
       FROM employees e
       LEFT JOIN company c ON c.id = e.company_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.id = ?`,
  ).get(Number(id)))
}

/**
 * The link is checked against the organization tables, not trusted from the
 * form: a department always decides its company, and a mismatch is refused.
 */
function resolveOrgIds(db, companyId, departmentId) {
  const company = companyId === null || companyId === undefined ? null : Number(companyId)
  const department = departmentId === null || departmentId === undefined ? null : Number(departmentId)
  if (company !== null) {
    const row = db.prepare('SELECT id FROM company WHERE id = ?').get(company)
    if (row === undefined) throw new AppDbError('VALIDATION_ERROR', 'companyId does not exist', [{ field: 'companyId', message: 'does not exist' }])
  }
  if (department === null) {
    return { companyId: company, departmentId: null }
  }
  const row = db.prepare('SELECT id, company_id FROM departments WHERE id = ?').get(department)
  if (row === undefined) throw new AppDbError('VALIDATION_ERROR', 'departmentId does not exist', [{ field: 'departmentId', message: 'does not exist' }])
  const owner = Number(row.company_id)
  if (company !== null && company !== owner) {
    throw new AppDbError('VALIDATION_ERROR', 'departmentId belongs to another company', [{ field: 'departmentId', message: 'other company' }])
  }
  return { companyId: owner, departmentId: department }
}

/** Accept only present org keys so PATCH can leave them untouched. */
function orgPatch(input) {
  const patch = {}
  for (const key of ORG_FIELDS) {
    if (input !== null && typeof input === 'object' && Object.hasOwn(input, key)) patch[key] = input[key] === '' ? null : input[key]
  }
  return patch
}

export function createEmployee(workspace, input) {
  const value = validateEmployee(input)
  const db = openAppDb(workspace)
  const org = resolveOrgIds(db, input?.companyId ?? null, input?.departmentId ?? null)
  try {
    const result = db
      .prepare('INSERT INTO employees (name, email, phone, department, job_title, status, hired_at, company_id, department_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(value.name, value.email, value.phone ?? null, value.department ?? null, value.job_title ?? null, value.status, value.hired_at ?? null, org.companyId, org.departmentId)
    return findEmployee(workspace, Number(result.lastInsertRowid))
  } catch (error) {
    throw mapSqliteError(error)
  }
}

export function updateEmployee(workspace, id, input) {
  // A patch may touch only the org link; that is still a valid update.
  const hasContractField = FIELDS.some(field => Object.hasOwn(input ?? {}, field))
  const hasOrgField = ORG_FIELDS.some(field => Object.hasOwn(input ?? {}, field))
  if (hasContractField === false && hasOrgField === false) {
    throw new AppDbError('VALIDATION_ERROR', 'patch needs at least one field')
  }
  const value = hasContractField ? validateEmployee(input, { partial: true }) : {}
  const db = openAppDb(workspace)
  const current = findEmployee(workspace, id)
  if (current === null) throw new AppDbError('NOT_FOUND', `employee ${id} does not exist`)
  const next = { ...current, ...value }
  const patch = orgPatch(input)
  const org = resolveOrgIds(
    db,
    Object.hasOwn(patch, 'companyId') ? patch.companyId : current.companyId,
    Object.hasOwn(patch, 'departmentId') ? patch.departmentId : current.departmentId,
  )
  try {
    db.prepare(
      "UPDATE employees SET name = ?, email = ?, phone = ?, department = ?, job_title = ?, status = ?, hired_at = ?, company_id = ?, department_id = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(next.name, next.email, next.phone ?? null, next.department ?? null, next.job_title ?? null, next.status, next.hired_at ?? null, org.companyId, org.departmentId, Number(id))
    return findEmployee(workspace, id)
  } catch (error) {
    throw mapSqliteError(error)
  }
}

export function deleteEmployee(workspace, id) {
  const db = openAppDb(workspace)
  const result = db.prepare('DELETE FROM employees WHERE id = ?').run(Number(id))
  if (Number(result.changes) === 0) throw new AppDbError('NOT_FOUND', `employee ${id} does not exist`)
  return true
}

function mapSqliteError(error) {
  const message = String(error?.message ?? '')
  if (message.includes('UNIQUE')) return new AppDbError('EMAIL_CONFLICT', 'an employee with that email already exists')
  if (message.includes('CHECK') || message.includes('NOT NULL')) return new AppDbError('VALIDATION_ERROR', message)
  return new AppDbError('INTERNAL_ERROR', 'could not write the employee')
}
