import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, lstatSync, realpathSync, existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envKeys, envStatus, envProblems, adopt, link, storeRoot } from '../../lib/envfiles.mjs'

/** Every test redirects the store into a throwaway XDG home; none touches the
 *  real ~/.config. */
function scene(fn) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-env-')))
  const repo = join(base, 'repo')
  mkdirSync(repo, { recursive: true })
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(base, 'xdg')
  try {
    return fn(repo)
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    rmSync(base, { recursive: true, force: true })
  }
}

const CONFIG = { name: 'proj', apps: { vip: { start: 'x', env: ['.env.local'] } } }

test('envKeys reads names in both plain and export form, and nothing else', () => {
  const keys = envKeys([
    'API_KEY=secret123',
    'export TOKEN="quoted"',
    '# COMMENT=out',
    '  SPACED = fine',   // no: space before = disqualifies under strict form?
    'lower_case=ok',
    'not a key line',
  ].join('\n'))
  assert.ok(keys.includes('API_KEY'))
  assert.ok(keys.includes('TOKEN'))
  assert.ok(keys.includes('lower_case'))
  assert.ok(!keys.includes('COMMENT'), 'a commented line is not a key')
  // The values must be nowhere in what this module returns.
  assert.ok(!keys.join(' ').includes('secret123'))
})

test('a declared file that does not exist and has no store values is NO_ENV_VALUES', () => {
  scene((repo) => {
    const status = envStatus({ configDir: repo, config: CONFIG })
    assert.equal(status.entries[0].state, 'missing')
    assert.equal(status.entries[0].canonicalExists, false)
    const p = envProblems(status)
    assert.equal(p[0].code, 'NO_ENV_VALUES')
    assert.match(p[0].fix, /curtain env adopt/)
  })
})

test('declaring env without a project name is refused with its own code', () => {
  scene((repo) => {
    const config = { apps: { vip: { start: 'x', env: ['.env.local'] } } }
    const p = envProblems(envStatus({ configDir: repo, config }))
    assert.equal(p[0].code, 'NO_PROJECT_NAME')
    assert.equal(p.length, 1, 'the name problem replaces the per-file noise')
  })
})

test('adopt moves the file into the store and leaves a working symlink', () => {
  scene((repo) => {
    writeFileSync(join(repo, '.env.local'), 'VIP_CODE=hunter2\n')
    const r = adopt({ configDir: repo, config: CONFIG })
    assert.equal(r.adopted.length, 1)
    assert.equal(r.problems.length, 0)

    const abs = join(repo, '.env.local')
    assert.ok(lstatSync(abs).isSymbolicLink(), 'the checkout keeps a symlink')
    assert.equal(readFileSync(abs, 'utf8'), 'VIP_CODE=hunter2\n', 'readable through the link')
    assert.ok(existsSync(join(storeRoot('proj'), '.env.local')), 'the store holds the file')
  })
})

test('a second checkout gets the values with link alone', () => {
  scene((repo) => {
    writeFileSync(join(repo, '.env.local'), 'VIP_CODE=hunter2\n')
    adopt({ configDir: repo, config: CONFIG })

    const other = join(repo, '..', 'worktree')
    mkdirSync(other)
    const r = link({ configDir: other, config: CONFIG })
    assert.equal(r.linked.length, 1)
    assert.equal(readFileSync(join(other, '.env.local'), 'utf8'), 'VIP_CODE=hunter2\n')
  })
})

test('adopt never overwrites the store: a disagreeing checkout file is a conflict', () => {
  scene((repo) => {
    writeFileSync(join(repo, '.env.local'), 'VIP_CODE=first\n')
    adopt({ configDir: repo, config: CONFIG })

    // A second checkout writes its own values, then tries to adopt.
    const other = join(repo, '..', 'other')
    mkdirSync(other)
    writeFileSync(join(other, '.env.local'), 'VIP_CODE=different\n')
    const r = adopt({ configDir: other, config: CONFIG })

    assert.equal(r.adopted.length, 0)
    assert.equal(r.problems[0].code, 'ENV_CONFLICT')
    assert.equal(readFileSync(join(storeRoot('proj'), '.env.local'), 'utf8'),
      'VIP_CODE=first\n', 'the store must keep its original content')
    assert.ok(!lstatSync(join(other, '.env.local')).isSymbolicLink(),
      'the disagreeing file is left for a human, not replaced')
  })
})

