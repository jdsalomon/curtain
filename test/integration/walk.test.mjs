// The only test that records for real. It proves the artifact rule end to end:
// a passing walk writes an mp4, a failing one never does.
//
// It needs Playwright and a browser binary, which the CI image does not carry and
// which nobody should have to install to change a line of resolver code. So it
// skips itself with a reason rather than failing, and the reason is printed: a
// silently skipped test is indistinguishable from a passing one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, cpSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { walk, walksDir } from '../../lib/walk.mjs'
import { writeRunfile } from '../../lib/runfile.mjs'
import { loadChromium, chromiumInstalled } from '../../lib/browser.mjs'

const FIXTURE = join(import.meta.dirname, '..', '..', 'fixture')

/** A private items file per app instance: test files run in parallel, and a
 *  shared store made them overwrite each other's data. */
let storeSeq = 0
const store = () => join(tmpdir(), `curtain-items-${process.pid}-${storeSeq++}.json`)

/**
 * Why this file cannot run here, or `false` when it can.
 *
 * `false`, not `null`: node:test skips on the *presence* of a truthy-or-nullish
 * skip value, so `{ skip: null }` silently skips while `{ skip: false }` runs.
 * Returning null here once made every test below skip everywhere while the suite
 * still reported green, which is the exact hazard this file is meant to catch.
 */
async function skipReason() {
  const { chromium, problem } = await loadChromium({ root: process.cwd() })
  if (problem) return 'no playwright install found (set CURTAIN_PLAYWRIGHT to one)'
  if (!chromiumInstalled(chromium)) return 'playwright is present but its chromium is not installed'
  return false
}
const skip = await skipReason()

/** A throwaway repo whose `admin` app is a live fixture server. */
async function stagedRepo(walks, fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-rec-')))
  writeFileSync(join(dir, 'curtain.json'), JSON.stringify({ apps: { admin: { start: 'x' } } }))
  mkdirSync(walksDir(dir), { recursive: true })
  for (const [name, body] of Object.entries(walks)) {
    writeFileSync(join(walksDir(dir), `${name}.mjs`), body)
  }
  execFileSync('git', ['init', '-q'], { cwd: dir })

  const child = spawn(process.execPath, ['app.mjs', 'admin'], { cwd: FIXTURE, env: { ...process.env, FIXTURE_STORE: store() } })
  let out = ''
  const live = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d
      const m = /http:\/\/localhost:(\d+)/.exec(out)
      if (m) resolve({ url: m[0], port: Number(m[1]) })
    })
    setTimeout(() => reject(new Error(`fixture never announced: ${out}`)), 8000).unref()
  })
  writeRunfile(dir, {
    admin: { app: 'admin', pid: child.pid, url: live.url, port: live.port, ready: true },
  })
  try {
    return await fn(dir, live)
  } finally {
    child.kill('SIGKILL')
    await once(child, 'exit')
    rmSync(dir, { recursive: true, force: true })
  }
}

const PASSING = `
export const meta = { target: 'admin', viewport: 'phone' }
export default async function ({ page, url, click, sleep }) {
  await page.goto(url('/'))
  await click(page.getByRole('button', { name: 'Add an item' }))
  await page.locator('.card.saved').waitFor({ timeout: 5000 })
  await sleep(300)
}
export async function cleanup({ request, url }) { await request.delete(url('/items')) }
`

const FAILING = `
export const meta = { target: 'admin', viewport: 'phone', timeout: 1500 }
export default async function ({ page, url, click }) {
  await page.goto(url('/'))
  await click(page.getByRole('button', { name: 'no such button' }))
}
export async function cleanup({ request, url }) { await request.delete(url('/items')) }
`

test('a passing walk records an mp4 and reverses what it created', { skip }, async () => {
  await stagedRepo({ good: PASSING }, async (dir, live) => {
    const r = await walk('good', { cwd: dir })
    assert.equal(r.passed, true, JSON.stringify(r.problems))
    assert.equal(r.exitCode, 0)
    assert.ok(existsSync(r.artifacts.mp4), 'a passing run must leave an mp4')
    assert.ok(existsSync(r.artifacts.video), 'the raw webm is kept too')
    assert.equal(r.target.url, live.url, 'the resolver supplied the port, not the walk')

    const items = await (await fetch(`${live.url}/items`)).json()
    assert.deepEqual(items, [], 'cleanup must reverse what the walk created')
  })
})

test('a failing walk keeps its webm and produces no mp4', { skip }, async () => {
  await stagedRepo({ bad: FAILING }, async (dir) => {
    const r = await walk('bad', { cwd: dir })
    assert.equal(r.passed, false)
    assert.equal(r.exitCode, 1)
    assert.equal(r.artifacts.mp4, null, 'a failed run must not produce a shareable file')
    assert.ok(existsSync(r.artifacts.video), 'the frames before the failure are kept')
    assert.equal(r.problems[0].code, 'WALK_FAILED')
    assert.ok(!/\[/.test(r.problems[0].message), 'the message must carry no ANSI escapes')
  })
})

test('a stale passing artifact cannot survive a later failure', { skip }, async () => {
  // The invariant that makes "a clean video is a passing test" true: the artifact
  // directory is wiped before recording, so yesterday's mp4 cannot be mistaken for
  // today's pass.
  await stagedRepo({ good: PASSING, bad: FAILING }, async (dir) => {
    const pass = await walk('good', { cwd: dir })
    assert.ok(existsSync(pass.artifacts.mp4))

    const planted = join(dir, '.curtain', 'walks', 'bad')
    mkdirSync(planted, { recursive: true })
    cpSync(pass.artifacts.mp4, join(planted, 'bad.mp4'))
    assert.ok(existsSync(join(planted, 'bad.mp4')))

    const fail = await walk('bad', { cwd: dir })
    assert.equal(fail.passed, false)
    assert.ok(!existsSync(join(planted, 'bad.mp4')), 'the planted mp4 must be gone')
  })
})

if (skip) console.log(`# walk recording tests skipped: ${skip}`)
