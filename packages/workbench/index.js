/**
 * Host half of the Workbench bundle.
 *
 * Two domains:
 *  - operations: staff directory and finance ledger, persisted as local JSON
 *  - delivery:   requirement-driven software planning runs
 *
 * Plus the decision log both of them write into: every judgement the delivery
 * workflow makes becomes one line in `events.jsonl`, and the panel is a
 * projection of that file. The panel reads it over one read-only host route,
 * so the browser never keeps its own copy of the data.
 *
 * Everything registered here is owned by this plugin's context, so unloading
 * the plugin removes it. Optional services are resolved lazily so the plugin
 * still activates in a profile that lacks them.
 */
import { homedir } from 'node:os'
import { dirname, join, isAbsolute } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'
import { createStore } from './store.js'
import { createDelivery } from './delivery.js'
import { createEventLog } from './events.js'

export const inject = ['llm', 'tools']

/**
 * TEMPORARY activation canary. The host half has never shown a single trace of
 * running, so every step of activation appends one line here until we know
 * exactly where it stops. Remove once the route is confirmed live.
 */
const BOOT_LOG = join(homedir(), '.dsh', 'workbench', 'boot.log')
function canary(line) {
  try {
    mkdirSync(dirname(BOOT_LOG), { recursive: true })
    appendFileSync(BOOT_LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* diagnostics must never break activation */
  }
}
canary('--- module imported ---')

const DEFAULTS = {
  dataDir: '',
  provider: 'deepseek',
  model: 'deepseek-chat',
}

/** The panel reads this. GET only: nothing reachable here starts work. */
export const STATE_PATH = '/workbench/state'

function resolveDataDir(configured) {
  if (configured) return configured
  return join(homedir(), '.dsh', 'workbench')
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

export function apply(ctx, row) {
  canary(`apply() entered | inject=${JSON.stringify(inject)}`
    + ` | ctx.inject=${typeof ctx.inject} ctx.effect=${typeof ctx.effect}`
    + ` ctx.get=${typeof ctx.get} ctx.on=${typeof ctx.on} ctx.tools=${typeof ctx.tools}`)
  try {
  const config = { ...DEFAULTS, ...(row ?? {}) }
  if (!isAbsolute(config.dataDir)) {
    config.dataDir = resolveDataDir(config.dataDir)
  }

  const store = createStore(config.dataDir)
  const events = createEventLog(join(config.dataDir, 'events.jsonl'))

  // A decision sink that never lets an audit failure abort a run: losing one
  // log line is bad, losing the delivery is worse.
  const recordDecision = event => events.append(event).catch(error => {
    try {
      ctx.logger?.warn?.('[workbench] could not record decision', error)
    } catch {
      /* logging is best-effort too */
    }
    return null
  })

  const delivery = createDelivery({ ctx, config, store, onDecision: recordDecision })

  // Cordis contexts only expose declared keys, so the store, event log and
  // delivery runner stay module-local; the tool and the route below are the
  // plugin's public surface.

  // Read-only state route for the panel.
  let mounted = false
  const route = {
    kind: 'exact',
    path: STATE_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: { code: 'method-not-allowed' } })
        return
      }
      try {
        const summary = await events.summary()
        const recent = await events.tail(30)
        sendJson(response, 200, { summary, events: recent.reverse() })
      } catch (error) {
        sendJson(response, 500, {
          error: { code: 'state-unavailable', message: String(error?.message ?? error) },
        })
      }
    },
  }

  function mount(webServer, source) {
    if (mounted) return () => {}
    if (!webServer || typeof webServer.register !== 'function') {
      canary(`mount(${source}): no usable webServer`)
      return () => {}
    }
    try {
      const dispose = webServer.register(route)
      mounted = true
      canary(`mount(${source}): ROUTE REGISTERED ${STATE_PATH}`)
      return () => {
        mounted = false
        try { dispose?.() } catch { /* withdrawn */ }
      }
    } catch (error) {
      canary(`mount(${source}): THREW ${error?.stack ?? error}`)
      return () => {}
    }
  }

  try {
    const early = ctx.get('webServer')
    canary(`apply-time ctx.get('webServer') -> ${early === undefined ? 'undefined' : typeof early}`)
    if (early !== undefined) ctx.effect(() => mount(early, 'apply-time'))
  } catch (error) {
    canary(`apply-time ctx.get threw: ${error?.message ?? error}`)
  }

  try {
    ctx.inject(['webServer'], webCtx => {
      canary('inject callback FIRED')
      webCtx.effect(() => {
        canary(`inject effect running | webCtx.get=${typeof webCtx.get}`)
        let server
        try {
          server = webCtx.get('webServer')
        } catch (error) {
          canary(`inject inner get threw: ${error?.message ?? error}`)
          return () => {}
        }
        return mount(server, 'inject')
      }, 'workbench: state route')
    })
    canary('ctx.inject() returned')
  } catch (error) {
    canary(`ctx.inject threw: ${error?.stack ?? error}`)
  }

  // One tool so the agent can drive delivery from an ordinary conversation,
  // which is how a non-technical owner will actually reach it.
  //
  // `output` is not optional: without it `ctx.tools.register` throws and the
  // whole plugin fails to activate — which is exactly why this plugin never
  // came up between its install and today.
  ctx.effect(() =>
    ctx.tools.register({
      name: 'workbench_plan_software',
      description:
        'Plan a small software system from a plain-language requirement. Produces a role and '
        + 'permission matrix, a data model, an API surface, and an ordered list of build tasks, '
        + 'written to disk as JSON artefacts. Use this when the user describes a system they want '
        + 'built. This plans; it does not write application code.',
      parameters: {
        type: 'object',
        properties: {
          requirement: {
            type: 'string',
            description: 'What the user wants, in their own words, including who will use it.',
          },
        },
        required: ['requirement'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(input) {
        const brief = String(input.requirement ?? '').trim()
        if (!brief) throw new Error('requirement must not be empty')
        const result = await delivery.run({ brief })
        return [
          `Planned: ${brief}`,
          `Roles: ${result.roles?.roles?.length ?? 0}`,
          `Work items: ${result.design?.workItems?.length ?? 0}`,
          `Artefacts: ${result.artifactDir ?? config.dataDir}`,
        ].join('\n')
      },
    }),
  )

  } catch (error) {
    canary(`apply() THREW: ${error?.stack ?? error}`)
    throw error
  }
}