test('adopting an identical copy replaces it with a link and loses nothing', () => {
  scene((repo) => {
    writeFileSync(join(repo, '.env.local'), 'VIP_CODE=same\n')
    adopt({ configDir: repo, config: CONFIG })
    const other = join(repo, '..', 'twin')
    mkdirSync(other)
    writeFileSync(join(other, '.env.local'), 'VIP_CODE=same\n')
    const r = adopt({ configDir: other, config: CONFIG })
    assert.equal(r.linked.length, 1)
    assert.ok(lstatSync(join(other, '.env.local')).isSymbolicLink())
  })
})

test('schema drift names the missing keys and never the values', () => {
  scene((repo) => {
    writeFileSync(join(repo, '.env.local'), 'API_KEY=oldvalue\n')
    // The branch's example declares a key the values file predates.
    writeFileSync(join(repo, '.env.example'), 'API_KEY=\nSTRIPE_KEY=\n')
    const status = envStatus({ configDir: repo, config: CONFIG })
    assert.deepEqual(status.entries[0].missingKeys, ['STRIPE_KEY'])
    const p = envProblems(status).find((x) => x.code === 'ENV_KEYS_MISSING')
    assert.deepEqual(p.keys, ['STRIPE_KEY'])
    assert.ok(!JSON.stringify(p).includes('oldvalue'), 'values leak nowhere')
  })
})

test('a missing checkout file with store values checks drift against the store', () => {
  scene((repo) => {
    writeFileSync(join(repo, '.env.local'), 'A=1\n')
    writeFileSync(join(repo, '.env.example'), 'A=\nB=\n')
    adopt({ configDir: repo, config: CONFIG })
    const fresh = join(repo, '..', 'fresh')
    mkdirSync(fresh)
    writeFileSync(join(fresh, '.env.example'), 'A=\nB=\n')
    const status = envStatus({ configDir: fresh, config: CONFIG })
    assert.equal(status.entries[0].state, 'missing')
    assert.deepEqual(status.entries[0].missingKeys, ['B'],
      'drift is visible before the link exists, from the store copy')
  })
})

// v0.5.2. A project whose values predate Curtain says where they live, rather
// than being told they exist nowhere and invited to make a second copy.
test('envStore wins over the invented store, and expands a leading ~', () => {
  scene(() => {
    assert.equal(storeRoot('proj', '/opt/values'), '/opt/values')
    assert.equal(storeRoot('proj', '~/.config/other'), join(process.env.HOME, '.config/other'))
    assert.match(storeRoot('proj'), /xdg\/curtain\/proj$/, 'without it, nothing changes')
  })
})

test('an envStore keeps the checkout layout, so an existing store needs no migration', () => {
  scene((repo) => {
    const store = join(repo, '..', 'values')
    mkdirSync(join(store, 'apps/admin'), { recursive: true })
    writeFileSync(join(store, 'apps/admin/.env.local'), 'API_KEY=x\n')
    const config = {
      envStore: store,
      apps: { admin: { start: 'x', env: ['apps/admin/.env.local'] } },
    }
    const status = envStatus({ configDir: repo, config })
    const [entry] = status.entries
    assert.equal(entry.canonical, join(store, 'apps/admin/.env.local'))
    assert.equal(entry.canonicalExists, true, 'the values already there are found')
    // Missing in the checkout but present in the store is a link away, which is
    // what `up` does by itself. It must NOT read as "values exist nowhere".
    const codes = envProblems(status).map((p) => p.code)
    assert.deepEqual(codes, ['MISSING_ENV'])
  })
})

test('an envStore needs no project name, because the name only keys an invented store', () => {
  scene((repo) => {
    const store = join(repo, '..', 'values')
    mkdirSync(store, { recursive: true })
    const config = { envStore: store, apps: { admin: { start: 'x', env: ['.env.local'] } } }
    const codes = envProblems(envStatus({ configDir: repo, config })).map((p) => p.code)
    assert.ok(!codes.includes('NO_PROJECT_NAME'), 'the store is named directly')
  })
})

test('with neither a name nor an envStore, the fix offers both', () => {
  scene((repo) => {
    const config = { apps: { admin: { start: 'x', env: ['.env.local'] } } }
    const [p] = envProblems(envStatus({ configDir: repo, config }))
    assert.equal(p.code, 'NO_PROJECT_NAME')
    assert.match(p.fix, /"name"/)
    assert.match(p.fix, /"envStore"/)
  })
})
