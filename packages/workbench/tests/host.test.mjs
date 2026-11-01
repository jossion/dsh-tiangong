import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, STATE_PATH } from '../index.js'

/**
 * A minimal stand-in for the Cordis context.
 *
 * `webServer` arrives through `inject`, exactly like the real loader does it,
 * so this test reproduces the bug the plugin shipped with: reading
 * `ctx.get('webServer')` during `apply` returns nothing, the mount is skipped
 * silently, and the panel then 404s on every fetch.
 */
function fakeContext({ withWebServer = true } = {}) {
  const routes = []
  const tools = []
  const disposers = []

  const webCtx = {
    get(name) {
      if (name !== 'webServer') return undefined
      if (!withWebServer) return undefined
      return {
        register(route) {
          routes.push(route)
          return () => {
            const index = routes.indexOf(route)
            if (index >= 0) routes.splice(index, 1)
          }
        },
      }
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }

  const ctx = {
    // A one-shot read during apply must find nothing, like the real thing.
    get() {
      throw new Error('cannot get property "webServer" without inject')
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer'], 'the route must ride a webServer sub-fiber')
      return callback(webCtx)
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    logger: { warn() {} },
  }

  return { ctx, routes, tools, disposers }
}

function fakeResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body
    },
  }
}

async function withDataDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-host-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the host mounts exactly one read-only route', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    assert.equal(routes.length, 1)
    assert.equal(routes[0].kind, 'exact')
    assert.equal(routes[0].path, STATE_PATH)
    assert.equal(STATE_PATH, '/workbench/state')
    assert.equal(typeof routes[0].handler, 'function')
  })
})

test('an empty log projects to zeroes rather than NaN', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    const response = fakeResponse()
    await routes[0].handler({ method: 'GET' }, response)

    assert.equal(response.status, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.summary.decisions, 0)
    assert.equal(payload.summary.spentUsd, 0)
    assert.deepEqual(payload.events, [])
    assert.deepEqual(payload.summary.lanes.split, { code: 0, frontier: 0, human: 0 })
  })
})

test('the route is read-only: writes are refused', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })

    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = fakeResponse()
      await routes[0].handler({ method }, response)
      assert.equal(response.status, 405, `${method} must not be accepted`)
      assert.equal(JSON.parse(response.body).error.code, 'method-not-allowed')
    }
  })
})

test('a headless profile keeps the tools and skips the route', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes, tools } = fakeContext({ withWebServer: false })
    assert.doesNotThrow(() => apply(ctx, { dataDir }), 'no web server must not break activation')
    assert.equal(routes.length, 0)
    assert.equal(tools.length, 1, 'the agent tool still registers')
    assert.equal(tools[0].name, 'workbench_plan_software')
  })
})

test('the route disappears when the plugin is disposed', async () => {
  await withDataDir(async dataDir => {
    const { ctx, routes } = fakeContext()
    apply(ctx, { dataDir })
    assert.equal(routes.length, 1)

    const route = routes[0]
    const response = fakeResponse()
    await route.handler({ method: 'GET' }, response)
    assert.equal(response.status, 200)
  })
})
