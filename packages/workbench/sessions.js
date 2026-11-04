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
import { foldUsage } from './usage.js'
import { resolveProjectProfile, toolFilterFor } from './profiles.js'

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

  /** Sessions this process already ensured a model/preset for. */
  const modelSelected = new Set()
  const presetSelected = new Set()
  const policyApplied = new Set()

  /** A project's capability profile (type plus preset plus global-tool mask). */
  const profileOf = project => project?.profile ?? resolveProjectProfile(project?.projectKind ?? 'custom')

  /**
   * Mask the deployment's global tool families for one delivery session.
   *
   * A preset composition cannot remove a tool another plugin registered
   * globally (Blender, ComfyUI, computer-use, the bot/team surface), so a
   * project type needs this second lever. `tools.restrict` is scoped to the
   * calling agent: it must run on the agent's own context, and only names this
   * deployment actually registered may be denied.
   */
  async function applyToolPolicy(project, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      return { ok: false, applied: false, error: 'no session bound' }
    }
    if (policyApplied.has(sessionId)) return { ok: true, applied: true, cached: true }
    const profile = profileOf(project)
    if (profile.tools === null || profile.tools === undefined) {
      policyApplied.add(sessionId)
      return { ok: true, applied: false, reason: 'profile has no tool policy' }
    }
    const agent = await resolveAgent(sessionId)
    const ctx = agent !== null && agent !== undefined ? agent.ctx : undefined
    const tools = ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get('tools') : undefined
    if (tools === null || tools === undefined || typeof tools.schemas !== 'function' || typeof tools.restrict !== 'function') {
      return { ok: false, applied: false, error: 'agent tool scope unavailable' }
    }
    let schemas = []
    try { schemas = tools.schemas() } catch { schemas = [] }
    const filter = toolFilterFor(profile, (Array.isArray(schemas) ? schemas : []).map(schema => schema?.name))
    if (filter === null) {
      policyApplied.add(sessionId)
      return { ok: true, applied: false, denied: [] }
    }
    try {
      tools.restrict(filter)
      policyApplied.add(sessionId)
      return { ok: true, applied: true, denied: filter.deny }
    } catch (error) {
      return { ok: false, applied: false, error: String(error?.message ?? error) }
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
   * Mount the deployment's default agent preset on a Session.
   *
   * `sessionController.create` records a preset name, but a turn assembled
   * without the deployment composition lacks its prompt variables (the
   * observed failure is `{{model}}`), so we mount the resolved default once.
   */
  async function ensureDefaultPreset(controller, sessionId) {
    const presets = optional('agentPresets')
    if (presets === null || presets === undefined) return null
    if (typeof presets.resolve !== 'function' || typeof presets.select !== 'function') return null
    let resolved = null
    try {
      const wanted = typeof config.agentPreset === 'string' && config.agentPreset.trim() !== ''
        ? config.agentPreset.trim()
        : undefined
      resolved = await presets.resolve(wanted)
    } catch {
      return null
    }
    const presetId = typeof resolved?.id === 'string' && resolved.id !== '' ? resolved.id : null
    if (presetId === null) return null
    let agent = null
    try {
      const result = typeof controller.resolveAgent === 'function'
        ? await controller.resolveAgent(sessionId)
        : null
      agent = result?.agent ?? null
    } catch {
      agent = null
    }
    if (agent === null) return null
    try {
      await presets.select(agent, presetId)
      return presetId
    } catch {
      return null
    }
  }

  /**
   * Select the deployment's default model on a freshly created Session.
   * A Session only receives a model when the caller installs one; a turn that
   * starts without it dies in prompt assembly ("{{model}} has no value").
   */
  async function selectDefaultModel(controller, sessionId) {
    if (controller === null || controller === undefined || typeof controller.selectModel !== 'function') {
      return { selection: null, error: 'sessionController.selectModel unavailable' }
    }
    let selection = null
    try {
      const model = optional('agentDefaultModel')
      if (model !== null && model !== undefined && typeof model.currentSelection === 'function') {
        selection = model.currentSelection()
      }
    } catch {
      selection = null
    }
    if (selection === null || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
      try {
        const catalog = typeof controller.modelCatalog === 'function' ? await controller.modelCatalog() : null
        selection = catalog?.default ?? null
      } catch {
        selection = null
      }
    }
    if (selection === null || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
      return { selection: null, error: 'no default model selection available' }
    }
    try {
      await controller.selectModel({
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
      })
      return { selection: { provider: selection.provider, model: selection.model }, error: null }
    } catch (error) {
      return { selection: null, error: String(error?.message ?? error) }
    }
  }

  /**
   * Install everything a fresh Session needs before its first turn, and report
   * every step. Swallowing these failures silently is what made the live loop
   * undiagnosable; the result is written to the ledger by the dispatcher.
   */
  async function prepare(sessionId, project = null) {
    const controller = optional('sessionController')
    const report = {
      sessionId,
      services: {
        sessionController: controller !== null && controller !== undefined,
        agentPresets: optional('agentPresets') !== null && optional('agentPresets') !== undefined,
        agentDefaultModel: optional('agentDefaultModel') !== null && optional('agentDefaultModel') !== undefined,
        agents: optional('agents') !== null && optional('agents') !== undefined,
      },
      preset: null,
      presetError: null,
      model: null,
      modelError: null,
      policy: null,
    }
    if (controller === null || controller === undefined) {
      report.presetError = 'sessionController unavailable'
      report.modelError = 'sessionController unavailable'
      return report
    }
    if (!presetSelected.has(sessionId)) {
      try {
        report.preset = await ensureDefaultPreset(controller, sessionId)
        if (report.preset === null) report.presetError = 'preset resolve/select returned nothing'
      } catch (error) {
        report.presetError = String(error?.message ?? error)
      }
      presetSelected.add(sessionId)
    }
    if (!modelSelected.has(sessionId)) {
      const result = await selectDefaultModel(controller, sessionId)
      report.model = result.selection
      report.modelError = result.error
      modelSelected.add(sessionId)
    }
    if (project !== null && project !== undefined) {
      report.policy = await applyToolPolicy(project, sessionId)
    }
    return report
  }

  /**
   * Token usage of one Session, folded from its persisted assistant messages.
   * Returns absolute totals (never a delta) so the ledger line is idempotent.
   */
  async function measureUsage(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null
    const controller = optional('sessionController')
    if (controller === null || controller === undefined || typeof controller.inspect !== 'function') return null
    try {
      const inspection = await controller.inspect(sessionId)
      return foldUsage(inspection?.events ?? [])
    } catch {
      return null
    }
  }

  /**
   * Wake the delivery agent with one user message.
   * `ok:false` is a normal outcome (no session/agent mounted); the dispatcher
   * turns it into a human gate instead of retrying forever.
   */
  async function wake(sessionId, text, options = {}) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      return { ok: false, error: 'no session bound' }
    }
    // `deliver: 'queue'` (the default) admits the message as the next turn — the
    // right shape for a fresh planning/dispatch round. `deliver: 'steer'`
    // injects it into the running turn at its next step boundary, which is the
    // only delivery mode that can stop an overrunning turn; a reminder sent as
    // 'queue' is read after the turn it was meant to shorten has already ended.
    const mode = options?.deliver === 'steer' ? 'steer' : 'queue'
    // The sanctioned path: the session controller resumes the Agent for us and
    // admits the prompt through the same door the panel uses. It also mounts
    // the deployment preset, which a raw followup on a hand-built agent lacks.
    const controller = optional('sessionController')
    if (controller !== null && controller !== undefined && typeof controller.prompt === 'function') {
      // A session created before the preset/model was installed (or created by
      // an older build of this bridge) must get both before its first turn.
      const preparation = await prepare(sessionId, options?.project ?? null)
      try {
        const receipt = await controller.prompt({
          requestId: randomUUID(),
          sessionId,
          mode,
          content: [{ type: 'text', text: String(text) }],
        })
        if (receipt?.accepted === true) return { ok: true, via: 'session-controller', preparation }
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
    // The project's capability profile chooses the persona/tool composition;
    // the deployment config is the fallback for `custom` projects (or when the
    // named preset is not installed, which resolve() reports below).
    const profile = profileOf(project)
    const preset = typeof profile?.preset === 'string' && profile.preset !== ''
      ? profile.preset
      : (typeof config.agentPreset === 'string' && config.agentPreset.trim() !== ''
        ? config.agentPreset.trim()
        : null)
    const controller = optional('sessionController')
    // Resolve the deployment default preset id so the created session is
    // composed with it from the first turn (the controller's own fallback does
    // not mount the composition in this host).
    let presetId = preset
    if (presetId === null) {
      const presets = optional('agentPresets')
      if (presets !== null && presets !== undefined && typeof presets.resolve === 'function') {
        try {
          const resolved = await presets.resolve(undefined)
          if (typeof resolved?.id === 'string' && resolved.id !== '') presetId = resolved.id
        } catch {
          presetId = null
        }
      }
    }
    if (controller !== null && controller !== undefined && typeof controller.create === 'function') {
      // session.create accepts workspaceId OR cwd, never both.
      const request = presetId === null ? {} : { agentPreset: presetId }
      if (typeof workspaceId === 'string' && workspaceId !== '') request.workspaceId = workspaceId
      else request.cwd = path
      let created
      try {
        created = await controller.create(request)
        if (typeof created?.sessionId !== 'string' || created.sessionId === '') {
          throw new Error('session create returned no id')
        }
      } catch (error) {
        return { ok: false, error: `session create failed: ${String(error?.message ?? error)}`, workspace: path, workspaceId }
      }
      // A new Session has no model selected until someone selects one; without
      // it the deployment prompt has no {{model}} value and the first turn dies.
      const selected = await selectDefaultModel(controller, created.sessionId)
      const policy = await applyToolPolicy(project, created.sessionId)
      return {
        ok: true,
        sessionId: created.sessionId,
        workspace: path,
        workspaceId,
        created: true,
        agentPreset: created.agentPreset ?? presetId,
        model: selected.selection,
        policy,
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
    const policy = await applyToolPolicy(project, sessionId)
    return { ok: true, sessionId, workspace: path, workspaceId, created: true, agentPreset: preset, policy }
  }

  return { ensureProjectSession, ensureWorkspace, wake, prepare, measureUsage, resolveAgent, appRootFor }
}
