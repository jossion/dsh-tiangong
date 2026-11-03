import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Config } from '../index.js'

const standard = Config['~standard'] ?? Config

test('the exported Config is a Standard Schema with every tunable defaulted', () => {
  assert.equal(typeof standard.validate, 'function', 'activation validates the row config')
  const result = standard.validate({})
  assert.ok(!('issues' in result), 'empty config is valid')
  assert.equal(result.value.autoRun, true)
  assert.equal(result.value.dataDir, '')
  assert.equal(result.value.wakeCooldownMs, 4000)
  assert.equal(result.value.budgetTokens, 0)
  assert.equal(result.value.priceInputPerMTok, 0)
  assert.equal(result.value.stallAfterWakes, 6)
})

test('bad config values are reported, not silently coerced', () => {
  const result = standard.validate({ autoRun: 'yes', maxRounds: -2, priceInputPerMTok: 'free' })
  assert.ok(Array.isArray(result.issues))
  assert.ok(result.issues.length >= 3)
  assert.ok(result.issues.some(issue => /autoRun/.test(issue.message)))
})

test('a partial config keeps the defaults for untouched fields', () => {
  const result = standard.validate({ agentPreset: 'standard', budgetTokens: 50000 })
  assert.equal(result.value.agentPreset, 'standard')
  assert.equal(result.value.budgetTokens, 50000)
  assert.equal(result.value.maxRounds, 60)
})
