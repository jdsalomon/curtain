import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deepMerge, findUp, loadConfig, CONFIG_NAME, LOCAL_NAME } from '../../lib/config.mjs'

function tree(files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-cfg-')))
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body))
  }
  return dir
}

test('objects merge recursively and local wins', () => {
  const merged = deepMerge(
    { apps: { admin: { start: 'make admin', ready: 'Ready in' }, guest: { start: 'make guest' } } },
    { apps: { admin: { start: 'pnpm dev:admin' } } },
  )
  assert.equal(merged.apps.admin.start, 'pnpm dev:admin')
  assert.equal(merged.apps.admin.ready, 'Ready in', 'untouched sibling keys survive')
  assert.equal(merged.apps.guest.start, 'make guest', 'untouched apps survive')
})

test('arrays replace rather than concatenate', () => {
  const merged = deepMerge({ mutating: ['/api/a'] }, { mutating: ['/api/b'] })
  assert.deepEqual(merged.mutating, ['/api/b'], 'an override must be able to shrink a list')
})

test('an explicit null in the override wins', () => {
  assert.equal(deepMerge({ a: { b: 1 } }, { a: null }).a, null)
})

test('findUp walks up and stops at the root', () => {
  const dir = tree({ [CONFIG_NAME]: { apps: {} }, 'apps/admin/.keep': '' })
  try {
    assert.equal(findUp(CONFIG_NAME, join(dir, 'apps', 'admin'), dir), join(dir, CONFIG_NAME))
    assert.equal(findUp('nope.json', join(dir, 'apps', 'admin'), dir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findUp does not escape above the stop directory', () => {
  const outer = tree({ [CONFIG_NAME]: { apps: { outer: {} } } })
  try {
    mkdirSync(join(outer, 'inner'), { recursive: true })
    assert.equal(findUp(CONFIG_NAME, join(outer, 'inner'), join(outer, 'inner')), null)
  } finally {
    rmSync(outer, { recursive: true, force: true })
  }
})

test('loadConfig merges the local override and records both sources', () => {
  const dir = tree({
    [CONFIG_NAME]: { apps: { admin: { start: 'make admin-dev', ready: 'Ready in' } } },
    [LOCAL_NAME]: { apps: { admin: { start: 'pnpm dev' } } },
  })
  try {
    const r = loadConfig(dir, dir)
    assert.equal(r.configured, true)
    assert.equal(r.config.apps.admin.start, 'pnpm dev')
    assert.equal(r.config.apps.admin.ready, 'Ready in')
    assert.equal(r.dir, dir)
    assert.deepEqual(r.sources, [join(dir, CONFIG_NAME), join(dir, LOCAL_NAME)])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no config is a reportable state, not a throw', () => {
  const dir = tree({ 'package.json': { name: 'x' } })
  try {
    const r = loadConfig(dir, dir)
    assert.equal(r.configured, false)
    assert.deepEqual(r.config, {})
    assert.equal(r.dir, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed json names the file it could not parse', () => {
  const dir = tree({ [CONFIG_NAME]: '{ this is not json' })
  try {
    assert.throws(() => loadConfig(dir, dir), (err) => {
      assert.match(err.message, /curtain\.json/)
      assert.ok(err.message.includes(dir), 'the absolute path must be in the message')
      return true
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
