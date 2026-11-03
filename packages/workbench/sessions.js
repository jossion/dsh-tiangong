/**
 * The bridge to DSH's session/agent layer.
 *
 * The loop needs two operations from the host: make sure a delivery project has
 * one dedicated session whose agent plans and dispatches, and wake that agent
 * with one message. Both are feature-detected: a headless profile without
 * sessions/agents keeps the board and the ledger working, it just stops
 * auto-driving and reports why.
 *
 * Message shape follows the host's own `user/message` event
 * (`{ id, role: 'user', content: [{type:'text'}], source: {kind:'user'} }`), so
 * the wake reads like a user message in the transcript. If the host exposes
 * `createUserMessage` we prefer it.
 */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Minimal UserMessage the Session log accepts as a user/message event. */
export function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text) }],
    source: { kind: 'user' },
  }
}

export function createSessionBridge({ ctx, config, events, now = Date.now }) {
  const optional = name => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  const dataDir = () => config.dataDir
  const appsRoot = () => (typeof config.appsRoot === 'string' && config.appsRoot.trim() !== ''
    ? config.appsRoot.trim()
    : join(dataDir(), 'apps'))

  /** The workspace a new project's app is scaffolded into. */
  function appRootFor(project) {
    return project?.workspace ?? join(appsRoot(), project?.id ?? 'app')
  }

  async function ensureWorkspace(project) {
    const path = appRootFor(project)
    try {
      await mkdir(path, { recursive: true })
    } catch {
      /* a real failure surfaces from the registry/agent call below */
    }
    let workspaceId = project?.workspaceId ?? null
    if (workspaceId === null || workspaceId === undefined) {
      const registry = optional('workspaceRegistry')
      if (registry && typeof registry.create === 'function') {
        try {
          const created = await registry.create(path, project?.title ?? project?.id)
          workspaceId = created?.id ?? null
        } catch {
          // A previous attempt may already have registered this path (the
          // session creation failed afterwards); reuse it instead of failing.
          if (typeof registry.resolveByPath === 'function') {
            try {
              const existing = await registry.resolveByPath(path)
              workspaceId = existing?.id ?? null
            } catch {
              workspaceId = null
            }
          }
        }
      }
    }
    return { path, workspaceId }
  }

  async function resolveAgent(sessionId) {
    const agents = optional('agents')
    if (agents === undefined || agents === null) return null
    const live = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
    if (live !== undefined) return live
    if (typeof agents.resume === 'function') {
      try {
        const handle = await agents.resume({ resumeSessionId: sessionId })
        return handle?.agent ?? null
      } catch {
        return null
      }
    }
    return null
  }

  async function buildMessage(text) {
    try {
      // The host ships this helper; the loader resolves host packages for
      // plugins. If it is unavailable, the hand-built message has the same
      // shape as a persisted user/message event.
      const llm = await import('@deepseek-ai/dsh-llm')
      if (llm !== null && typeof llm.createUserMessage === 'function') {
        return llm.createUserMessage({ content: [{ type: 'text', text: String(text) }], source: { kind: 'user' } })
      }
    } catch {
      /* fall through */
    }
    return userMessage(text)
  }

  /**
   * Wake the delivery agent with one user message.
   * `ok:false` is a normal outcome (no session/agent mounted); the dispatcher
   * turns it into a human gate instead of retrying forever.
   */
  async function wake(sessionId, text) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      return { ok: false, error: 'no session bound' }
    }
    // The sanctioned path: the session controller resumes the Agent for us and
    // admits the prompt through the same door the panel uses. It also mounts
    // the deployment preset, which a raw followup on a hand-built agent lacks.
    const controller = optional('sessionController')
    if (controller !== null && controller !== undefined && typeof controller.prompt === 'function') {
      try {
        const receipt = await controller.prompt({
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: String(text) }],
        })
        if (receipt?.accepted === true) return { ok: true, via: 'session-controller' }
      } catch {
        /* fall through to the followup path */
      }
    }
    const agent = await resolveAgent(sessionId)
    if (agent === null) return { ok: false, error: 'no live agent for this session' }
    if (typeof agent.followup !== 'function') return { ok: false, error: 'agent does not accept followup' }
    let message
    try {
      message = await buildMessage(text)
    } catch (error) {
      return { ok: false, error: `could not build message: ${String(error?.message ?? error)}` }
    }
    try {
      agent.followup(message)
    } catch (error) {
      return { ok: false, error: `followup failed: ${String(error?.message ?? error)}` }
    }
    // Persist the accepted turn before the next tick observes the session.
    const sessions = optional('sessions')
    if (sessions && typeof sessions.flush === 'function' && agent.session !== undefined) {
      try {
        await sessions.flush(agent.session)
      } catch {
        /* the turn is queued; a flush failure must not undo the wake */
      }
    }
    return { ok: true, agentId: agent.id ?? null }
  }

  /**
   * One dedicated session per project. Created lazily on the first requirement;
   * a project that already has one reuses it across every job.
   */
  async function ensureProjectSession(project) {
    if (typeof project?.sessionId === 'string' && project.sessionId !== '') {
      return { ok: true, sessionId: project.sessionId, workspace: project.workspace ?? null, created: false }
    }
    const { path, workspaceId } = await ensureWorkspace(project)
    const preset = typeof config.agentPreset === 'string' && config.agentPreset.trim() !== ''
      ? config.agentPreset.trim()
      : 'standard'
    const controller = optional('sessionController')
    if (controller !== null && controller !== undefined && typeof controller.create === 'function') {
      // session.create accepts workspaceId OR cwd, never both.
      const request = { agentPreset: preset }
      if (typeof workspaceId === 'string' && workspaceId !== '') request.workspaceId = workspaceId
      else request.cwd = path
      try {
        const created = await controller.create(request)
        if (typeof created?.sessionId === 'string' && created.sessionId !== '') {
          return { ok: true, sessionId: created.sessionId, workspace: path, workspaceId, created: true, agentPreset: created.agentPreset ?? preset }
        }
        throw new Error('session create returned no id')
      } catch (error) {
        return { ok: false, error: `session create failed: ${String(error?.message ?? error)}`, workspace: path, workspaceId }
      }
    }

    // Fallback for a host without the session controller: the agent factory
    // creates the agent and its session, but the preset has to be mounted by us
    // or the prompt assembly has no deployment variables (observed as
    // "prompt variable {{model}} has no value").
    const agents = optional('agents')
    if (agents === undefined || agents === null || typeof agents.create !== 'function') {
      return { ok: false, error: 'session controller and agents service unavailable', workspace: path, workspaceId }
    }
    const sessionId = `session-${randomUUID()}`
    const options = { sessionId, meta: { cwd: path, agentPreset: preset } }
    const presets = optional('agentPresets')
    if (presets !== null && presets !== undefined && typeof presets.mount === 'function') {
      options.setup = async agentCtx => {
        const resolved = typeof presets.resolve === 'function' ? await presets.resolve(preset) : { id: preset }
        await presets.mount(agentCtx, resolved?.id ?? preset)
      }
    }
    try {
      const handle = await agents.create(options)
      if (handle === undefined || handle === null) throw new Error('agent create returned nothing')
    } catch (error) {
      return { ok: false, error: `agent create failed: ${String(error?.message ?? error)}`, sessionId, workspace: path, workspaceId }
    }
    return { ok: true, sessionId, workspace: path, workspaceId, created: true, agentPreset: preset }
  }

  return { ensureProjectSession, ensureWorkspace, wake, resolveAgent, appRootFor }
}
