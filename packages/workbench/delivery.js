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
import { artifactEvent, jobEvent, projectEvent, taskEvent } from './projects.js'

const STAGES = ['brief', 'roles', 'design', 'build', 'verify', 'report']

/**
 * A short, human label for the work item a decision belongs to.
 *
 * The first sentence of a brief is what a person would call the project
 * ("一个公司内部的报价单系统"); the rest is detail. Passing the whole brief as
 * `task` is what made the panel print a paragraph where a card title belongs.
 */
export function taskLabel(brief, max = 28) {
  const text = String(brief ?? '').replace(/\s+/g, ' ').trim()
  const firstSentence = text.split(/[。！？!?\n]/)[0]?.trim() || text
  return firstSentence.length <= max ? firstSentence : `${firstSentence.slice(0, max - 1)}…`
}

/**
 * Who builds a work item, by scope.
 *
 * The plan's role model is *business* roles (销售 / 财务) — who may use the
 * system. The work items are *engineering* work, so they belong to the dev
 * agents, not to the people who asked for it. Assigning a database migration
 * to 销售 because their role came first is the kind of quiet nonsense a board
 * makes visible, so the mapping is explicit and scope-driven.
 */
const DEV_ROLES = {
  database: { owner: 'backend', role: '后端开发' },
  api: { owner: 'backend', role: '后端开发' },
  frontend: { owner: 'frontend', role: '前端开发' },
  tests: { owner: 'qa', role: 'QA' },
}

export function ownerForScope(scope) {
  return DEV_ROLES[String(scope ?? '')] ?? { owner: 'workbench', role: '规划智能体' }
}

/**
 * How much of a plan can start at once.
 *
 * `dependsOn` decides the team's parallelism, so the plan is measured instead
 * of assumed: ready items are the ones with no dependency, and the longest
 * chain is the shortest possible wall-clock if everything else runs in
 * parallel. A chain through almost every item means the plan is a queue.
 */
export function planHealth(workItems) {
  const list = (Array.isArray(workItems) ? workItems : [])
    .filter(item => item !== null && typeof item === 'object' && typeof item.key === 'string')
  const keys = new Set(list.map(item => item.key))
  const deps = new Map(list.map(item => [
    item.key,
    Array.isArray(item.dependsOn)
      ? item.dependsOn.filter(key => keys.has(key) && key !== item.key)
      : [],
  ]))

  const visiting = new Set()
  const memo = new Map()
  const depth = key => {
    if (memo.has(key)) return memo.get(key)
    if (visiting.has(key)) return 1 // a cycle is a plan bug; do not hang on it
    visiting.add(key)
    const edges = deps.get(key) ?? []
    const value = edges.length === 0 ? 1 : 1 + Math.max(...edges.map(depth))
    visiting.delete(key)
    memo.set(key, value)
    return value
  }

  let maxChain = 0
  for (const key of deps.keys()) maxChain = Math.max(maxChain, depth(key))
  const ready = [...deps.values()].filter(edges => edges.length === 0).length
  return { total: list.length, ready, blocked: list.length - ready, maxChain }
}

/** A plan this wide deserves a repair pass rather than a serial run. */
export function needsRepair(health) {
  return health.total >= 6 && health.ready < Math.max(2, Math.ceil(health.total / 4))
}

function repairRule(health) {
  return `Your dependency graph is over-serialized: only ${health.ready} of ${health.total} work items `
    + `can start now and the longest chain is ${health.maxChain} items, so the team would run one item at a time. `
    + 'Return the SAME design, changing only dependsOn: keep an edge only when the other item\'s data '
    + 'contract truly must exist first. Frontend pages do not wait on unrelated backend items; tests may be '
    + 'written before the code they cover. Aim for at least a third of the items having no dependency.'
}

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
    { "key": "snake_case_identifier", "title": "short imperative title, in the language the requirement was written in",
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
- dependsOn is a HARD data-contract dependency, not a sequence of convenience: an edge is
  justified only when the other item's output must exist first (a table before the API that
  reads it, a permission before the check that uses it). Frontend pages do not wait for
  unrelated backend items; tests can be written before the code they cover.
