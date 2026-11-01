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
    if (chunk.type === 'text-delta') out += chunk.text
    else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') {
      // block-end repeats the text; only use it when deltas were absent.
      if (!out && typeof chunk.block.text === 'string') out = chunk.block.text
    } else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(`model call failed: ${chunk.reason.failure?.message ?? 'unknown'}`)
    }
  }
  return out
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
  const stream = ctx.llm.stream({
    provider: config.provider,
    model: config.model,
    system,
    messages: [{ role: 'user', content: prompt }],
    temperature: attempt === 0 ? 0.4 : 0,
    signal,
  })
  const text = await collectText(stream)
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
export function createDelivery({ ctx, config, store, onProgress }) {
  let current = null

  function report(runId, stage, detail) {
    onProgress?.({ runId, stage, detail, at: new Date().toISOString() })
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

    // 4. artefacts on disk, so the owner can read them without the app
    const dir = join(config.dataDir, 'deliveries', id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'roles.json'), `${JSON.stringify(roles, null, 2)}\n`, 'utf8')
    await writeFile(join(dir, 'design.json'), `${JSON.stringify(design, null, 2)}\n`, 'utf8')
    await writeFile(join(dir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`, 'utf8')
    await emit('verify', { artifactDir: dir }, `written to ${dir}`)

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