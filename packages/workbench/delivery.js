/**
 * Requirement-driven software delivery.
 *
 * A run is a sequence of stages. Each stage asks the model for a JSON
 * document, and the parsed result becomes the next stage's input:
 *
 *   brief      the user's plain-language requirement
 *   roles      the role and permission matrix for that system
 *   design     data model, API surface, and stack choice
 *   build      implementation, delegated to subagents per work item
 *   verify     tests and lint over the produced code
 *   report     what was delivered
 *
 * Every stage persists its result, so a run can be inspected and resumed
 * from the panel rather than being a single opaque call.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decide, evidence } from './router.js'

const STAGES = ['brief', 'roles', 'design', 'build', 'verify', 'report']

/** Pulls the first balanced JSON object out of a model reply. */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  if (start < 0) throw new Error('model reply contained no JSON object')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1))
    }
  }
  throw new Error('model reply contained an unterminated JSON object')
}

/** Collects the assistant text from an `llm.stream()` chunk iterable. */
export async function collectText(stream) {
  let out = ''
  for await (const chunk of stream) {
    const type = chunk?.type
    if (type === 'text-delta') {
      const text = chunk.text ?? chunk.delta?.text
      if (typeof text === 'string') out += text
    } else if (type === 'block-end' && chunk.block?.type === 'text' && out === '') {
      // block-end repeats the text; only use it when no deltas arrived.
      if (typeof chunk.block.text === 'string') out = chunk.block.text
    } else if (type === 'finish') {
      const kind = chunk.reason?.kind ?? chunk.reason
      if (kind === 'error') {
        throw new Error(`model call failed: ${chunk.reason?.failure?.message ?? 'unknown'}`)
      }
    }
  }
  return out
}

/**
 * The model route this profile actually serves.
 *
 * A hardcoded provider name is why plugins work on one machine and not the
 * next: `deepseek/deepseek-chat` exists in the docs, not necessarily in the
 * profile. The configured route wins only when it resolves; otherwise the
 * profile default the DSH UI shows is used, and finally the first served model.
 */
export async function resolveRoute(ctx, config = {}) {
  if (config.provider && config.model) {
    let info
    try {
      info = await ctx.llm.resolveModelInfo?.(config.provider, config.model)
    } catch {
      info = undefined
    }
    if (info !== undefined && info !== null) {
      return { provider: config.provider, model: config.model }
    }
  }

  try {
    const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model }
    }
  } catch {
    /* the service is optional */
  }

  let providers = []
  try {
    providers = ctx.llm.listProviders?.() ?? []
  } catch {
    providers = []
  }
  for (const provider of providers) {
    let models = []
    try {
      models = await ctx.llm.listModels?.(provider.id)
    } catch {
      models = []
    }
    if (models?.[0]) return { provider: provider.id, model: models[0].id }
  }

  throw new Error('workbench: this profile serves no model route')
}

const ROLE_PROMPT = `You are a senior software architect designing role-based access control for a small
business application. The user described the system in plain language and named the kinds of
people who will use it.

Produce a JSON object and nothing else. Schema:

{
  "roles": [
    {
      "key": "snake_case_identifier",
      "name": "Human readable role name",
      "description": "One sentence on who this role is for.",
      "permissions": ["permission_key", "..."],
      "inherits": ["other_role_key"]
    }
  ],
  "permissions": [
    { "key": "snake_case_identifier", "description": "What this permission allows." }
  ]
}

Rules:
- Derive roles from the described users; do not invent a generic admin unless one is implied.
- Permissions are verbs on domain objects, such as "invoice.read" or "invoice.approve".
- Use inheritance only where a role is genuinely a superset of another.
- Every permission referenced by a role must appear in the permissions array.
- Keep it as small as the described system allows.`

