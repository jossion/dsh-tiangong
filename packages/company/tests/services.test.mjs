import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appDir, dbFile, listServices } from '../services.js'

const withWorkspace = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'workbench-services-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a project whose delivered app was removed keeps its database row only', async () => {
  await withWorkspace(async workspace => {
    mkdirSync(join(workspace, 'web', 'data'), { recursive: true })
    writeFileSync(join(workspace, 'web', 'data', 'app.sqlite'), '')
    const rows = await listServices(workspace)
    assert.deepEqual(rows.map(row => row.id), ['db'])
    assert.equal(rows[0].status, 'ready')
    assert.equal(appDir(workspace), workspace, 'no web/package.json → the app is gone')
    assert.equal(dbFile(workspace), join(workspace, 'web', 'data', 'app.sqlite'))
  })
})

test('a project that still ships an app lists the server it can start', async () => {
  await withWorkspace(async workspace => {
    mkdirSync(join(workspace, 'web', 'data'), { recursive: true })
    writeFileSync(join(workspace, 'web', 'package.json'), '{"scripts":{"start":"next start"}}')
    const rows = await listServices(workspace)
    assert.deepEqual(rows.map(row => row.id), ['db', 'web'])
    assert.equal(rows[1].controls, true)
    assert.ok(['running', 'stopped'].includes(rows[1].status))
  })
})
