import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspace, workspaceId } from '../../lib/workspace.mjs'
import { fakeGit } from '../helpers/fakes.mjs'

test('a main checkout has matching git dirs', () => {
  const ws = workspace('/repo/apps/admin', fakeGit({
    'rev-parse --show-toplevel': '/repo',
    'rev-parse --absolute-git-dir': '/repo/.git',
    'rev-parse --path-format=absolute --git-common-dir': '/repo/.git',
    'rev-parse --abbrev-ref HEAD': 'main',
  }))
  assert.equal(ws.root, '/repo')
  assert.equal(ws.kind, 'main')
  assert.equal(ws.branch, 'main')
})

test('a worktree has a git dir under the common dir, and its own root', () => {
  const ws = workspace('/repo/.worktrees/feat', fakeGit({
    'rev-parse --show-toplevel': '/repo/.worktrees/feat',
    'rev-parse --absolute-git-dir': '/repo/.git/worktrees/feat',
    'rev-parse --path-format=absolute --git-common-dir': '/repo/.git',
    'rev-parse --abbrev-ref HEAD': 'feature/x',
  }))
  assert.equal(ws.kind, 'worktree')
  assert.equal(ws.root, '/repo/.worktrees/feat')
  assert.equal(ws.branch, 'feature/x')
})

test('a worktree and its main checkout get different ids', () => {
  assert.notEqual(workspaceId('/repo'), workspaceId('/repo/.worktrees/feat'))
})

test('the id is 8 hex and stable for a path', () => {
  const id = workspaceId('/repo')
  assert.match(id, /^[0-9a-f]{8}$/)
  assert.equal(id, workspaceId('/repo'))
})

test('outside git it falls back to cwd and says so', () => {
  const ws = workspace('/tmp/nowhere', fakeGit({}))
  assert.equal(ws.kind, 'loose')
  assert.equal(ws.root, '/tmp/nowhere')
  assert.equal(ws.branch, null)
})

test('a detached HEAD reports no branch rather than the string HEAD', () => {
  const ws = workspace('/repo', fakeGit({
    'rev-parse --show-toplevel': '/repo',
    'rev-parse --absolute-git-dir': '/repo/.git',
    'rev-parse --path-format=absolute --git-common-dir': '/repo/.git',
    'rev-parse --abbrev-ref HEAD': 'HEAD',
  }))
  assert.equal(ws.branch, null)
})
