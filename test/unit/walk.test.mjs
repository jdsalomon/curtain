import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listWalks, viewportOf, walksDir, VIEWPORTS, walk } from '../../lib/walk.mjs'
import { writeRunfile } from '../../lib/runfile.mjs'
import { fakeGit, fakeProbe } from '../helpers/fakes.mjs'

const CONFIG = { apps: { admin: { start: 'node app.mjs admin', ready: 'ready' } } }

/** A repo with curtain.json and any number of walk files already written. */
function repo(walks = {}, config = CONFIG) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-walk-')))
  if (config) writeFileSync(join(dir, 'curtain.json'), JSON.stringify(config))
  if (Object.keys(walks).length) mkdirSync(walksDir(dir), { recursive: true })
  for (const [name, body] of Object.entries(walks)) {
    writeFileSync(join(walksDir(dir), `${name}.mjs`), body)
  }
  return dir
}

const git = (root) => fakeGit({
  'rev-parse --show-toplevel': root,
  'rev-parse --absolute-git-dir': join(root, '.git'),
  'rev-parse --path-format=absolute --git-common-dir': join(root, '.git'),
  'rev-parse --abbrev-ref HEAD': 'main',
})

/** io for a repo where `admin` is live at `url`. */
const liveAt = (dir, url) => ({
  git: git(dir),
  probe: fakeProbe({ [url]: { ok: true, status: 200 } }),
  listeners: () => ({ items: [], problems: [] }),
})

const claim = (dir, url, port) => writeRunfile(dir, {
  admin: { app: 'admin', pid: process.pid, url, port, ready: true },
})

const run = (dir, name, opts = {}) => walk(name, { cwd: dir, ...opts })

