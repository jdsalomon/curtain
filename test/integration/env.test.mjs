// The release's whole story, end to end: an app that cannot boot without
// configuration, a checkout that has none, and the path from "refused with the
// cause named" to "a fresh worktree starts itself".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, unlinkSync,
  lstatSync, realpathSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { up } from '../../lib/up.mjs'
import { down } from '../../lib/down.mjs'
import { adopt } from '../../lib/envfiles.mjs'

const FIXTURE = join(import.meta.dirname, '..', '..', 'fixture')

/** A real git repo whose only app is the fixture's vip role, which exits
 *  unless --env-file hands it VIP_CODE. Store redirected to a throwaway XDG. */
function scene(fn) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-envint-')))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  copyFileSync(join(FIXTURE, 'app.mjs'), join(repo, 'app.mjs'))
  writeFileSync(join(repo, 'curtain.json'), JSON.stringify({
    name: 'curtain-envint',
    apps: {
      vip: {
        start: 'node --env-file=.env.local app.mjs vip',
        ready: 'curtain-fixture ready',
        env: ['.env.local'],
      },
    },
  }))
  writeFileSync(join(repo, '.env.example'), 'VIP_CODE=\n')
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(base, 'xdg')
  return (async () => {
    try {
      return await fn(repo, base)
    } finally {
      await down({ cwd: repo }).catch(() => {})
      if (before === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = before
      rmSync(base, { recursive: true, force: true })
    }
  })()
}

test('up refuses an app whose values exist nowhere, naming the file', async () => {
  await scene(async (repo) => {
    const r = await up({ cwd: repo })
    assert.equal(r.exitCode, 1)
    assert.deepEqual(r.started, {}, 'the app must not be started to crash')
    const p = r.problems.find((x) => x.code === 'NO_ENV_VALUES')
    assert.equal(p.app, 'vip')
    assert.equal(p.file, '.env.local')
    assert.match(p.fix, /curtain env adopt/)
  })
})

test('after adopt, a fresh worktree is repaired and started by up alone', async () => {
  await scene(async (repo) => {
    // The interview happened: the agent wrote the values, then adopted them.
    writeFileSync(join(repo, '.env.local'), 'VIP_CODE=k-42\n')
    const config = JSON.parse(readFileSync(join(repo, 'curtain.json'), 'utf8'))
    const a = adopt({ configDir: repo, config })
    assert.equal(a.adopted.length, 1)

    // Simulate the fresh worktree: the gitignored link did not travel.
    unlinkSync(join(repo, '.env.local'))

    const r = await up({ cwd: repo })
    assert.deepEqual(r.linkedEnv, [{ app: 'vip', file: '.env.local' }],
      'up must repair the missing link itself')
    assert.ok(r.started.vip, `vip should have started: ${JSON.stringify(r.problems)}`)
    assert.ok(lstatSync(join(repo, '.env.local')).isSymbolicLink())

    // The server is really up, configured through the link.
    const res = await fetch(r.started.vip.url)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /vip/)

    const d = await down({ cwd: repo })
    assert.ok(d.stopped.vip, 'and it is ours to stop')
  })
})
