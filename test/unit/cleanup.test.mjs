import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, inventory, measure, humanBytes } from '../../lib/cleanup.mjs'
import { fakeGit } from '../helpers/fakes.mjs'

const CONFIG = { name: 'proj', apps: { admin: { start: 'x' } } }

/** A workspace with recordings, logs, and a seed that has already run. */
function scene({ seedBody, recorded = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-clean-')))
  writeFileSync(join(dir, 'curtain.json'), JSON.stringify(CONFIG))

  mkdirSync(join(dir, '.curtain', 'walks', 'demo'), { recursive: true })
  writeFileSync(join(dir, '.curtain', 'walks', 'demo', 'demo.mp4'), 'x'.repeat(2048))
  mkdirSync(join(dir, '.curtain', 'logs'), { recursive: true })
  writeFileSync(join(dir, '.curtain', 'logs', 'admin.log'), 'hello\n')

  if (seedBody) {
    mkdirSync(join(dir, 'curtain', 'seeds'), { recursive: true })
    writeFileSync(join(dir, 'curtain', 'seeds', 'full.mjs'), seedBody)
  }
  if (recorded) {
    mkdirSync(join(dir, '.curtain', 'seeds'), { recursive: true })
    writeFileSync(join(dir, '.curtain', 'seeds', 'full.json'), JSON.stringify({ slug: 'abc' }))
  }
  return dir
}

const git = (root) => fakeGit({
  'rev-parse --show-toplevel': root,
  'rev-parse --absolute-git-dir': join(root, '.git'),
  'rev-parse --path-format=absolute --git-common-dir': join(root, '.git'),
  'rev-parse --abbrev-ref HEAD': 'main',
})

const UNDOABLE = `
export default async () => ({ slug: 'abc' })
export async function cleanup({ run }) { run('unprovision') }
`
const NO_TEARDOWN = `export default async () => ({ slug: 'abc' })`

test('bytes and files are counted, and rendered for humans', () => {
  const dir = scene()
  try {
    const m = measure(join(dir, '.curtain', 'walks'))
    assert.equal(m.files, 1)
    assert.equal(m.bytes, 2048)
    assert.equal(humanBytes(2048), '2.0 KB')
    assert.equal(humanBytes(900), '900 B')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the inventory measures without writing anything', () => {
  const dir = scene({ seedBody: UNDOABLE })
  try {
    const inv = inventory({ cwd: dir, io: { git: git(dir) } })
    assert.deepEqual(inv.artifacts.map((a) => a.kind).sort(), ['log', 'recording'])
    assert.equal(inv.bytes, 2048 + 6)
    assert.deepEqual(inv.data.map((d) => d.seed), ['full'])
    assert.ok(existsSync(join(dir, '.curtain', 'walks', 'demo', 'demo.mp4')), 'still there')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a bare run deletes nothing at all', async () => {
  const dir = scene({ seedBody: UNDOABLE })
  try {
    const r = await cleanup({ cwd: dir, io: { git: git(dir) } })
    assert.equal(r.dryRun, true)
    assert.equal(r.exitCode, 0)
    assert.deepEqual(r.removed, [])
    assert.ok(existsSync(join(dir, '.curtain', 'walks', 'demo', 'demo.mp4')))
    assert.ok(existsSync(join(dir, '.curtain', 'seeds', 'full.json')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a dry run never calls a host teardown, so the preview cannot lie', async () => {
  // The safety of a preview must not depend on someone else's script honouring
  // a dryRun flag: a teardown that ignored one would delete for real.
  const dir = scene({ seedBody: UNDOABLE })
  const calls = []
  try {
    await cleanup({ cwd: dir, io: { git: git(dir), exec: (c) => { calls.push(c); return '' } } })
    assert.deepEqual(calls, [], 'nothing was executed')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('with --yes the seed undoes itself and its record is dropped', async () => {
  const dir = scene({ seedBody: UNDOABLE })
  const calls = []
  try {
    const r = await cleanup({ cwd: dir, yes: true, io: { git: git(dir), exec: (c) => { calls.push(c); return '' } } })
    assert.equal(r.exitCode, 0)
    assert.deepEqual(calls, ['unprovision'], 'the host teardown ran verbatim')
    assert.ok(r.removed.some((x) => x.kind === 'data' && x.name === 'full'))
    assert.ok(!existsSync(join(dir, '.curtain', 'seeds', 'full.json')))
    assert.ok(!existsSync(join(dir, '.curtain', 'walks', 'demo')), 'artifacts go too')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a seed with no cleanup export is never offered as undoable', async () => {
  const dir = scene({ seedBody: NO_TEARDOWN })
  try {
    const r = await cleanup({ cwd: dir, io: { git: git(dir) } })
    assert.deepEqual(r.data, [], 'it made data it cannot unmake, and says nothing false about it')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a seed this workspace never ran is not a candidate', async () => {
  // The record is what proves this checkout made the data; without it, cleanup
  // could reach another worktree's rows.
  const dir = scene({ seedBody: UNDOABLE, recorded: false })
  try {
    const r = await cleanup({ cwd: dir, io: { git: git(dir) } })
    assert.deepEqual(r.data, [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a failed teardown keeps both the data record and a problem', async () => {
  const dir = scene({ seedBody: UNDOABLE })
  try {
    const r = await cleanup({
      cwd: dir,
      yes: true,
      io: {
        git: git(dir),
        exec: () => { const e = new Error('exit 1'); e.stderr = 'database is gone'; throw e },
      },
    })
    assert.equal(r.exitCode, 1)
    const p = r.problems.find((x) => x.code === 'CLEANUP_FAILED')
    assert.match(p.message, /database is gone/)
    assert.ok(existsSync(join(dir, '.curtain', 'seeds', 'full.json')),
      'the record survives, so the data is not silently forgotten')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the runfile is never touched, because stopping is not cleaning', async () => {
  const dir = scene({ seedBody: UNDOABLE })
  writeFileSync(join(dir, '.curtain', 'services.json'), '{"apps":{}}')
  try {
    await cleanup({ cwd: dir, yes: true, io: { git: git(dir), exec: () => '' } })
    assert.ok(existsSync(join(dir, '.curtain', 'services.json')),
      'cleanup must leave `down` able to stop what is running')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