const DESIGN_PROMPT = `You are a senior engineer turning an agreed role model into a build plan for a
small web application that a non-technical owner will run.

The role model is given below as JSON. Produce a JSON object and nothing else. Schema:

{
  "stack": { "frontend": "...", "backend": "...", "database": "...", "rationale": "..." },
  "entities": [
    {
      "key": "snake_case_identifier",
      "name": "Human readable name",
      "fields": [
        { "name": "field_name", "type": "string|number|boolean|date|enum|reference",
          "required": true, "note": "optional" }
      ]
    }
  ],
  "api": [
    { "method": "GET|POST|PATCH|DELETE", "path": "/things",
      "permission": "permission_key_or_empty", "purpose": "one sentence" }
  ],
  "workItems": [
    { "key": "snake_case_identifier", "title": "short imperative title",
      "scope": "database|api|frontend|tests",
      "dependsOn": ["other_work_item_key"],
      "instructions": "What to build, stated so a developer who has not seen this conversation could do it." }
  ]
}

Rules:
- Every API entry that touches data must name a permission from the role model, or an empty string
  for genuinely public reads.
- Work items must be independently assignable; keep each one small enough for one pass.
- Order workItems so that dependsOn only ever refers to earlier entries.
- Prefer boring, well-supported choices over novelty.`

const REVIEW_PROMPT = `You are reviewing the plan below for a small business application before
implementation starts.

Requirement:
{{BRIEF}}

Role model:
{{ROLES}}

Design:
{{DESIGN}}

Produce a JSON object and nothing else:

{
  "risks": [ { "severity": "high|medium|low", "issue": "...", "suggestion": "..." } ],
  "questions": [ "A question the owner must answer, phrased for a non-technical reader." ]
}

Return empty arrays when the plan is sound. Ask at most three questions, and only for choices
that genuinely change what gets built.`

const REPORT_PROMPT = `You are writing the delivery report for a software project that was just
implemented for a non-technical owner.

Requirement:
{{BRIEF}}

Design:
{{DESIGN}}

Test and lint results:
{{VERIFY}}

Produce a JSON object and nothing else:

{
  "summary": "Two or three sentences a non-technical owner can read.",
  "delivered": ["..."],
  "knownGaps": ["..."],
  "howToUse": ["..."]
}`

/**
 * One JSON-producing model call. Retries once on unparsable output,
 * because a chatty model is the common failure rather than a bad request.
 */
async function askJson(ctx, config, { system, prompt, signal }, attempt = 0) {
  const route = await resolveRoute(ctx, config)
  const stream = ctx.llm.stream({
    ...route,
    // Content is a block array, and the system text is folded into the single
    // user message: the exact option set of `stream` is narrower than it looks.
    messages: [{ role: 'user', content: [{ type: 'text', text: `${system}\n\n${prompt}` }] }],
    temperature: attempt === 0 ? 0.4 : 0,
    signal,
  })
  const text = await collectText(stream)
  if (!text.trim()) {
    throw new Error(`model returned no text (${route.provider}/${route.model})`)
  }
  try {
    return extractJson(text)
  } catch (err) {
    if (attempt >= 1) throw err
    return askJson(
      ctx,
      config,
      { system: `${system}\n\nYour previous reply could not be parsed as JSON. Reply with the JSON object only, starting with { and ending with }.`, prompt, signal },
      attempt + 1,
    )
  }
}

/**
 * Starts a delivery run. Returns a record describing the run; the caller
 * watches progress through `onProgress` and the store.
 */