test('a leading underscore keeps a scratch probe off the list but on disk', () => {
  const dir = repo({ 'add-item': 'export default async () => {}', _probe: 'export default async () => {}' })
  try {
    assert.deepEqual(listWalks(dir), ['add-item'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('walks come back sorted, and a project with no walks dir is empty not broken', () => {
  const dir = repo({ zebra: 'export default async () => {}', alpha: 'export default async () => {}' })
  const bare = repo({})
  try {
    assert.deepEqual(listWalks(dir), ['alpha', 'zebra'])
    assert.deepEqual(listWalks(bare), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bare, { recursive: true, force: true })
  }
})

test('a viewport is a name, an explicit size, or the phone default', () => {
  assert.deepEqual(viewportOf({ viewport: 'desktop' }), VIEWPORTS.desktop)
  assert.deepEqual(viewportOf({ viewport: { width: 300, height: 300 } }), { width: 300, height: 300 })
  assert.deepEqual(viewportOf({}), VIEWPORTS.phone)
  assert.deepEqual(viewportOf(), VIEWPORTS.phone)
})

test('an unknown viewport name records at phone size rather than throwing', () => {
  // A typo should cost you the right size, not the whole recording.
  assert.deepEqual(viewportOf({ viewport: 'phablet' }), VIEWPORTS.phone)
})

test('an unconfigured repo is refused before anything is launched', async () => {
  const dir = repo({}, null)
  try {
    const r = await run(dir, 'anything', { io: { git: git(dir), listeners: () => ({ items: [], problems: [] }) } })
    assert.equal(r.passed, false)
    assert.equal(r.exitCode, 1)
    assert.equal(r.problems[0].code, 'NO_CONFIG')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a missing walk names the ones that do exist', async () => {
  const dir = repo({ 'add-item': 'export default async () => {}' })
  try {
    const r = await run(dir, 'nope', { io: liveAt(dir, 'http://localhost:4000') })
    assert.equal(r.problems[0].code, 'NO_SUCH_WALK')
    assert.deepEqual(r.available, ['add-item'])
    assert.match(r.problems[0].fix, /add-item/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a walk file with no default export is reported, not imported and hoped over', async () => {
  const dir = repo({ half: 'export const meta = { target: "admin" }' })
  try {
    const r = await run(dir, 'half', { io: liveAt(dir, 'http://localhost:4000') })
    assert.equal(r.problems[0].code, 'NO_SUCH_WALK')
    assert.match(r.problems[0].fix, /default async function/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a walk whose target app is not running says which app to start', async () => {
  const dir = repo({ w: 'export const meta = { target: "admin" }\nexport default async () => {}' })
  try {
    const r = await run(dir, 'w', { io: { git: git(dir), listeners: () => ({ items: [], problems: [] }) } })
    assert.equal(r.problems.at(-1).code, 'NOT_RUNNING')
    assert.match(r.problems.at(-1).fix, /curtain up admin/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a target that is not local is refused, because a walk mutates data', async () => {
  const url = 'https://admin.example.com'
  const dir = repo({ w: 'export const meta = { target: "admin" }\nexport default async () => {}' })
  try {
    claim(dir, url, 443)
    const r = await run(dir, 'w', { io: liveAt(dir, url) })
    assert.equal(r.passed, false)
    assert.equal(r.env, 'prod')
    const p = r.problems.find((x) => x.code === 'TARGET_NOT_LOCAL')
    assert.ok(p, 'a remote target must be refused')
    assert.match(p.fix, /--force/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the refusal is what --force is for, so forcing gets past it', async () => {
  // It then fails on the browser instead, which is the next gate and proves the
  // rail was the only thing standing in the way.
  const url = 'https://admin.example.com'
  const dir = repo({ w: 'export const meta = { target: "admin" }\nexport default async () => {}' })
  try {
    claim(dir, url, 443)
    const r = await run(dir, 'w', { force: true, io: liveAt(dir, url) })
    assert.ok(!r.problems.some((p) => p.code === 'TARGET_NOT_LOCAL'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a walk that declares a seed fails before the browser when the seed fails', async () => {
  // The order matters: a broken seed must not produce a recording of the wrong
  // data. Chromium is never reached here, which is why this runs without one.
  const dir = repo({ w: 'export const meta = { target: "admin", seed: "bad" }\nexport default async () => {}' })
  try {
    mkdirSync(join(dir, 'curtain', 'seeds'), { recursive: true })
    writeFileSync(join(dir, 'curtain', 'seeds', 'bad.mjs'),
      'export default async ({ run }) => run("definitely-not-a-command")')
    claim(dir, 'http://localhost:4000', 4000)
    const r = await run(dir, 'w', { io: liveAt(dir, 'http://localhost:4000') })
    assert.equal(r.passed, false)
    assert.equal(r.problems.at(-1).code, 'SEED_FAILED')
    assert.equal(r.artifacts, null, 'no artifact directory is even created')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a walk that names a seed which does not exist says so', async () => {
  const dir = repo({ w: 'export const meta = { target: "admin", seed: "ghost" }\nexport default async () => {}' })
  try {
    claim(dir, 'http://localhost:4000', 4000)
    const r = await run(dir, 'w', { io: liveAt(dir, 'http://localhost:4000') })
    assert.equal(r.problems.at(-1).code, 'NO_SUCH_SEED')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// v0.5.2. The failure this closes was observed in the wild: a fresh worktree
// answered 500 on every route because nothing had been installed or built, and
// the walk recorded a video of a broken app before timing out inside it.
test('a walk refuses to film a server that answers without its fingerprint', async () => {
  const url = 'http://localhost:4300'
  const dir = repo({ show: 'export default async () => {}' }, {
    apps: {
      admin: {
        start: 'x',
        ready: 'ready',
        fingerprint: { path: '/login', expect: 'type="password"' },
      },
    },
  })
  try {
    claim(dir, url, 4300)
    const r = await walk('show', {
      cwd: dir,
      io: { ...liveAt(dir, url), matchFingerprint: async () => false },
    })
    assert.equal(r.passed, false)
    assert.equal(r.exitCode, 1)
    assert.equal(r.problems[0].code, 'UNHEALTHY', 'the reason must be the health, not a timeout')
    assert.equal(r.problems[0].app, 'admin')
    assert.equal(r.artifacts, null, 'nothing is recorded, so no stale mp4 is replaced')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
