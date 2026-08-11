import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { sandbox } from '../helpers/sandbox.mjs'

const CLI = join(import.meta.dirname, '..', '..', 'bin', 'curtain')

function curtain(args, cwd) {
  try {
    return { status: 0, out: execFileSync(CLI, args, { cwd, encoding: 'utf8' }) }
  } catch (err) {
    return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

test('nothing running is not a blocked state: doctor exits 0', async () => {
  await sandbox(async (dir) => {
    const { status, out } = curtain(['doctor'], dir)
    assert.equal(status, 0, 'NOT_RUNNING must never block, or /up could never run')
    assert.match(out, /ready/)
    assert.match(out, /NOT_RUNNING/)
  })
})

test('an unconfigured directory blocks and points at setup', async () => {
  const { status, out } = curtain(['doctor'], '/tmp')
  assert.equal(status, 1)
  assert.match(out, /NO_CONFIG/)
  assert.match(out, /curtain setup/)
  assert.match(out, /blocked/)
})

test('doctor --json carries the debt report and the exit code', async () => {
  await sandbox(async (dir) => {
    const { out } = curtain(['doctor', '--json'], dir)
    const r = JSON.parse(out)
    assert.ok('debt' in r)
    assert.ok(Array.isArray(r.debt.unclaimedServers))
    assert.equal(r.exitCode, 0)
  })
})

test('an unknown command exits 2, distinct from a blocked phase', async () => {
  const { status, out } = curtain(['nope'], '/tmp')
  assert.equal(status, 2)
  assert.match(out, /unknown command/)
})
