import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { playwrightCandidates, loadChromium, BROWSER_CACHE } from '../../lib/browser.mjs'

const withEnv = (value, fn) => {
  const had = Object.hasOwn(process.env, 'CURTAIN_PLAYWRIGHT')
  const before = process.env.CURTAIN_PLAYWRIGHT
  if (value === null) delete process.env.CURTAIN_PLAYWRIGHT
  else process.env.CURTAIN_PLAYWRIGHT = value
  try {
    return fn()
  } finally {
    if (had) process.env.CURTAIN_PLAYWRIGHT = before
    else delete process.env.CURTAIN_PLAYWRIGHT
  }
}

test('the search order is override, then project, then plugin, then shared cache', () => {
  const order = withEnv('/tmp/explicit', () => playwrightCandidates('/repo'))
  assert.equal(order[0], '/tmp/explicit', 'an explicit override must win')
  assert.equal(order[1], '/repo', 'the project beats the plugin')
  assert.equal(order.at(-1), BROWSER_CACHE, 'the shared cache is the last resort')
})

test('with no override the project is searched first', () => {
  const order = withEnv(null, () => playwrightCandidates('/repo'))
  assert.equal(order[0], '/repo')
  assert.ok(!order.includes(undefined))
})

test('a candidate is never searched twice', () => {
  // The plugin directory is also the project when Curtain is developed on itself,
  // and a duplicated entry would report the same failed lookup twice.
  const order = withEnv(null, () => playwrightCandidates(BROWSER_CACHE))
  assert.equal(new Set(order).size, order.length)
})

test('no install anywhere is a problem with a fix, never a throw', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'curtain-nopw-'))
  try {
    const r = await loadChromium({ candidates: [empty] })
    assert.equal(r.chromium, undefined)
    assert.equal(r.problem.code, 'MISSING_CHROMIUM')
    // The fix must offer the path that costs the project nothing, first: adding
    // a browser to the repo's own manifest is a dependency review question.
    assert.match(r.problem.fix, /curtain setup browser/)
    assert.match(r.problem.fix, /\.cache/, 'and name the shared cache it will use')
    assert.deepEqual(r.problem.searched, [empty], 'the failure says where it looked')
  } finally { rmSync(empty, { recursive: true, force: true }) }
})
