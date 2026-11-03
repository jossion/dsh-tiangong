import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  REQUIREMENT_LIMITS,
  RequirementError,
  assertRequirement,
  extensionOf,
  normalizeRequirement,
  normalizeText,
  planningDirective,
  requirementPathOf,
  storeRequirement,
  titleOf,
} from '../requirements.js'

const encode = text => Buffer.from(text, 'utf8').toString('base64')

/* ── normalization ────────────────────────────────────────────────────── */

test('a pasted requirement is trimmed, titled and marked as text', () => {
  const { ok, requirement } = normalizeRequirement({
    projectId: 'p1',
    text: '\uFEFF第一行需求\r\n\r\n第二段',
  })
  assert.equal(ok, true)
  assert.equal(requirement.source, 'text')
  assert.equal(requirement.file, null)
  assert.equal(requirement.title, '第一行需求')
  assert.equal(requirement.text, '第一行需求\n\n第二段')
})

test('an explicit title wins; a markdown heading is the fallback', () => {
  assert.equal(normalizeRequirement({ projectId: 'p1', title: '报价单', text: '正文' }).requirement.title, '报价单')
  assert.equal(normalizeRequirement({ projectId: 'p1', text: '## 员工管理\n正文' }).requirement.title, '员工管理')
  assert.equal(titleOf('no heading here', ''), 'no heading here')
})

test('a markdown upload is decoded and beats the pasted text for ordering', () => {
  const { ok, requirement } = normalizeRequirement({
    projectId: 'p1',
    text: '补充：先做只读',
    file: { name: '需求.MD', base64: encode('# 员工管理\n## 目标\n增删改查') },
  })
  assert.equal(ok, true)
  assert.equal(requirement.source, 'upload')
  assert.equal(requirement.file.name, '需求.MD')
  assert.equal(requirement.file.extension, 'md')
  assert.equal(requirement.file.bytes, Buffer.byteLength('# 员工管理\n## 目标\n增删改查'))
  assert.match(requirement.text, /^# 员工管理/)
  assert.match(requirement.text, /补充：先做只读$/)
})

test('docx/pdf are explicit "not yet" errors, not silent garbage', () => {
  for (const name of ['spec.pdf', 'spec.docx']) {
    const { ok, issues } = normalizeRequirement({
      projectId: 'p1',
      file: { name, base64: encode('binary-ish') },
    })
    assert.equal(ok, false)
    assert.match(issues.join('; '), /not readable yet/)
  }
})

test('empty, oversized and malformed input is refused with every issue', () => {
  assert.equal(normalizeRequirement({}).ok, false)
  assert.match(normalizeRequirement({}).issues.join('; '), /projectId is required/)

  const empty = normalizeRequirement({ projectId: 'p1', text: '   ' })
  assert.equal(empty.ok, false)
  assert.match(empty.issues.join('; '), /text or file is required/)

  const long = normalizeRequirement({ projectId: 'p1', text: 'x'.repeat(REQUIREMENT_LIMITS.maxText + 1) })
  assert.equal(long.ok, false)
  assert.match(long.issues.join('; '), /upload a document instead/)

  const big = normalizeRequirement({
    projectId: 'p1',
    file: { name: 'big.md', base64: encode('x'.repeat(REQUIREMENT_LIMITS.maxFileBytes + 1)) },
  })
  assert.equal(big.ok, false)
  assert.match(big.issues.join('; '), /exceeds/)

  assert.throws(() => assertRequirement({}), error => {
    assert.ok(error instanceof RequirementError)
    assert.match(error.message, /invalid requirement/)
    return true
  })
})

test('helpers: extension and text normalization', () => {
  assert.equal(extensionOf('a/b/需求.MD'), 'md')
  assert.equal(extensionOf('noext'), null)
  assert.equal(normalizeText('  a\r\nb  '), 'a\nb')
})

/* ── storage and the planning directive ───────────────────────────────── */

test('the requirement is stored on disk with its provenance header', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-req-'))
  try {
    const requirement = assertRequirement({ projectId: 'p1', text: '# 员工管理\n增删改查' })
    const stored = await storeRequirement(dir, 'job-1', requirement)
    assert.equal(stored.relative, requirementPathOf('job-1'))
    assert.equal(stored.relative, join('requirements', 'job-1.md'))
    const written = await readFile(stored.path, 'utf8')
    assert.match(written, /^# 员工管理/)
    assert.match(written, /project: p1 · job: job-1 · source: text/)
    assert.match(written, /增删改查/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the planning directive carries the requirement, the job and the submit tool', () => {
  const requirement = assertRequirement({
    projectId: 'p1',
    text: '给公司管理加员工管理页',
  })
  const directive = planningDirective({
    project: { id: 'p1', title: '公司管理' },
    job: { jobId: 'job-1', workspace: '/tmp/app' },
    requirement,
    requirementFile: 'requirements/job-1.md',
  })
  assert.match(directive, /delivery lead/)
  assert.match(directive, /公司管理/)
  assert.match(directive, /job-1/)
  assert.match(directive, /给公司管理加员工管理页/)
  assert.match(directive, /workbench_submit_plan/)
  assert.match(directive, /workbench_find_skill/)
  assert.match(directive, /\/tmp\/app/)
  assert.match(directive, /requirements\/job-1\.md/)
  assert.match(directive, /do not report completion/i)
})
