import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SKILL_LIMITS,
  formatSkillResult,
  marketCandidates,
  rankSkills,
  scoreSkill,
  tokenize,
} from '../skillfind.js'

const skill = (name, description, whenToUse = undefined) => ({
  name,
  description,
  whenToUse,
  source: 'bundled',
  provider: 'test',
  invocation: { modelInvocable: true, userInvocable: true },
})

/* ── matching ─────────────────────────────────────────────────────────── */

test('tokenize keeps useful terms and drops noise', () => {
  assert.deepEqual(tokenize('数据库 Migration!'), ['数据库', 'migration'])
  assert.deepEqual(tokenize('a b c'), [])
  assert.deepEqual(tokenize(''), [])
})

test('an exact name outranks a name substring, which outranks description', () => {
  const exact = scoreSkill(skill('database-migration', 'x'), 'database-migration')
  const substring = scoreSkill(skill('database-migration', 'x'), 'migration')
  const described = scoreSkill(skill('tdd', 'write database migration tests'), 'migration')
  assert.equal(exact.score, 100)
  assert.ok(substring.score > described.score)
  assert.equal(described.score > 0, true)
  assert.equal(scoreSkill(skill('tdd', 'tests'), 'unrelated').score, 0)
  assert.equal(scoreSkill(null, 'x').score, 0)
})

test('rankSkills sorts best-first, keeps the reason, and limits the page', () => {
  const catalog = [
    skill('tdd', 'test driven development'),
    skill('database-migration', 'schema migrations for sqlite', 'Use when changing tables'),
    skill('schema-migration', 'sqlite column changes'),
    skill('prd-writer', 'write a product requirement document'),
  ]
  const ranked = rankSkills(catalog, 'migration', { limit: 2 })
  assert.equal(ranked.length, 2)
  assert.equal(ranked[0].name, 'database-migration')
  assert.match(ranked[0].why, /name/)
  assert.equal(ranked[0].source, 'bundled')

  const cjk = rankSkills(catalog, '数据库迁移')
  // No CJK text in these fixtures: nothing must match by accident.
  assert.deepEqual(cjk, [])
})

test('the limit is bounded even for a bad option', () => {
  const many = Array.from({ length: SKILL_LIMITS.maxCandidates + 4 }, (_, index) => skill(`migration-${index}`, 'migration'))
  assert.equal(rankSkills(many, 'migration').length, SKILL_LIMITS.maxCandidates)
  assert.equal(rankSkills(many, 'migration', { limit: -3 }).length, SKILL_LIMITS.maxCandidates)
  assert.equal(rankSkills([], 'migration').length, 0)
})

/* ── market and result shaping ────────────────────────────────────────── */

test('market entries are reduced to what the agent needs', () => {
  const entries = [
    {
      name: 'dsh-nice-plugin',
      title: { en: 'Nice plugin', zh: '好插件' },
      description: { en: 'does nice things' },
      defaultVersion: '1.2.0',
      installation: { status: 'not-installed' },
      versions: [
        { version: '1.2.0', install: { spec: 'dsh-nice-plugin@1.2.0' } },
        { version: '1.1.0', install: { spec: 'dsh-nice-plugin@1.1.0' } },
      ],
    },
    { name: '' },
  ]
  const mapped = marketCandidates(entries)
  assert.equal(mapped.length, 1)
  assert.equal(mapped[0].name, 'dsh-nice-plugin')
  assert.equal(mapped[0].title, 'Nice plugin')
  assert.equal(mapped[0].installSpec, 'dsh-nice-plugin@1.2.0')
  assert.equal(mapped[0].installed, 'not-installed')
})

test('the tool result separates use-now from install-first', () => {
  const parsed = JSON.parse(formatSkillResult({
    query: 'migration',
    session: [{ name: 'tdd', score: 12, why: 'description:migration' }],
    market: [{ index: 'Official', entries: [{ name: 'dsh-migration', installed: 'not-installed' }] }],
    marketErrors: [{ index: 'https://x', error: 'fetch-failed' }],
  }))
  assert.equal(parsed.query, 'migration')
  assert.equal(parsed.sessionSkills[0].name, 'tdd')
  assert.equal(parsed.market[0].entries[0].name, 'dsh-migration')
  assert.ok(parsed.howToUse.length >= 2)
  assert.match(parsed.howToUse.join(' '), /install/i)
})

test('availability separates installed recommendations from missing requirements', async () => {
  const { skillAvailability } = await import('../skillfind.js')
  const result = skillAvailability(
    ['create-implementation-plan', 'office'],
    ['create-implementation-plan', 'review-and-refactor'],
    ['office', 'not-installed-skill'],
  )
  assert.deepEqual(result.recommended, [
    { name: 'create-implementation-plan', installed: true },
    { name: 'review-and-refactor', installed: false },
  ])
  assert.deepEqual(result.required, [
    { name: 'office', installed: true },
    { name: 'not-installed-skill', installed: false },
  ])
  assert.deepEqual(result.missing, ['review-and-refactor', 'not-installed-skill'])
})
