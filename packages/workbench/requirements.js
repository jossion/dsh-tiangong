/**
 * Requirement intake.
 *
 * A requirement is the one thing the whole loop is about, so it is normalized
 * before it enters the ledger: one text, one source, one optional file. The
 * uploaded document is decoded here (md/txt first; docx/pdf are explicit
 * "not yet" errors instead of silent garbage), and the planning directive the
 * main agent receives is built from the same normalized shape.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Extensions we can decode as UTF-8 text today. */
export const TEXT_EXTENSIONS = ['md', 'markdown', 'txt']

export const REQUIREMENT_LIMITS = {
  maxText: 20000,
  maxFileBytes: 512 * 1024,
  maxTitle: 80,
}

/**
 * The three change kinds the panel offers on a delivered task. They travel
 * with the requirement so the new job records *why* it points at its parent.
 */
export const REQUEST_KINDS = ['change', 'fix', 'feature']

export class RequirementError extends Error {
  constructor(issues) {
    const list = Array.isArray(issues) && issues.length > 0 ? issues : ['invalid requirement']
    super(`invalid requirement: ${list[0]}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`)
    this.name = 'RequirementError'
    this.issues = list
  }
}

export function extensionOf(name) {
  const match = String(name ?? '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  return match === null ? null : match[1]
}

/** Strip a BOM and normalize line endings, so the prompt is stable. */
export function normalizeText(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
}

/** The card title: explicit title, first markdown heading, else first line. */
export function titleOf(text, explicit) {
  const given = normalizeText(explicit)
  if (given !== '') return given.slice(0, REQUIREMENT_LIMITS.maxTitle)
  const heading = normalizeText(text).match(/^#{1,6}\s+(.+)$/m)
  if (heading !== null) return heading[1].trim().slice(0, REQUIREMENT_LIMITS.maxTitle)
  const first = normalizeText(text).split('\n').find(line => line.trim() !== '')
  return (first ?? '未命名需求').trim().slice(0, REQUIREMENT_LIMITS.maxTitle)
}

function decodeFile(file) {
  const issues = []
  const name = normalizeText(file?.name)
  if (name === '') issues.push('file.name is required')
  const extension = extensionOf(name)
  if (extension !== null && !TEXT_EXTENSIONS.includes(extension)) {
    issues.push(
      `file type .${extension} is not readable yet: upload ${TEXT_EXTENSIONS.map(ext => `.${ext}`).join('/')} `
      + 'or paste the requirement text',
    )
  }
  const encoded = typeof file?.base64 === 'string' ? file.base64 : ''
  if (encoded === '') issues.push('file.base64 is required')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length === 0) issues.push('file is empty')
  if (bytes.length > REQUIREMENT_LIMITS.maxFileBytes) {
    issues.push(`file exceeds ${Math.round(REQUIREMENT_LIMITS.maxFileBytes / 1024)} KiB`)
  }
  const text = normalizeText(bytes.toString('utf8'))
  if (text === '' && issues.length === 0) issues.push('file contains no text')
  return { issues, file: { name, extension, bytes: bytes.length, text } }
}

/**
 * Validate and normalize one submission: `{ projectId, title?, text?, file?,
 * parentJobId?, kind? }`. Returns every issue at once, like the planner, so
 * one round-trip fixes them.
 */
export function normalizeRequirement(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const issues = []
  const projectId = normalizeText(source.projectId)
  if (projectId === '') issues.push('projectId is required')

  // A change request names the delivered job it follows and picks one kind.
  // Both are optional: a plain new task has neither.
  const parentJobId = normalizeText(source.parentJobId)
  const kind = normalizeText(source.kind)
  if (kind !== '' && !REQUEST_KINDS.includes(kind)) {
    issues.push(`kind must be one of ${REQUEST_KINDS.join('/')}`)
  }

  const pasted = normalizeText(source.text)
  let uploaded = null
  if (source.file !== null && source.file !== undefined) {
    const decoded = decodeFile(source.file)
    issues.push(...decoded.issues)
    uploaded = decoded.file
  }

  if (pasted === '' && uploaded === null) issues.push('text or file is required')
  if (pasted.length > REQUIREMENT_LIMITS.maxText) {
    issues.push(`text exceeds ${REQUIREMENT_LIMITS.maxText} characters; upload a document instead`)
  }

  const parts = []
  if (uploaded !== null && uploaded.text !== '') parts.push(uploaded.text)
  if (pasted !== '') parts.push(pasted)
  const text = normalizeText(parts.join('\n\n'))

  if (issues.length > 0) return { ok: false, issues, requirement: null }
  return {
    ok: true,
    issues: [],
    requirement: {
      projectId,
      title: titleOf(text, source.title),
      text,
      source: uploaded === null ? 'text' : 'upload',
      file: uploaded === null
        ? null
        : { name: uploaded.name, extension: uploaded.extension, bytes: uploaded.bytes },
      ...(parentJobId === '' ? {} : { parentJobId }),
      ...(kind === '' ? {} : { kind }),
    },
  }
}

export function assertRequirement(input) {
  const { ok, issues, requirement } = normalizeRequirement(input)
  if (!ok) throw new RequirementError(issues)
  return requirement
}

/** Where a requirement's source document lives, relative to the data dir. */
export function requirementPathOf(jobId) {
  return join('requirements', `${jobId}.md`)
}

/**
 * Persist the normalized text under the data dir. Even a pasted requirement is
 * written down: the planning agent gets a stable path to re-read, and a failed
 * run leaves its input behind.
 */
export async function storeRequirement(dataDir, jobId, requirement) {
  const target = join(dataDir, requirementPathOf(jobId))
  await mkdir(join(dataDir, 'requirements'), { recursive: true })
  const header = [
    `# ${requirement.title}`,
    '',
    `<!-- project: ${requirement.projectId} · job: ${jobId} · source: ${requirement.source}${typeof requirement.parentJobId === 'string' ? ` · follow-up: ${requirement.parentJobId} (${requirement.kind ?? 'change'})` : ''} -->`,
    '',
  ].join('\n')
  await writeFile(target, `${header}${requirement.text}\n`, 'utf8')
  return { path: target, relative: requirementPathOf(jobId), bytes: Buffer.byteLength(requirement.text) }
}

/** The exact message the delivery agent receives to start planning. */
export function planningDirective({ project, job, requirement, requirementFile = null }) {
  const lines = [
    `You are the delivery lead for the Workbench project "${project?.title ?? project?.id ?? 'project'}".`,
    `A new requirement was submitted as job ${job.jobId}.`,
    '',
    'Requirement:',
    '---',
    requirement.text,
    '---',
  ]
  if (requirementFile !== null) lines.push('', `Source document: ${requirementFile} (read it if you need the full formatting).`)
  if (job.workspace) lines.push('', `Workspace: ${job.workspace}`)
  if (typeof job.parentJobId === 'string' && job.parentJobId !== '') {
    const parent = typeof job.parentTitle === 'string' && job.parentTitle !== '' ? ` ("${job.parentTitle}")` : ''
    const what = job.kind === 'fix' ? 'bug-fix follow-up' : job.kind === 'feature' ? 'feature follow-up' : 'change request'
    lines.push(
      '',
      `This is a ${what} on job ${job.parentJobId}${parent}: change that delivered result in place,`,
      'do not rebuild its whole scope, and leave every file the change does not need untouched.',
    )
  }
  lines.push(
    '',
    'Do this in this turn:',
    '1. Understand the requirement from its text plus a quick look at the workspace (do not invent an',
    '   existing structure). Start from SCAFFOLD.md / README.md when the workspace has one instead of',
    '   walking the tree. Budget this turn: at most 10 tool calls / about 3 minutes before you submit.',
    '   Do not read the whole repository, reproduce the bug, or run the test suite here — that is what',
    '   the cards are for. Loading a planning/PRD/architecture/domain skill is fine; if a skill you need',
    '   is missing, call workbench_find_skill to search the session catalog and the plugin market.',
    '2. If the requirement needs root-cause work, put a diagnose card in the plan (owner backend, stage',
    "   build) instead of investigating during planning. Do not do a card's job in this turn.",
    '3. Produce ONE plan and submit it with workbench_submit_plan:',
    `   workbench_submit_plan({ jobId: ${JSON.stringify(job.jobId)}, brief, roles?, design?, tasks: [{ id, title, owner, stage, blockedBy?, instructions?, acceptance?, skill? }] })`,
    '   Rules: ids are unique inside the plan; blockedBy only references ids in this plan; at least one',
    '   dispatchable item (stage design/build/verify/report) owned by backend/frontend/qa; brief/roles',
    '   are planning-only; each item is small enough for one child agent; every item should carry a',
    '   one-line acceptance check (the command or assertion the child must satisfy) — an empty',
    '   acceptance leaves the later done-gate with nothing to check;',
    '   verification work uses stage "verify"; never include merge/delete-branch/rotate-credential steps.',
    'Before planning, discover the skills this deliverable needs: call workbench_find_skill with',
    '   the requirement text, then call the skill tool for the 1-2 results that match the project type',
    '   (software delivery, copywriting, finance, ...). Do not submit the plan until at least one skill',
    '   is loaded, and name the loaded skills in the instructions of the cards that will use them.',
    '4. Do not implement the plan yourself and do not report completion: child agents execute the',
    '   cards and the plugin derives done from their test evidence.',
    'If workbench_submit_plan rejects the plan, fix every reported issue and resubmit.',
    'If the requirement is still unclear when the budget is spent, submit the best plan you can defend',
    'and put the unknowns into the card instructions. A long planning turn costs the loop more than a',
    'diagnose card that answers the same question in public.',
  )
  return lines.join('\n')
}
