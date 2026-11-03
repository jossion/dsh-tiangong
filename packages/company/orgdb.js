/**
 * Native organization data for the panel.
 *
 * The delivered Next.js app owns the SQLite file and its `/api/company`,
 * `/api/departments`, `/api/job-levels` routes. The panel reads and writes the
 * same tables directly (node:sqlite), exactly like the employee module, so the
 * org structure can be edited from inside the workbench without running the app.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export class OrgError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.code = code
    this.details = details
  }
}

export const ORG_DDL = `
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES company(id),
  parent_department_id INTEGER REFERENCES departments(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  sort_order INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_department_id);
CREATE TABLE IF NOT EXISTS job_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES company(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  rank_order INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_job_levels_company ON job_levels(company_id);
`

const cache = new Map()

export function orgDbPath(workspace) {
  return join(workspace, 'web', 'data', 'app.sqlite')
}

export function openOrgDb(workspace) {
  const path = orgDbPath(workspace)
  const cached = cache.get(path)
  if (cached !== undefined) return cached
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(ORG_DDL)
  cache.set(path, db)
  return db
}

export function closeOrgDb(workspace) {
  const path = orgDbPath(workspace)
  const db = cache.get(path)
  if (db === undefined) return
  try { db.close() } catch { /* closed */ }
  cache.delete(path)
}

const text = value => (typeof value === 'string' ? value.trim() : value === undefined ? undefined : null)

function nameOf(input, field = 'name') {
  const name = text(input?.[field])
  if (typeof name !== 'string' || name === '' || name.length > 100) {
    throw new OrgError('VALIDATION_ERROR', `${field} must be 1-100 characters`, [{ field, message: `${field} must be 1-100 characters` }])
  }
  return name
}

function intOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isInteger(number)) {
    throw new OrgError('VALIDATION_ERROR', `${field} must be an integer`, [{ field, message: `${field} must be an integer` }])
  }
  return number
}

export function listCompanies(workspace) {
  const db = openOrgDb(workspace)
  return db.prepare('SELECT id, name, updated_at FROM company ORDER BY id').all().map(row => ({
    id: Number(row.id),
    name: row.name,
    updatedAt: row.updated_at,
  }))
}

export function createCompany(workspace, input) {
  const name = nameOf(input)
  const db = openOrgDb(workspace)
  const result = db.prepare('INSERT INTO company (name, updated_at) VALUES (?, ?)').run(name, new Date().toISOString())
  return listCompanies(workspace).find(item => item.id === Number(result.lastInsertRowid))
}

export function renameCompany(workspace, id, input) {
  const db = openOrgDb(workspace)
  const current = db.prepare('SELECT id FROM company WHERE id = ?').get(id)
  if (current === undefined) throw new OrgError('NOT_FOUND', `company ${id} does not exist`)
  db.prepare('UPDATE company SET name = ?, updated_at = ? WHERE id = ?').run(nameOf(input), new Date().toISOString(), id)
  return listCompanies(workspace).find(item => item.id === id)
}

/** A company with structure inside cannot be deleted silently — say why. */
export function deleteCompany(workspace, id) {
  const db = openOrgDb(workspace)
  const current = db.prepare('SELECT id, name FROM company WHERE id = ?').get(id)
  if (current === undefined) throw new OrgError('NOT_FOUND', `company ${id} does not exist`)
  const departments = db.prepare('SELECT COUNT(*) AS n FROM departments WHERE company_id = ?').get(id).n
  const levels = db.prepare('SELECT COUNT(*) AS n FROM job_levels WHERE company_id = ?').get(id).n
  if (Number(departments) + Number(levels) > 0) {
    throw new OrgError('HAS_CHILDREN', 'delete departments and job levels first', [
      { field: 'company', message: `${departments} departments, ${levels} job levels still exist` },
    ])
  }
  db.prepare('DELETE FROM company WHERE id = ?').run(id)
  return { id, name: current.name }
}

export function listDepartments(workspace, companyId) {
  const db = openOrgDb(workspace)
  const rows = db.prepare(
    `SELECT id, company_id, name, parent_department_id, sort_order FROM departments
      WHERE company_id = ? ORDER BY (sort_order IS NULL), sort_order, id`,
  ).all(companyId)
  return rows.map(row => ({
    id: Number(row.id),
    companyId: Number(row.company_id),
    name: row.name,
    parentDepartmentId: row.parent_department_id === null ? null : Number(row.parent_department_id),
    sortOrder: row.sort_order === null ? null : Number(row.sort_order),
  }))
}

function assertParentBelongsToCompany(db, parentId, companyId) {
  if (parentId === null) return null
  const parent = db.prepare('SELECT id, company_id FROM departments WHERE id = ?').get(parentId)
  if (parent !== undefined && Number(parent.company_id) !== Number(companyId)) {
    throw new OrgError('VALIDATION_ERROR', 'parentDepartmentId belongs to another company', [{ field: 'parentDepartmentId', message: 'other company' }])
  }
  if (parent === undefined) {
    throw new OrgError('VALIDATION_ERROR', 'parentDepartmentId does not exist', [{ field: 'parentDepartmentId', message: 'does not exist' }])
  }
  return Number(parent.id)
}

