import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from '../../lib/resolve.mjs'
import { writeRunfile } from '../../lib/runfile.mjs'
import { fakeGit, fakeProbe } from '../helpers/fakes.mjs'

function repo(config) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-res-')))
  if (config) writeFileSync(join(dir, 'curtain.json'), JSON.stringify(config))
  return dir
}
const git = (root) => fakeGit({
  'rev-parse --show-toplevel': root,
  'rev-parse --absolute-git-dir': join(root, '.git'),
  'rev-parse --path-format=absolute --git-common-dir': join(root, '.git'),
  'rev-parse --abbrev-ref HEAD': 'main',
})
const CONFIG = { apps: { admin: { start: 'node app.mjs admin', ready: 'ready' } } }

test('an unconfigured repo reports NO_CONFIG with a fix and does not throw', async () => {
  const dir = repo(null)
  try {
    const r = await resolve({ cwd: dir, io: { git: git(dir), listeners: () => ({ items: [], problems: [] }) } })
    assert.equal(r.configured, false)
    const p = r.problems.find((x) => x.code === 'NO_CONFIG')
    assert.ok(p, 'NO_CONFIG must be present')
    assert.match(p.fix, /curtain setup/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a configured app with nothing running reports NOT_RUNNING per app', async () => {
  const dir = repo(CONFIG)
  try {
    const r = await resolve({ cwd: dir, io: { git: git(dir), listeners: () => ({ items: [], problems: [] }) } })
    assert.deepEqual(Object.keys(r.services), [])
    const p = r.problems.find((x) => x.code === 'NOT_RUNNING')
    assert.equal(p.app, 'admin')
    assert.match(p.fix, /curtain up admin/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a verified runfile entry becomes a live service tagged runfile', async () => {
  const dir = repo(CONFIG)
  try {
    writeRunfile(dir, {
      admin: { app: 'admin', pid: process.pid, url: 'http://localhost:4000', port: 4000, ready: true },
    })
    const r = await resolve({
      cwd: dir,
      io: {
        git: git(dir),
        probe: fakeProbe({ 'http://localhost:4000': { ok: true, status: 200 } }),
        listeners: () => ({ items: [], problems: [] }),
      },
    })
    assert.equal(r.services.admin.port, 4000)
    assert.equal(r.services.admin.source, 'runfile')
    assert.equal(r.problems.find((x) => x.code === 'NOT_RUNNING'), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a listening but silent claimed app is NOT_ANSWERING, not live', async () => {
  const dir = repo(CONFIG)
  try {
    writeRunfile(dir, {
      admin: { app: 'admin', pid: process.pid, url: 'http://localhost:4000', port: 4000, ready: true },
    })
    const r = await resolve({
      cwd: dir,
      io: { git: git(dir), probe: fakeProbe({}), listeners: () => ({ items: [], problems: [] }) },
    })
    assert.deepEqual(Object.keys(r.services), [])
    const p = r.problems.find((x) => x.code === 'NOT_ANSWERING')
    assert.equal(p.app, 'admin')
    assert.equal(p.port, 4000)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a foreign listener is listed with its owner and never adopted', async () => {
  const dir = repo(CONFIG)
  try {
    const r = await resolve({
      cwd: dir,
      io: {
        git: git(dir),
        listeners: () => ({
          items: [{ pid: 99, command: 'node', port: 3003, kind: 'foreign', owner: 'other-checkout' }],
          problems: [],
        }),
      },
    })
    assert.deepEqual(Object.keys(r.services), [])
    assert.equal(r.foreign.length, 1)
    assert.equal(r.foreign[0].owner, 'other-checkout')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unclaimed listener is reported with the fingerprint suggestion', async () => {
  const dir = repo(CONFIG)
  try {
    const r = await resolve({
      cwd: dir,
      io: {
        git: git(dir),
        listeners: () => ({ items: [{ pid: 8123, command: 'Python', port: 3055, kind: 'unclaimed' }], problems: [] }),
      },
    })
    assert.equal(r.unclaimed.length, 1)
    const p = r.problems.find((x) => x.code === 'UNCLAIMED_SERVER')
    assert.equal(p.port, 3055)
    assert.match(p.fix, /fingerprint/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a mine listener the runfile forgot is adopted only via a matching fingerprint', async () => {
  const dir = repo({
    apps: { admin: { start: 'x', fingerprint: { path: '/login', expect: 'password' } } },
  })
  try {
    const r = await resolve({
      cwd: dir,
      io: {
        git: git(dir),
        listeners: () => ({ items: [{ pid: 5, command: 'node', port: 3002, kind: 'mine' }], problems: [] }),
        matchFingerprint: async (url) => url === 'http://localhost:3002',
      },
    })
    assert.equal(r.services.admin.port, 3002)
    assert.equal(r.services.admin.source, 'fingerprint')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a mine listener with no fingerprint configured stays unattributed', async () => {
  const dir = repo(CONFIG)
  try {
    const r = await resolve({
      cwd: dir,
      io: {
        git: git(dir),
        listeners: () => ({ items: [{ pid: 5, command: 'node', port: 3002, kind: 'mine' }], problems: [] }),
      },
    })
    assert.deepEqual(Object.keys(r.services), [], 'without a fingerprint we do not guess which app it is')
    assert.equal(r.unclaimed.length, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('env is local by default and classified from an explicit target', async () => {
  const dir = repo({ ...CONFIG, envs: { preview: '*.vercel.app', prod: 'example.com' } })
  try {
    const io = { git: git(dir), listeners: () => ({ items: [], problems: [] }) }
    assert.equal((await resolve({ cwd: dir, io })).env, 'local')
    assert.equal((await resolve({ cwd: dir, target: 'https://x.vercel.app', io })).env, 'preview')
    assert.equal((await resolve({ cwd: dir, target: 'https://example.com', io })).env, 'prod')
    assert.equal((await resolve({ cwd: dir, target: 'https://who.knows', io })).env, 'prod')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the artifacts root is the state directory and nothing is written', async () => {
  const dir = repo(CONFIG)
  try {
    const r = await resolve({ cwd: dir, io: { git: git(dir), listeners: () => ({ items: [], problems: [] }) } })
    assert.equal(r.artifacts.root, join(dir, '.curtain'))
    assert.throws(() => rmSync(join(dir, '.curtain'), { recursive: true }),
      'resolve must not have created the state directory')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
