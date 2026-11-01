/**
 * Host half of the Workbench bundle.
 *
 * Two domains:
 *  - operations: staff directory and finance ledger, persisted as local JSON
 *  - delivery:   requirement-driven software planning runs
 *
 * Everything registered here is owned by this plugin's context, so unloading
 * the plugin removes it. Optional services are resolved lazily so the plugin
 * still activates in a profile that lacks them.
 */
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { createStore } from './store.js'
import { createDelivery } from './delivery.js'

export const inject = ['llm', 'tools']

const DEFAULTS = {
  dataDir: '',
  provider: 'deepseek',
  model: 'deepseek-chat',
}

function resolveDataDir(configured) {
  if (configured) return configured
  return join(homedir(), '.dsh', 'workbench')
}

export function apply(ctx, row) {
  const config = { ...DEFAULTS, ...(row ?? {}) }
  if (!isAbsolute(config.dataDir)) {
    config.dataDir = resolveDataDir(config.dataDir)
  }

  const store = createStore(config.dataDir)

  const delivery = createDelivery({ ctx, config, store })

  // Cordis contexts only expose declared keys, so the store and delivery
  // runner stay module-local; the tool below is the plugin's public surface.

  // One tool so the agent can drive delivery from an ordinary conversation,
  // which is how a non-technical owner will actually reach it.
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
      async execute(input) {
        const brief = String(input.requirement ?? '').trim()
        if (!brief) {
          return { isError: true, output: 'requirement must not be empty' }
        }
        try {
          const result = await delivery.run({ brief })
          return {
            output: [
              `Planned: ${brief}`,
              `Roles: ${result.roles?.roles?.length ?? 0}`,
              `Work items: ${result.design?.workItems?.length ?? 0}`,
              `Artefacts: ${result.artifactDir ?? config.dataDir}`,
            ].join('\n'),
          }
        } catch (err) {
          return { isError: true, output: `delivery planning failed: ${err.message}` }
        }
      },
    }),
  )
}