function assertNoCycle(db, id, parentId) {
  let cursor = parentId
  const seen = new Set([id])
  while (cursor !== null && cursor !== undefined) {
    if (seen.has(cursor)) {
      throw new OrgError('VALIDATION_ERROR', 'a department cannot become its own ancestor', [{ field: 'parentDepartmentId', message: 'cycle' }])
    }
    seen.add(cursor)
    const row = db.prepare('SELECT parent_department_id FROM departments WHERE id = ?').get(cursor)
    if (row === undefined) return
    cursor = row.parent_department_id === null ? null : Number(row.parent_department_id)
  }
}

export function createDepartment(workspace, companyId, input) {
  const db = openOrgDb(workspace)
  const company = db.prepare('SELECT id FROM company WHERE id = ?').get(companyId)
  if (company === undefined) throw new OrgError('NOT_FOUND', `company ${companyId} does not exist`)
  const parentId = assertParentBelongsToCompany(db, intOrNull(input?.parentDepartmentId, 'parentDepartmentId'), companyId)
  const result = db.prepare(
    'INSERT INTO departments (company_id, parent_department_id, name, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(company.id, parentId, nameOf(input), intOrNull(input?.sortOrder, 'sortOrder'), new Date().toISOString())
  return listDepartments(workspace, companyId).find(item => item.id === Number(result.lastInsertRowid))
}

export function updateDepartment(workspace, id, input) {
  const db = openOrgDb(workspace)
  const current = db.prepare('SELECT id, company_id, parent_department_id FROM departments WHERE id = ?').get(id)
  if (current === undefined) throw new OrgError('NOT_FOUND', `department ${id} does not exist`)
  const companyId = Number(current.company_id)
  const parentId = input?.parentDepartmentId === undefined
    ? (current.parent_department_id === null ? null : Number(current.parent_department_id))
    : assertParentBelongsToCompany(db, intOrNull(input.parentDepartmentId, 'parentDepartmentId'), companyId)
  if (parentId !== null) assertNoCycle(db, id, parentId)
  const name = input?.name === undefined ? null : nameOf(input)
  db.prepare(
    'UPDATE departments SET name = COALESCE(?, name), parent_department_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
  ).run(name, parentId, input?.sortOrder === undefined ? null : intOrNull(input.sortOrder, 'sortOrder'), new Date().toISOString(), id)
  return listDepartments(workspace, companyId).find(item => item.id === id)
}

export function deleteDepartment(workspace, id) {
  const db = openOrgDb(workspace)
  const current = db.prepare('SELECT id, name, company_id FROM departments WHERE id = ?').get(id)
  if (current === undefined) throw new OrgError('NOT_FOUND', `department ${id} does not exist`)
  const children = db.prepare('SELECT COUNT(*) AS n FROM departments WHERE parent_department_id = ?').get(id).n
  if (Number(children) > 0) {
    throw new OrgError('HAS_CHILDREN', 'delete child departments first', [{ field: 'department', message: `${children} children` }])
  }
  db.prepare('DELETE FROM departments WHERE id = ?').run(id)
  return { id: Number(id), name: current.name }
}

export function deleteJobLevel(workspace, id) {
  const db = openOrgDb(workspace)
  const current = db.prepare('SELECT id, name FROM job_levels WHERE id = ?').get(id)
  if (current === undefined) throw new OrgError('NOT_FOUND', `job level ${id} does not exist`)
  db.prepare('DELETE FROM job_levels WHERE id = ?').run(id)
  return { id: Number(id), name: current.name }
}

export function listJobLevels(workspace, companyId) {
  const db = openOrgDb(workspace)
  const rows = db.prepare(
    'SELECT id, company_id, name, rank_order FROM job_levels WHERE company_id = ? ORDER BY (rank_order IS NULL), rank_order, id',
  ).all(companyId)
  return rows.map(row => ({
    id: Number(row.id),
    companyId: Number(row.company_id),
    name: row.name,
    rankOrder: row.rank_order === null ? null : Number(row.rank_order),
  }))
}

export function createJobLevel(workspace, companyId, input) {
  const db = openOrgDb(workspace)
  const company = db.prepare('SELECT id FROM company WHERE id = ?').get(companyId)
  if (company === undefined) throw new OrgError('NOT_FOUND', `company ${companyId} does not exist`)
  const result = db.prepare('INSERT INTO job_levels (company_id, name, rank_order, updated_at) VALUES (?, ?, ?, ?)')
    .run(companyId, nameOf(input), intOrNull(input?.rankOrder, 'rankOrder'), new Date().toISOString())
  return listJobLevels(workspace, companyId).find(item => item.id === Number(result.lastInsertRowid))
}

export function updateJobLevel(workspace, id, input) {
  const db = openOrgDb(workspace)
  const current = db.prepare('SELECT id, company_id FROM job_levels WHERE id = ?').get(id)
  if (current === undefined) throw new OrgError('NOT_FOUND', `job level ${id} does not exist`)
  const name = input?.name === undefined ? null : nameOf(input)
  const rank = input?.rankOrder === undefined ? null : intOrNull(input.rankOrder, 'rankOrder')
  db.prepare('UPDATE job_levels SET name = COALESCE(?, name), rank_order = ?, updated_at = ? WHERE id = ?')
    .run(name, rank, new Date().toISOString(), id)
  return listJobLevels(workspace, Number(current.company_id)).find(item => item.id === id)
}
