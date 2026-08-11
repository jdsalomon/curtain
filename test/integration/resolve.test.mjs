import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { sandbox } from '../helpers/sandbox.mjs'

const CLI = join(import.meta.dirname, '..', '..', 'bin', 'curtain')

function curtain(args, cwd) {
  return execFileSync(CLI, args, { cwd, encoding: 'utf8' })
}

test('resolve --json in the fixture describes a configured workspace', async () => {
  await sandbox(async (dir) => {
    const r = JSON.parse(curtain(['resolve', '--json'], dir))
    assert.equal(r.workspace.root, dir)
    assert.equal(r.workspace.kind, 'main')
    assert.equal(r.configured, true)
    assert.deepEqual(Object.keys(r.config.apps).sort(), ['admin', 'guest'])
    assert.equal(r.artifacts.root, join(dir, '.curtain'))
    assert.deepEqual(
      r.problems.filter((p) => p.code === 'NOT_RUNNING').map((p) => p.app).sort(),
      ['admin', 'guest'],
    )
  })
})

test('resolve outside a configured repo reports NO_CONFIG and still exits 0', async () => {
  const r = JSON.parse(curtain(['resolve', '--json'], '/tmp'))
  assert.equal(r.configured, false)
  assert.ok(r.problems.some((p) => p.code === 'NO_CONFIG'))
})

test('resolve is read-only: it creates no state directory', async () => {
  await sandbox(async (dir) => {
    curtain(['resolve', '--json'], dir)
    assert.equal(existsSync(join(dir, '.curtain')), false)
  })
})

test('the human rendering names the workspace and the problems', async () => {
  await sandbox(async (dir) => {
    const text = curtain(['resolve'], dir)
    assert.match(text, /^workspace {2}/m)
    assert.match(text, /problems/)
    assert.match(text, /NOT_RUNNING admin/)
    assert.doesNotMatch(text, /—/, 'no em dashes in user-facing output')
  })
})