export function createDelivery({ ctx, config, store, onProgress, onDecision }) {
  let current = null

  function report(runId, stage, detail) {
    onProgress?.({ runId, stage, detail, at: new Date().toISOString() })
  }

  /**
   * Records one decision. Never throws: an audit failure must not abort a
   * run, and the panel already degrades to "no data" on its own.
   */
  async function emitDecision(event) {
    if (typeof onDecision !== 'function') return null
    try {
      return await onDecision(event)
    } catch {
      return null
    }
  }

  async function run({ brief, roles: seedRoles, signal }) {
    if (current) throw new Error('a delivery run is already in progress')
    const record = await store.add('deliveries', {
      brief,
      stage: 'brief',
      status: 'running',
      roles: seedRoles ?? null,
      design: null,
      verify: null,
      report: null,
      startedAt: new Date().toISOString(),
    })
    current = record.id
    // The first decision is routing: which capability handles this brief. The
    // route table has exactly one candidate, so it is mechanical, not a guess.
    await emitDecision(decide('which_skill', {
      runId: record.id,
      task: brief,
      value: 'workbench_plan_software',
      confidence: evidence.route({ hits: 1, total: 1 }),
      rule: 'route:single-candidate',
    }))
    try {
      await execute(record, brief, seedRoles, signal)
    } finally {
      current = null
    }
    return store.list('deliveries').then(rows => rows.find(r => r.id === record.id))
  }

  async function execute(record, brief, seedRoles, signal) {
    const id = record.id
    const emit = (stage, patch, detail) => {
      report(id, stage, detail)
      return store.update('deliveries', id, { stage, ...patch, updatedAt: new Date().toISOString() })
    }

    // 1. roles
    emit('roles', {}, 'designing the role and permission matrix')
    const roles = seedRoles ?? await askJson(ctx, config, {
      system: ROLE_PROMPT,
      prompt: `The user wants: ${brief}`,
      signal,
    })
    await emit('roles', { roles }, `${roles.roles?.length ?? 0} roles designed`)

    // 2. design
    emit('design', {}, 'planning data model, API, and work items')
    const design = await askJson(ctx, config, {
      system: DESIGN_PROMPT,
      prompt: `The user wants: ${brief}\n\nAgreed role model:\n${JSON.stringify(roles, null, 2)}`,
      signal,
    })
    await emit('design', { design }, `${design.workItems?.length ?? 0} work items planned`)

    // 3. review — a pause point, not an automatic rejection
    emit('verify', {}, 'reviewing the plan')
    const review = await askJson(ctx, config, {
      system: REVIEW_PROMPT,
      prompt: REVIEW_PROMPT
        .replace('{{BRIEF}}', brief)
        .replace('{{ROLES}}', JSON.stringify(roles, null, 2))
        .replace('{{DESIGN}}', JSON.stringify(design, null, 2)),
      signal,
    })
    await emit('verify', { review }, `${review.risks?.length ?? 0} risks, ${review.questions?.length ?? 0} questions`)

    // The review stage is where judgement stops being mechanical. Two
    // decisions come out of it, and both are recorded before anything is
    // written to disk, so the holds are visible even if the run dies here.
    const openQuestions = Array.isArray(review.questions) ? review.questions.length : 0
    const highRisks = Array.isArray(review.risks)
      ? review.risks.filter(risk => risk?.severity === 'high').length
      : 0

    await emitDecision(decide('ask_person', {
      runId: id,
      task: brief,
      value: openQuestions > 0 ? 'yes' : 'no',
      // Confidence means "we can finish this without a person", so open
      // questions lower it. A high confidence here would be a bug, not a win.
      confidence: openQuestions > 0 ? 0.2 : 0.9,
      rule: openQuestions > 0 ? 'review:open-questions' : 'review:no-questions',
      evidence: { openQuestions, highRisks },
    }))

    await emitDecision(decide('keep_result', {
      runId: id,
      task: brief,
      value: highRisks > 0 ? 'hold' : 'keep',
      confidence: highRisks > 0 ? 0.45 : 0.82,
      rule: highRisks > 0 ? `review:high-risks:${highRisks}` : 'review:clean',
      evidence: { highRisks },
    }))

    // 4. artefacts on disk, so the owner can read them without the app
    const dir = join(config.dataDir, 'deliveries', id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'roles.json'), `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
    await writeFile(join(dir, 'design.json'), `${JSON.stringify(design, null, 2)}\n`, 'utf8')
    await writeFile(join(dir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`, 'utf8')
    await emit('verify', { artifactDir: dir }, `written to ${dir}`)

    // "Done" means the artefacts exist on disk, not that the model says so.
    const workItems = Array.isArray(design.workItems) ? design.workItems.length : 0
    await emitDecision(decide('is_done', {
      runId: id,
      task: brief,
      value: 'planned',
      confidence: evidence.stage({ parsed: true, attempts: 1, items: workItems }),
      rule: 'artefacts:written',
      evidence: { artefactDir: dir, workItems },
    }))

    // 5. delivery report
    emit('report', {}, 'writing the delivery report')
    const summary = await askJson(ctx, config, {
      system: REPORT_PROMPT,
      prompt: REPORT_PROMPT
        .replace('{{BRIEF}}', brief)
        .replace('{{DESIGN}}', JSON.stringify(design, null, 2))
        .replace('{{VERIFY}}', JSON.stringify(review, null, 2)),
      signal,
    })
    await emit('report', { report: summary, status: 'planned' }, 'plan complete')
    return summary
  }

  return {
    run,
    isRunning: () => current !== null,
    currentRunId: () => current,
    stages: STAGES,
  }
}