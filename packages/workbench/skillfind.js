/**
 * Skill discovery for the delivery agents.
 *
 * The session's skill catalog is the first place to look: a skill already
 * present costs nothing to use. Only when nothing matches do we ask the plugin
 * market, because installing one is a host-level action a person must approve.
 *
 * The ranking is deliberately simple and explainable: a name hit outranks a
 * description hit, and every candidate says why it matched, so a wrong pick can
 * be traced to a rule instead of a model's mood.
 */

export const SKILL_LIMITS = {
  maxCandidates: 8,
  maxMarketEntries: 5,
  maxIndexes: 3,
}

/** Lowercase, split on punctuation/space, keeping CJK runs as terms. */
export function tokenize(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}

/**
 * Score one skill summary against a query.
 * Returns `{ score, why }`; score 0 means "no evidence", which the caller drops.
 */
export function scoreSkill(skill, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (q === '' || skill === null || typeof skill !== 'object') return { score: 0, why: null }

  const name = String(skill.name ?? '').toLowerCase()
  const description = String(skill.description ?? '').toLowerCase()
  const whenToUse = String(skill.whenToUse ?? '').toLowerCase()
  const why = []
  let score = 0

  if (name === q) {
    return { score: 100, why: 'name=exact' }
  }
  if (name.includes(q)) {
    score += 60
    why.push('name')
  } else if (q.includes(name) && name.length >= 3) {
    score += 30
    why.push('name~query')
  }

  const tokens = tokenize(query)
  for (const token of tokens) {
    if (name.includes(token)) {
      score += 30
      why.push(`name:${token}`)
    }
    if (whenToUse.includes(token)) {
      score += 18
      why.push(`whenToUse:${token}`)
    }
    if (description.includes(token)) {
      score += 10
      why.push(`description:${token}`)
    }
  }

  return { score, why: why.length === 0 ? null : [...new Set(why)].join(',') }
}

/**
 * Rank the session catalog. Invocation-neutral summaries are enough for the
 * agent to decide; the full body is loaded by the agent through its own skill
 * mechanism, not copied into a tool result.
 */
export function rankSkills(skills, query, { limit = SKILL_LIMITS.maxCandidates } = {}) {
  const list = Array.isArray(skills) ? skills : []
  const ranked = []
  for (const skill of list) {
    const { score, why } = scoreSkill(skill, query)
    if (score <= 0) continue
    ranked.push({
      name: String(skill.name ?? ''),
      description: String(skill.description ?? ''),
      whenToUse: skill.whenToUse === undefined ? null : String(skill.whenToUse),
      source: skill.source ?? null,
      provider: skill.provider ?? null,
      score,
      why,
    })
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const wanted = Number(limit)
  const page = Number.isFinite(wanted) && wanted > 0
    ? Math.min(SKILL_LIMITS.maxCandidates, Math.floor(wanted))
    : SKILL_LIMITS.maxCandidates
  return ranked.slice(0, page)
}

/**
 * Compare the skills a plan would like with the skills this deployment has.
 *
 * Nothing here loads or installs anything: the result only says which names are
 * present. `required` is what the requirement explicitly demands; `recommended`
 * is the project type's default list. A missing name is reported to the planner,
 * which must decide between asking a person to install it and a stated fallback.
 */
export function skillAvailability(installedNames = [], recommended = [], required = []) {
  const installed = new Set((Array.isArray(installedNames) ? installedNames : []).map(name => String(name ?? '').trim()).filter(Boolean))
  const status = list => [...new Set((Array.isArray(list) ? list : []).map(name => String(name ?? '').trim()).filter(Boolean))]
    .map(name => ({ name, installed: installed.has(name) }))
  const recommendedStatus = status(recommended)
  const requiredStatus = status(required)
  const missing = [...new Set([...recommendedStatus, ...requiredStatus].filter(item => !item.installed).map(item => item.name))]
  return { recommended: recommendedStatus, required: requiredStatus, missing }
}

/** Map one market search result page to the small shape the agent needs. */
export function marketCandidates(entries, { limit = SKILL_LIMITS.maxMarketEntries } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const wanted = Number(limit)
  const page = Number.isFinite(wanted) && wanted > 0
    ? Math.min(SKILL_LIMITS.maxMarketEntries, Math.floor(wanted))
    : SKILL_LIMITS.maxMarketEntries
  return list.slice(0, page).map(entry => ({
    name: String(entry?.name ?? ''),
    title: typeof entry?.title === 'string' ? entry.title : (entry?.title?.en ?? null),
    description: typeof entry?.description === 'string' ? entry.description : (entry?.description?.en ?? null),
    version: entry?.defaultVersion ?? null,
    installed: entry?.installation?.status ?? 'not-installed',
    installSpec: entry?.versions?.find?.(version => version.version === entry?.defaultVersion)?.install?.spec
      ?? entry?.versions?.[0]?.install?.spec
      ?? null,
  })).filter(entry => entry.name !== '')
}

/**
 * The tool result. It separates "use it now" from "install first" so the agent
 * does not try to invoke a market plugin that is not installed yet.
 */
export function formatSkillResult({ query, session = [], market = [], marketErrors = [], limitNote = null, availability = null, projectKind = null }) {
  return JSON.stringify({
    query,
    ...(projectKind === null ? {} : { projectKind }),
    sessionSkills: session,
    ...(availability === null ? {} : { availability }),
    market,
    marketErrors,
    ...(limitNote === null ? {} : { note: limitNote }),
    howToUse: [
      'Use a session skill now: load it through your normal skill mechanism before starting the work.',
      'A market entry is not installed: pass the plugin to plugin-manager install (a person approves it), then use the skill it provides.',
      ...(availability !== null && Array.isArray(availability.missing) && availability.missing.length > 0
        ? [`Missing skills: ${availability.missing.join(', ')}. If one is essential, ask the owner with ask_user before planning; otherwise state the fallback in the plan and card instructions instead of pretending to load it.`]
        : []),
      'If neither helps, continue with your own judgement and report the missing skill in workbench_report_work notes.',
    ],
  })
}
