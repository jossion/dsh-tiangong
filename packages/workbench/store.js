/**
 * Local JSON persistence for the Workbench bundle.
 *
 * Each collection is one JSON file under the configured data directory.
 * Reads are cached in memory; every mutation writes through and then
 * notifies subscribers so an open panel refreshes itself.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

const COLLECTIONS = ['staff', 'ledger', 'deliveries']

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
      if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) {
        const rows = []
        cache.set(name, rows)
        return rows
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
    const tmp = `${file(name)}.tmp`
    await writeFile(tmp, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
    await rename(tmp, file(name))
    notify()
  }

  async function ensure() {
    await mkdir(dataDir, { recursive: true })
    await Promise.all(COLLECTIONS.map(name => load(name)))
  }

  const store = {
    /** Serialized so concurrent callers share one initialisation. */
    init() {
      ready ??= ensure()
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