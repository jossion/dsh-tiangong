/**
 * Project capability profiles.
 *
 * A project type is two things: the agent preset its delivery session is
 * composed with (persona plus the scoped tool surface), and a mask over the
 * tools whose plugins register *globally* (Blender, ComfyUI, computer-use,
 * the team/bot tools). A preset cannot remove a global registration, so the
 * mask is what keeps a copywriting project from paying for a 3D pipeline's
 * tool schemas on every request.
 *
 * `custom` means "deployment default": no preset override, no mask.
 */

/** The kinds the create-project wizard offers. */
export const PROJECT_KINDS = ['software', 'copy', 'custom']

/** Global tool families a delivery lead never needs. */
const HEAVY_PREFIXES = ['blender_', 'comfyui_', 'cua_driver_native', 'computer_use', 'remote_screen', 'ds_bot']

/** Team / bot tools that belong to a person, not to a delivery lead. */
const TEAM_TOOLS = [
  'spawn_teammate', 'list_agents', 'send_message', 'interrupt_agent', 'wait_agent',
  // Generic delegation names are owned by the host/agent-team bundle; the
  // workbench ships its own restricted spawn tool (workbench_spawn), so the
  // delivery lead must not see the unrestricted ones.
  'subagent', 'subagent_fork', 'workflow',
  'create_bot', 'update_bot', 'stop_bot', 'list_bots', 'message_bot',
  'create_group', 'update_group', 'delete_group', 'post_to_group', 'read_group_chat', 'group_relay',
  'attach_capability', 'detach_capability', 'save_capability', 'delete_capability', 'list_capabilities',
  'request_secret', 'list_secrets', 'remember', 'recall', 'forget',
]

/** The built-in profiles. Presets are declared in this bundle's cordis patch. */
export const DEFAULT_PROFILES = {
  software: {
    kind: 'software',
    preset: 'workbench-software',
    template: 'software',
    tools: { prefixes: HEAVY_PREFIXES, names: TEAM_TOOLS },
  },
  copy: {
    kind: 'copy',
    preset: 'workbench-copy',
    template: 'copy',
    tools: { prefixes: HEAVY_PREFIXES, names: [...TEAM_TOOLS, 'bash', 'pwsh'] },
  },
  custom: {
    kind: 'custom',
    preset: null,
    template: 'custom',
    tools: null,
  },
}

/** Unknown kinds fall back to `custom` instead of failing a live create. */
export function normalizeProjectKind(value) {
  const kind = typeof value === 'string' ? value.trim() : ''
  return PROJECT_KINDS.includes(kind) ? kind : 'custom'
}

/** The normalized profile for one kind (a copy: callers keep it in the ledger). */
export function resolveProjectProfile(kind) {
  const key = normalizeProjectKind(kind)
  const profile = DEFAULT_PROFILES[key]
  return { ...profile, tools: profile.tools === null ? null : { ...profile.tools } }
}

/**
 * Build the tool restriction for one profile against the names this deployment
 * actually registered. Wildcards do not exist in `tools.restrict` (unknown
 * names fail the call), so the mask is intersected here: only present names are
 * denied, and an empty result means "nothing to do".
 */
export function toolFilterFor(profile, availableNames = []) {
  const policy = profile?.tools
  if (!policy) return null
  const prefixes = Array.isArray(policy.prefixes) ? policy.prefixes : []
  const names = new Set(Array.isArray(policy.names) ? policy.names : [])
  const deny = []
  const seen = new Set()
  for (const name of Array.isArray(availableNames) ? availableNames : []) {
    if (typeof name !== 'string' || name === '') continue
    if (!names.has(name) && !prefixes.some(prefix => name.startsWith(prefix))) continue
    if (seen.has(name)) continue
    seen.add(name)
    deny.push(name)
  }
  return deny.length === 0 ? null : { deny }
}
