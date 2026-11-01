/**
 * Append-only decision log.
 *
 * One JSON object per line under `<dataDir>/events.jsonl`. The file is the
 * source of truth: every number the panel shows is a projection of these
 * lines, never state remembered only in memory. A run that is interrupted
 * still leaves its decisions behind, which is the whole point — an agent's
 * judgement has to be auditable after the fact.
 *
 * Appends are serialized through a single promise chain so two concurrent
 * runs cannot interleave a partial line.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Lane order is also the left-to-right order the panel draws them in. */
export const LANES = ['code', 'frontier', 'human']

/** The panel's confidence strip shows this many recent decisions. */
export const CONFIDENCE_WINDOW = 40

/**
 * Defensive parse: a truncated last line (power loss) or a hand-edited file
 * must degrade to "fewer events", never to a crashed panel.
 */
export function parseLines(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const value = JSON.parse(trimmed)
      if (value && typeof value === 'object' && !Array.isArray(value)) out.push(value)
    } catch {
      /* skip the unparsable line, keep the rest */
    }
  }
  return out
}

/**
 * Aggregates one event list into the shape the panel renders.
 * Pure, so it is tested against fixtures instead of a live server.
 */
export function summarize(events) {
  const list = Array.isArray(events) ? events : []
  const laneCounts = { code: 0, frontier: 0, human: 0 }
  const forks = new Set()
  const held = []
  let spentUsd = 0

  for (const event of list) {
    if (typeof event.decision === 'string') forks.add(event.decision)
    if (typeof event.lane === 'string') {
      laneCounts[event.lane] = (laneCounts[event.lane] ?? 0) + 1
    }
    const cost = Number(event.costUsd)
    if (Number.isFinite(cost) && cost > 0) spentUsd += cost
    if (event.lane === 'human' && event.status === 'waiting') held.push(event)
  }

  const total = list.length
  const share = n => (total === 0 ? 0 : Math.round((n / total) * 100))
  const code = laneCounts.code ?? 0
  const frontier = laneCounts.frontier ?? 0
  const human = laneCounts.human ?? 0

  return {
    forks: forks.size,
    decisions: total,
    held: held.length,
    spentUsd: Number(spentUsd.toFixed(4)),
    perDecisionUsd: total === 0 ? 0 : Number((spentUsd / total).toFixed(6)),
    lanes: { counts: laneCounts, split: { code: share(code), frontier: share(frontier), human: share(human) } },
    confidence: list
      .filter(event => Number.isFinite(Number(event.confidence)))
      .slice(-CONFIDENCE_WINDOW)
      .map(event => ({ seq: event.seq, confidence: Number(event.confidence) })),
    recent: list.slice(-14).reverse(),
    waiting: held.slice(-10).reverse(),
  }
}

/**
 * @param {string} filePath absolute path to `events.jsonl`
 * @param {{clock?: () => string, idFactory?: () => string}} [options]
 */
export function createEventLog(filePath, options = {}) {
  const clock = options.clock ?? (() => new Date().toISOString())
  const idFactory = options.idFactory ?? (() => {
    const random = Math.random().toString(36).slice(2, 8)
    return `ev_${Date.now().toString(36)}_${random}`
  })

  /** @type {object[] | null} */
  let cache = null
  const listeners = new Set()
  let queue = Promise.resolve()
  let ready = null

  async function load() {
    if (cache) return cache
    try {
      cache = parseLines(await readFile(filePath, 'utf8'))
      cache.forEach((event, index) => {
        if (!Number.isInteger(event.seq)) event.seq = index
      })
    } catch (error) {
      if (error && error.code === 'ENOENT') cache = []
      else throw error
    }
    return cache
  }

  function notify() {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        /* a broken subscriber must not break a write */
      }
    }
  }

  const log = {
    path: filePath,

    /** Shared so concurrent callers initialise the cache once. */
    init() {
      ready ??= mkdir(dirname(filePath), { recursive: true }).then(load)
      return ready
    },

    /** Records one decision. Returns the stored record. */
    async append(record) {
      await log.init()
      const stored = {
        id: record.id ?? idFactory(),
        seq: cache.length,
        ts: record.ts ?? clock(),
        ...record,
      }
      stored.seq = cache.length
      const line = `${JSON.stringify(stored)}\n`
      cache.push(stored)
      // Chain the write so two appends cannot interleave inside one line.
      queue = queue.then(() => appendFile(filePath, line, 'utf8'))
      await queue
      notify()
      return stored
    },

    async all() {
      await log.init()
      return [...cache]
    },

    async tail(count) {
      await log.init()
      const n = Number.isInteger(count) && count > 0 ? count : 20
      return cache.slice(-n)
    },

    async summary() {
      await log.init()
      return summarize(cache)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Test seam: forgets cached rows without touching disk. */
    reset() {
      cache = null
      ready = null
    },
  }

  return log
}
