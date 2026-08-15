import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seed, listSeeds, seedsDir, readTenant } from '../../lib/seed.mjs'
import { fakeGit } from '../helpers/fakes.mjs'

const CONFIG = { name: 'proj', apps: { admin: { start: 'x' } } }

function repo(seeds = {}, config = CONFIG) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-seed-')))
  if (config) writeFileSync(join(dir, 'curtain.json'), JSON.stringify(config))
  if (Object.keys(seeds).length) mkdirSync(seedsDir(dir), { recursive: true })
  for (const [name, body] of Object.entries(seeds)) {
    writeFileSync(join(seedsDir(dir), `${name}.mjs`), body)
  }
  return dir
}

const git = (root) => fakeGit({
  'rev-parse --show-toplevel': root,
  'rev-parse --absolute-git-dir': join(root, '.git'),
  'rev-parse --path-format=absolute --git-common-dir': join(root, '.git'),
  'rev-parse --abbrev-ref HEAD': 'main',
})

const run = (dir, name, io = {}) => seed(name, { cwd: dir, io: { git: git(dir), ...io } })

test('a leading underscore keeps a shared helper off the menu', () => {
  const dir = repo({ full: 'export default async () => {}', _shared: 'export const x = 1' })
  try {
    assert.deepEqual(listSeeds(dir), ['full'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a project with no seeds is empty, not broken', () => {
  const dir = repo({})
  try {
    assert.deepEqual(listSeeds(dir), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a seed runs its command and records what it returns', async () => {
  const dir = repo({ full: `
    export default async ({ run }) => {
      run('provision --all')
      return { slug: 'abc123' }
    }
  ` })
  const calls = []
  try {
    const r = await run(dir, 'full', { exec: (cmd) => { calls.push(cmd); return '' } })
    assert.equal(r.exitCode, 0)
    assert.deepEqual(calls, ['provision --all'], 'the host command ran verbatim')
    assert.deepEqual(r.tenant, { slug: 'abc123' })
    assert.deepEqual(readTenant(dir, 'full'), { slug: 'abc123' }, 'and was recorded')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a seed that returns nothing still succeeds and records nothing', async () => {
  const dir = repo({ bare: `export default async ({ run }) => { run('provision') }` })
  try {
    const r = await run(dir, 'bare', { exec: () => '' })
    assert.equal(r.exitCode, 0)
    assert.equal(r.tenant, null)
    assert.equal(readTenant(dir, 'bare'), null, 'nothing to record is not an error')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a failed command is SEED_FAILED carrying what it printed', async () => {
  const dir = repo({ bad: `export default async ({ run }) => run('provision')` })
  try {
    const r = await run(dir, 'bad', {
      exec: () => {
        const err = new Error('exit 1')
        err.stderr = 'could not reach the database'
        throw err
      },
    })
    assert.equal(r.exitCode, 1)
    const p = r.problems.find((x) => x.code === 'SEED_FAILED')
    assert.match(p.message, /could not reach the database/)
    assert.match(p.message, /provision/)
    assert.match(p.fix, /do not retry blindly/)
    assert.equal(r.tenant, null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unknown seed names the ones that exist', async () => {
  const dir = repo({ full: 'export default async () => {}' })
  try {
    const r = await run(dir, 'nope')
    const p = r.problems.find((x) => x.code === 'NO_SUCH_SEED')
    assert.deepEqual(r.available, ['full'])
    assert.match(p.fix, /full/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a seed file with no default export is reported, not silently skipped', async () => {
  const dir = repo({ half: 'export const meta = { description: "x" }' })
  try {
    const r = await run(dir, 'half')
    assert.equal(r.problems[0].code, 'NO_SUCH_SEED')
    assert.match(r.problems[0].fix, /default async function/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unconfigured repo is refused before any script is imported', async () => {
  const dir = repo({}, null)
  try {
    const r = await run(dir, 'anything')
    assert.equal(r.problems[0].code, 'NO_CONFIG')
    assert.equal(r.exitCode, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the seed gets this workspace identity, so it can namespace what it makes', async () => {
  const dir = repo({ tagged: `
    export default async ({ workspace }) => ({ tag: workspace.id, branch: workspace.branch })
  ` })
  try {
    const r = await run(dir, 'tagged', { exec: () => '' })
    assert.match(r.tenant.tag, /^[0-9a-f]{8}$/, 'the workspace id namespaces per checkout')
    assert.equal(r.tenant.branch, 'main')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
