import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_KINDS, normalizeProjectKind, resolveProjectProfile, toolFilterFor } from '../profiles.js'

test('the three project kinds resolve to a preset and a tool policy', () => {
  assert.deepEqual(PROJECT_KINDS, ['software', 'copy', 'custom'])
  const software = resolveProjectProfile('software')
  assert.equal(software.preset, 'workbench-software')
  assert.equal(software.template, 'software')
  assert.ok(software.tools.prefixes.includes('blender_'))
  const copy = resolveProjectProfile('copy')
  assert.equal(copy.preset, 'workbench-copy')
  assert.ok(copy.tools.names.includes('bash'))
  const custom = resolveProjectProfile('custom')
  assert.equal(custom.preset, null)
  assert.equal(custom.tools, null)
})

test('an unknown or missing kind falls back to custom', () => {
  assert.equal(normalizeProjectKind('nope'), 'custom')
  assert.equal(normalizeProjectKind(undefined), 'custom')
  assert.equal(normalizeProjectKind('  copy '), 'copy')
  assert.equal(resolveProjectProfile('nope').kind, 'custom')
})

test('the tool mask only denies names this deployment registered', () => {
  const names = ['blender_render', 'comfyui_run', 'cua_driver_native__click', 'spawn_teammate', 'workbench_state', 'bash']
  const software = toolFilterFor(resolveProjectProfile('software'), names)
  assert.deepEqual(software.deny.sort(), ['blender_render', 'comfyui_run', 'cua_driver_native__click', 'spawn_teammate'].sort())
  assert.equal(toolFilterFor(resolveProjectProfile('software'), ['workbench_state']), null, 'nothing known to deny')
  assert.equal(toolFilterFor(resolveProjectProfile('custom'), names), null, 'custom masks nothing')
})

test('copy also masks shell tools when they are global', () => {
  const filter = toolFilterFor(resolveProjectProfile('copy'), ['bash', 'pwsh', 'blender_render', 'workbench_state'])
  assert.deepEqual(filter.deny.sort(), ['bash', 'blender_render', 'pwsh'].sort())
})

test('each project kind recommends skills that are resolved without inventing any', async () => {
  const { recommendedSkillsFor } = await import('../profiles.js')
  assert.ok(recommendedSkillsFor(resolveProjectProfile('software')).includes('create-implementation-plan'))
  assert.deepEqual(recommendedSkillsFor(resolveProjectProfile('copy')), ['documentation-writer'])
  assert.deepEqual(recommendedSkillsFor(resolveProjectProfile('custom')), [])
  assert.deepEqual(recommendedSkillsFor(null), [])
})
