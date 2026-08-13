import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEnvironment } from '../../lib/doctor.mjs'

test('the running node passes its own floor', () => {
  assert.deepEqual(checkEnvironment(), [])
})

test('a node below the floor is a blocking problem naming both versions', () => {
  const problems = checkEnvironment({ nodeVersion: 'v18.19.0' })
  const p = problems.find((x) => x.code === 'NODE_TOO_OLD')
  assert.ok(p)
  assert.equal(p.found, 'v18.19.0')
  assert.match(p.required, /20\.11/)
  assert.match(p.fix, /upgrade/i)
})

test('a node above the floor passes, including a major bump', () => {
  assert.deepEqual(checkEnvironment({ nodeVersion: 'v24.0.0' }), [])
  assert.deepEqual(checkEnvironment({ nodeVersion: 'v20.11.0' }), [])
})

// The subagent that first ran doctor on a busy machine caught its two views of
// unclaimed listeners disagreeing: the problems list counted 28 ambient sockets
// while debt, filtering to this workspace, was empty. Both now use the same
// filter, and this pins the agreement.
test('debt and the UNCLAIMED_SERVER problem describe the same listeners', async () => {
  const { doctor } = await import('../../lib/doctor.mjs')
  const { mkdtempSync, writeFileSync, rmSync, realpathSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fakeGit } = await import('../helpers/fakes.mjs')

  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-doc-')))
  writeFileSync(join(dir, 'curtain.json'), JSON.stringify({ apps: { a: { start: 'x' } } }))
  const git = fakeGit({
    'rev-parse --show-toplevel': dir,
    'rev-parse --absolute-git-dir': join(dir, '.git'),
    'rev-parse --path-format=absolute --git-common-dir': join(dir, '.git'),
    'rev-parse --abbrev-ref HEAD': 'main',
  })
  try {
    const r = await doctor({
      cwd: dir,
      io: {
        git,
        matchFingerprint: async () => false,
        listeners: () => ({
          items: [
            { pid: 1, command: 'Spotify', port: 57621, kind: 'unclaimed' },  // ambient
            { pid: 2, command: 'node', port: 3055, kind: 'mine' },           // ours
          ],
          problems: [],
        }),
      },
    })
    const p = r.resolved.problems.find((x) => x.code === 'UNCLAIMED_SERVER')
    assert.deepEqual(p.ports, [3055], 'the problem covers only this workspace')
    assert.deepEqual(r.debt.unclaimedServers.map((u) => u.port), [3055],
      'debt lists exactly the listeners the problem counts')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