- Prefer parallel work: at least a third of the work items should have no dependency at all.
  A plan where everything waits on one item turns a team into a queue.
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
export function createDelivery({ ctx, config, store, onProgress, onDecision, onEvent = onDecision }) {
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

  /**
   * Same contract as `emitDecision`, for the board's life-cycle lines. The
   * board must survive a failed append for the same reason the audit log does:
   * losing a card is bad, losing the run is worse.
   */
  async function emitEvent(event) {
    const sink = typeof onEvent === 'function' ? onEvent : onDecision
    if (typeof sink !== 'function') return null
    try {
      return await sink(event)
    } catch {
      return null
    }
  }

  /**
   * @param {{brief: string, roles?: object, signal?: AbortSignal, projectId?: string}} input
   * `projectId` attaches this run to an existing board card (one opened from the
   * card grid); without it the run opens its own project.
   */
  async function run({ brief, roles: seedRoles, signal, projectId: attachTo, jobId: requestedJob, parentJobId = null, kind = null }) {
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
    const projectId = typeof attachTo === 'string' && attachTo !== '' ? attachTo : record.id
    // One run is one job. Without an explicit id the project is also the job,
    // which keeps pre-job logs rendering exactly as before.
    const jobId = typeof requestedJob === 'string' && requestedJob !== '' ? requestedJob : record.id
    const label = taskLabel(brief, 40)
    // Artefacts stay under the run id even when the events belong to an
    // existing card, so two runs on one card cannot overwrite each other.
    const artifactDir = join(config.dataDir, 'deliveries', record.id)
    // The executor hands children this directory instead of pasting the plan
    // into every prompt, so a child always reads the current design.
    await emitEvent(jobEvent({
      projectId,
      jobId,
      title: label,
      brief,
      event: 'created',
      // A follow-up task names the delivered task it came from, so the project
      // keeps one chain of evidence instead of rewriting a finished job.
      ...(typeof parentJobId === 'string' && parentJobId !== '' ? { parentJobId } : {}),
      // `kind` is reserved for the ledger line type, so the task's own kind
      // travels as jobKind.
      ...(typeof kind === 'string' && kind !== '' ? { jobKind: kind } : {}),
    }))
    if (typeof attachTo === 'string' && attachTo !== '') {
      // An existing card keeps the name its owner gave it; the run only adds
      // the brief and the artefact directory to it.
      await emitEvent(projectEvent({ projectId, brief, artifactDir, event: 'started' }))
    } else {
      await emitEvent(projectEvent({ projectId, title: label, brief, artifactDir, event: 'created' }))
    }
    // The first decision is routing: which capability handles this brief. The
    // route table has exactly one candidate, so it is mechanical, not a guess.
    await emitDecision(decide('which_skill', {
      runId: record.id,
      projectId,
      jobId,
      taskId: `${jobId}:brief`,
      stage: 'brief',
      owner: 'workbench',
      task: label,
      value: 'workbench_plan_software',
      confidence: evidence.route({ hits: 1, total: 1 }),
      rule: 'route:single-candidate',
    }))
    try {
      await execute(record, brief, seedRoles, signal, projectId, jobId)
      // Planning finished, not the job: the work items still need execution.
      await emitEvent(jobEvent({ projectId, jobId, event: 'started' }))
      if (typeof attachTo !== 'string') await emitEvent(projectEvent({ projectId, event: 'done' }))
    } catch (error) {
      // A cancelled run is not a failed one: the owner stopped it on purpose,
      // and the board must say so rather than report a fault.
      const cancelled = error?.name === 'AbortError'
      await emitEvent(jobEvent({ projectId, jobId, event: cancelled ? 'cancelled' : 'failed' }))
      if (typeof attachTo !== 'string') {
        await emitEvent(projectEvent({ projectId, event: cancelled ? 'cancelled' : 'failed' }))
      }
      throw error
    } finally {
      current = null
    }
    return store.list('deliveries').then(rows => rows.find(r => r.id === record.id))
  }

  async function execute(record, brief, seedRoles, signal, projectId, jobId) {
    const id = record.id
    const label = taskLabel(brief, 40)
    const emit = (stage, patch, detail) => {
      report(projectId, stage, detail)
      return store.update('deliveries', id, { stage, ...patch, updatedAt: new Date().toISOString() })
    }

    // The board's cards and the agent's decisions are written through the same
    // append-only log, so a stage that starts on disk starts on the board too.
    const taskId = suffix => `${jobId}:${suffix}`
    const openTask = (suffix, stage, title, owner = 'workbench', role = '规划智能体') =>
      emitEvent(taskEvent({ event: 'created', taskId: taskId(suffix), projectId, jobId, stage, owner, role, title }))
    const claimTask = suffix => emitEvent(taskEvent({ event: 'claimed', taskId: taskId(suffix) }))
    const finishTask = suffix => emitEvent(taskEvent({ event: 'done', taskId: taskId(suffix) }))
    const attachArtefact = (suffix, path) => emitEvent(artifactEvent({ taskId: taskId(suffix), path }))

    // 0. the brief itself: parsing it is a stage with a card, not a preamble.
    await openTask('brief', 'brief', '解析需求', 'workbench', '规划智能体')
    await finishTask('brief')

    // 1. roles
    await openTask('roles', 'roles', '设计角色与权限矩阵')
    await claimTask('roles')
    emit('roles', {}, 'designing the role and permission matrix')
    const roles = seedRoles ?? await askJson(ctx, config, {
      system: ROLE_PROMPT,
      prompt: `The user wants: ${brief}`,
      signal,
    })
    await emit('roles', { roles }, `${roles.roles?.length ?? 0} roles designed`)

    // 2. design
    await openTask('design', 'design', '设计数据模型与 API')
    await claimTask('design')
    const designPrompt = `The user wants: ${brief}\n\nAgreed role model:\n${JSON.stringify(roles, null, 2)}`
    emit('design', {}, 'planning data model, API, and work items')
    let design = await askJson(ctx, config, { system: DESIGN_PROMPT, prompt: designPrompt, signal })
    let parallel = planHealth(design.workItems)

    // A plan that can only start one item is a queue wearing a plan's clothes.
    // One repair round is cheaper than a delivery that runs strictly serial.
    if (needsRepair(parallel)) {
      await emit('design', { design, parallel }, `over-serialized (${parallel.ready}/${parallel.total} ready), asking for a repair`)
      try {
        const repaired = await askJson(ctx, config, {
          system: DESIGN_PROMPT,
          prompt: `${designPrompt}\n\nPrevious design:\n${JSON.stringify(design)}\n\n${repairRule(parallel)}`,
          signal,
        })
        const repairedHealth = planHealth(repaired.workItems)
        if (repairedHealth.total >= parallel.total && repairedHealth.ready > parallel.ready) {
          design = repaired
          parallel = repairedHealth
        }
      } catch {
        // The first design still parses; a failed repair must not lose it.
      }
    }
    await emit('design', { design }, `${design.workItems?.length ?? 0} work items planned, ${parallel.ready} can start at once`)

    // 3. review — a pause point, not an automatic rejection
    await openTask('verify', 'verify', '评审计划风险')
    await claimTask('verify')
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
      projectId,
      jobId,
      taskId: taskId('verify'),
      stage: 'verify',
      owner: 'workbench',
      task: label,
      value: openQuestions > 0 ? 'yes' : 'no',
      // Confidence means "we can finish this without a person", so open
      // questions lower it. A high confidence here would be a bug, not a win.
      confidence: openQuestions > 0 ? 0.2 : 0.9,
      rule: openQuestions > 0 ? 'review:open-questions' : 'review:no-questions',
      evidence: {
        openQuestions,
        highRisks,
        questions: Array.isArray(review.questions) ? review.questions.slice(0, 5) : [],
      },
    }))

    await emitDecision(decide('keep_result', {
      runId: id,
      projectId,
      jobId,
      taskId: taskId('verify'),
      stage: 'verify',
      owner: 'workbench',
      task: label,
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

    await attachArtefact('roles', join(dir, 'roles.json'))
    await attachArtefact('design', join(dir, 'design.json'))
    await attachArtefact('verify', join(dir, 'review.json'))
    await finishTask('roles')
    await finishTask('design')
    await finishTask('verify')

    // "Done" means the artefacts exist on disk, not that the model says so.
    const workItems = Array.isArray(design.workItems) ? design.workItems : []

    // 5. the build lane: the plan becomes assignable cards, one per work item,
    // each owned by the role whose scope it belongs to and blocked by the
    // items it declared as dependencies. Nothing executes them yet — that is
    // what makes the board honest about the gap between planned and built.
    const buildId = taskId('build')
    await emitEvent(taskEvent({
      event: 'created',
      taskId: buildId,
      projectId,
      jobId,
      stage: 'build',
      owner: 'workbench',
      role: '规划智能体',
      title: `实现（${workItems.length} 个工作项）`,
    }))

    for (const item of workItems) {
      if (item === null || typeof item !== 'object' || typeof item.key !== 'string') continue
      const assignee = ownerForScope(item.scope)
      await emitEvent(taskEvent({
        event: 'created',
        taskId: taskId(`wi:${item.key}`),
        parentId: buildId,
        projectId,
        jobId,
        // A test is work, but it is not implementation: it belongs on the
        // verify stage so the rail shows the gap before "done".
        stage: item.scope === 'tests' ? 'verify' : 'build',
        owner: assignee.owner,
        role: assignee.role,
        title: String(item.title ?? item.key),
        instructions: typeof item.instructions === 'string' ? item.instructions : null,
        blockedBy: Array.isArray(item.dependsOn)
          ? item.dependsOn.map(key => taskId(`wi:${key}`))
          : [],
      }))
    }

    // 6. delivery report
    await emitDecision(decide('is_done', {
      runId: id,
      projectId,
      jobId,
      taskId: taskId('build'),
      stage: 'build',
      owner: 'workbench',
      task: label,
      value: 'planned',
      confidence: evidence.stage({ parsed: true, attempts: 1, items: workItems.length }),
      rule: 'artefacts:written',
      evidence: { artefactDir: dir, workItems: workItems.length, parallel },
    }))

    await openTask('report', 'report', '生成交付报告')
    await claimTask('report')
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
    await attachArtefact('report', join(dir, 'review.json'))
    await finishTask('report')
    return summary
  }

  return {
    run,
    isRunning: () => current !== null,
    currentRunId: () => current,
    stages: STAGES,
  }
}