import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStore } from '../store.js'

const withDir = async fn => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-store-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a missing collection reads as empty; a written one survives a reload', async () => {
  await withDir(async dir => {
    const store = createStore(dir)
    assert.deepEqual(await store.list('staff'), [])
    await store.add('staff', { id: 'e1', name: '张三' })

    const reopened = createStore(dir)
    const rows = await reopened.list('staff')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].name, '张三')
  })
})

test('a corrupt collection is moved aside, never overwritten', async () => {
  await withDir(async dir => {
    const path = join(dir, 'staff.json')
    await writeFile(path, '[{"id":"e1"', 'utf8') // truncated JSON

    const store = createStore(dir)
    await assert.rejects(() => store.list('staff'), /is corrupt; moved to/)
    await assert.rejects(() => stat(path), { code: 'ENOENT' }, 'the bad file leaves its own name')

    const { readdir } = await import('node:fs/promises')
    const files = await readdir(dir)
    const backup = files.find(name => name.startsWith('staff.json.corrupt-'))
    assert.ok(backup !== undefined, 'the original bytes are preserved in a backup')
    assert.match(await readFile(join(dir, backup), 'utf8'), /\[\{"id":"e1"/)

    // A later write starts a fresh collection instead of destroying the backup.
    await store.add('staff', { id: 'e2' })
    assert.equal((await createStore(dir).list('staff')).length, 1)
  })
})
