/**
 * Local JSON persistence for the Workbench bundle.
 *
 * Each collection is one JSON file under the configured data directory.
 * Reads are cached in memory; every mutation writes through and then
 * notifies subscribers so an open panel refreshes itself.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

// `ledger` stays for an older shape of the data; finance writes its own rows so
// a statement import cannot collide with whatever the ledger collection held.
const COLLECTIONS = [
  'staff',
  'ledger',
  'deliveries',
  'financeConfig',
  'financeImports',
  'financeTransactions',
]

export function createStore(dataDir) {
  /** @type {Map<string, any[]>} */
  const cache = new Map()
  /** @type {Set<() => void>} */
  const listeners = new Set()
  let ready = null

  const file = name => join(dataDir, `${name}.json`)

  async function load(name) {
    if (cache.has(name)) return cache.get(name)
    try {
      const text = await readFile(file(name), 'utf8')
      const parsed = JSON.parse(text)
      const rows = Array.isArray(parsed) ? parsed : []
      cache.set(name, rows)
      return rows
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const rows = []
        cache.set(name, rows)
        return rows
      }
      if (err instanceof SyntaxError) {
        // A truncated or hand-edited collection is not an empty one. Treating
        // it as empty would persist that lie over the user's data on the next
        // write, so move the file aside and fail loudly instead.
        const backup = `${file(name)}.corrupt-${Date.now()}`
        await rename(file(name), backup).catch(() => {})
        throw new Error(`collection ${name} is corrupt; moved to ${backup}`)
      }
      throw err
    }
  }

  function notify() {
    for (const fn of [...listeners]) {
      try {
        fn()
      } catch {
        /* a broken subscriber must not break a write */
      }
    }
  }

  async function persist(name) {
    const rows = cache.get(name) ?? []
    // A per-write temp name: two persists of the same collection can overlap
    // (a background run finishing during teardown), and a shared `.tmp` path
    // makes the second rename fail with ENOENT — a flaky test, not a data bug.
    const tmp = `${file(name)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}.tmp`
    const body = `${JSON.stringify(rows, null, 2)}\n`
    // A late write (a background run finishing after its directory was
    // cleaned up) must not turn into an unhandled crash: recreate, retry once.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(tmp, body, 'utf8')
        await rename(tmp, file(name))
        notify()
        return
      } catch (error) {
        if (attempt === 1) throw error
        await mkdir(dataDir, { recursive: true }).catch(() => {})
      }
    }
  }

  async function ensure() {
    await mkdir(dataDir, { recursive: true })
    await Promise.all(COLLECTIONS.map(name => load(name)))
  }

  const store = {
    /** Serialized so concurrent callers share one initialisation. */
    init() {
      // A failed load (a corrupt collection) must not poison the instance
      // forever: the bad file is moved aside, so the next call can retry.
      ready ??= ensure().catch(error => {
        ready = null
        throw error
      })
      return ready
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    async list(name) {
      await store.init()
      return [...(await load(name))]
    },

    async add(name, row) {
      await store.init()
      const rows = await load(name)
      const record = { id: row.id ?? `${name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, ...row }
      rows.push(record)
      await persist(name)
      return record
    },

    /**
     * Append many rows with one write.
     *
     * A bank statement is thousands of lines: `add()` in a loop would rewrite
     * the whole JSON file once per row, which turns a 3k-line import into a
     * multi-second stall. One persist keeps it linear.
     */
    async addMany(name, newRows) {
      await store.init()
      const rows = await load(name)
      const records = newRows.map(row => ({
        id: row.id ?? `${name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        ...row,
      }))
      rows.push(...records)
      if (records.length > 0) await persist(name)
      return records
    },

    async update(name, id, patch) {
      await store.init()
      const rows = await load(name)
      const index = rows.findIndex(r => r.id === id)
      if (index < 0) return undefined
      rows[index] = { ...rows[index], ...patch, id }
      await persist(name)
      return rows[index]
    },

    async remove(name, id) {
      await store.init()
      const rows = await load(name)
      const index = rows.findIndex(r => r.id === id)
      if (index < 0) return false
      rows.splice(index, 1)
      await persist(name)
      return true
    },

    /** Test seam: forgets cached rows without touching disk. */
    reset() {
      cache.clear()
    },
  }

  return store
}