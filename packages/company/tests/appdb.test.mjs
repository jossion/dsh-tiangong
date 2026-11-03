import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { closeAppDb, createEmployee, listEmployees, openAppDb, updateEmployee } from '../appdb.js'

/** The schema a delivered app shipped before employees gained org links. */
const LEGACY_EMPLOYEES = `
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phone TEXT,
  department TEXT,
  job_title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  hired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_employees_status ON employees(status);
`

test('an employee table that predates the org link is migrated in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-appdb-'))
  const workspace = join(dir, 'app')
  try {
    mkdirSync(join(workspace, 'web', 'data'), { recursive: true })
    const path = join(workspace, 'web', 'data', 'app.sqlite')
    const seed = new DatabaseSync(path)
    seed.exec(LEGACY_EMPLOYEES)
    seed.prepare('INSERT INTO employees (name, email) VALUES (?, ?)').run('张三', 'zhang@example.com')
    seed.close()

    // This used to throw `no such column: company_id` while creating indexes.
    const db = openAppDb(workspace)
    const columns = db.prepare('PRAGMA table_info(employees)').all().map(column => column.name)
    assert.ok(columns.includes('company_id'))
    assert.ok(columns.includes('department_id'))

    const page = listEmployees(workspace, {})
    assert.equal(page.total, 1)
    assert.equal(page.rows[0].name, '张三')
    assert.equal(page.rows[0].companyId, null)

    const company = db.prepare('PRAGMA table_info(company)').all()
    assert.ok(company.length > 0, 'org tables exist beside the legacy employee table')
  } finally {
    closeAppDb(workspace)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an update accepts a row-shaped patch but still rejects truly unknown keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-appdb-'))
  const workspace = join(dir, 'app')
  try {
    const created = createEmployee(workspace, { name: '李四', email: 'li@example.com' })
    assert.equal(created.name, '李四')

    // The edit dialog used to echo the whole row back, including display and
    // bookkeeping columns; that must not fail the save.
    const updated = updateEmployee(workspace, created.id, {
      ...created,
      companyName: '示例文化传播有限公司',
      departmentName: '董事会',
      name: '李四改',
    })
    assert.equal(updated.name, '李四改')
    assert.equal(updated.companyName, null, 'display columns stay derived, never stored')

    assert.throws(
      () => updateEmployee(workspace, created.id, { name: '李四改二', totallyUnknown: 1 }),
      error => error.code === 'VALIDATION_ERROR' && /unknown field/.test(error.message),
    )
  } finally {
    closeAppDb(workspace)
    rmSync(dir, { recursive: true, force: true })
  }
})
