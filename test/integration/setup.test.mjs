import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync, readFileSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dirname, '..', '..', 'bin', 'curtain')

function fresh() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-setup-i-')))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

test('detect finds a Makefile dev target and writes nothing', async () => {
  const dir = fresh()
  try {
    writeFileSync(join(dir, 'Makefile'), 'admin-dev:\n\techo starting\n')
    const d = JSON.parse(execFileSync(CLI, ['setup', 'detect', '--json'], { cwd: dir, encoding: 'utf8' }))
    assert.equal(d.candidates.length, 1)
    assert.equal(d.candidates[0].start, 'make admin-dev')
    assert.equal(d.candidates[0].app, 'admin')
    assert.throws(() => readFileSync(join(dir, 'curtain.json')), 'detect is read-only')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply reads a config from stdin, then resolve confirms it', async () => {
  const dir = fresh()
  try {
    const config = JSON.stringify({ apps: { admin: { start: 'echo hi', ready: 'hi' } } })
    execFileSync(CLI, ['setup', 'apply', '--config', '-'], { cwd: dir, input: config, encoding: 'utf8' })
    assert.match(readFileSync(join(dir, 'curtain.json'), 'utf8'), /echo hi/)
    assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\.curtain\//)

    const r = JSON.parse(execFileSync(CLI, ['resolve', '--json'], { cwd: dir, encoding: 'utf8' }))
    assert.equal(r.configured, true)
    assert.ok(!r.problems.some((p) => p.code === 'NO_CONFIG'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply rejects an app with no start command and exits 1', async () => {
  const dir = fresh()
  try {
    assert.throws(() => execFileSync(CLI, ['setup', 'apply', '--config', '-'], {
      cwd: dir, input: JSON.stringify({ apps: { admin: {} } }), encoding: 'utf8', stdio: 'pipe',
    }), (err) => {
      assert.equal(err.status, 1)
      assert.match(err.stderr, /start/)
      return true
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply refuses to clobber an existing config without --force', async () => {
  const dir = fresh()
  try {
    const config = JSON.stringify({ apps: { admin: { start: 'echo hi' } } })
    execFileSync(CLI, ['setup', 'apply', '--config', '-'], { cwd: dir, input: config, encoding: 'utf8' })
    assert.throws(() => execFileSync(CLI, ['setup', 'apply', '--config', '-'], {
      cwd: dir, input: config, encoding: 'utf8', stdio: 'pipe',
    }), (err) => {
      assert.equal(err.status, 1)
      assert.match(err.stderr, /already exists/)
      return true
    })
    execFileSync(CLI, ['setup', 'apply', '--config', '-', '--force'], {
      cwd: dir, input: JSON.stringify({ apps: { other: { start: 'echo other' } } }), encoding: 'utf8',
    })
    assert.match(readFileSync(join(dir, 'curtain.json'), 'utf8'), /echo other/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unknown setup subcommand exits 2 and prints usage', async () => {
  const dir = fresh()
  try {
    assert.throws(() => execFileSync(CLI, ['setup', 'wat'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
      (err) => {
        assert.equal(err.status, 2)
        assert.match(err.stderr, /unknown subcommand/)
        return true
      })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
