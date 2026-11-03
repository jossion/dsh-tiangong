/**
 * Services a project depends on, and their lifecycle.
 *
 * Two kinds today:
 *   db   — the app's SQLite file. Always local; status is "file ready" or not.
 *   web  — the app's HTTP server. Optional for the panel (it reads the file
 *          directly), but useful when someone wants the standalone app.
 *
 * Managed children are tracked here so a restart cannot leave an orphan
 * server on a port: `disposeAll()` runs when the plugin is disposed.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_PORT = Number(process.env.WORKBENCH_APP_PORT ?? 4321)

/** projectId → { child, port, url, startedAt, output } */
const managed = new Map()

export function appDir(workspace) {
  const web = join(workspace, 'web')
  return existsSync(join(web, 'package.json')) ? web : workspace
}

export function dbFile(workspace) {
  return join(workspace, 'web', 'data', 'app.sqlite')
}

async function probe(url, timeout = 1200) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return response.status < 500
  } catch {
    return false
  }
}

function tail(entry) {
  return entry.output.slice(-12).join('\n')
}

export async function listServices(workspace) {
  const port = DEFAULT_PORT
  const url = `http://127.0.0.1:${port}`
  const running = managed.get(workspace)
  const reachable = await probe(url)
  return [
    {
      id: 'db',
      label: '数据库',
      kind: 'file',
      status: existsSync(dbFile(workspace)) ? 'ready' : 'missing',
      detail: dbFile(workspace),
      controls: false,
    },
    {
      id: 'web',
      label: '应用服务',
      kind: 'server',
      status: reachable ? 'running' : 'stopped',
      detail: reachable ? (running ? url : `${url}（外部进程）`) : (running ? tail(running) : '未启动'),
      port,
      controls: true,
      managed: running !== undefined,
    },
  ]
}

/** Start the app server if it is not already answering. Idempotent. */
export async function startService(workspace, projectId, serviceId) {
  if (serviceId !== 'web') throw new ServiceError('BAD_REQUEST', `service ${serviceId} cannot be started`)
  const dir = appDir(workspace)
  if (!existsSync(join(dir, 'package.json'))) {
    throw new ServiceError('NO_APP', `${dir} has no package.json`)
  }
  const port = DEFAULT_PORT
  const url = `http://127.0.0.1:${port}`
  if (await probe(url)) return { status: 'running', detail: url }

  const child = spawn('npm', ['run', 'start', '--', '-p', String(port)], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const entry = { child, port, url, startedAt: Date.now(), output: [] }
  managed.set(workspace, entry)
  const collect = chunk => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() !== '') entry.output.push(line.trim())
    }
    if (entry.output.length > 40) entry.output.splice(0, entry.output.length - 40)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.on('exit', () => {
    entry.exited = true
  })

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (await probe(url)) return { status: 'running', detail: url }
    if (entry.exited) {
      managed.delete(workspace)
      throw new ServiceError('START_FAILED', tail(entry) || 'the app exited before answering')
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  await stopService(workspace)
  throw new ServiceError('START_TIMEOUT', tail(entry) || `no answer on ${url} after 20s`)
}

export async function stopService(workspace) {
  const entry = managed.get(workspace)
  if (entry === undefined) return { status: 'stopped', detail: 'not managed by the workbench' }
  managed.delete(workspace)
  try {
    entry.child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
  return { status: 'stopped', detail: `stopped on ${entry.port}` }
}

export function disposeAll() {
  for (const [workspace] of managed) {
    stopService(workspace).catch(() => {})
  }
  managed.clear()
}

export class ServiceError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
