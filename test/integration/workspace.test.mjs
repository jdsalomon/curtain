import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { workspace } from '../../lib/workspace.mjs'
import { sandbox } from '../helpers/sandbox.mjs'

test('real git: a sandbox is a main checkout at its own root', async () => {
  await sandbox(async (dir) => {
    const ws = workspace(dir)
    assert.equal(ws.root, dir)
    assert.equal(ws.kind, 'main')
    assert.equal(ws.branch, 'main')
  })
})

test('real git: a worktree created inside the checkout is still a worktree', async () => {
  await sandbox(async (dir, git) => {
    const wt = join(dir, '.worktrees', 'feat')
    git('worktree', 'add', '-q', '-b', 'feat', wt)
    const ws = workspace(wt)
    assert.equal(ws.kind, 'worktree', 'nested worktrees are the case that breaks path heuristics')
    assert.equal(ws.root, wt)
    assert.equal(ws.branch, 'feat')
    assert.notEqual(ws.id, workspace(dir).id)
  })
})

test('real git: a subdirectory resolves to the repo root', async () => {
  await sandbox(async (dir) => {
    // sandbox() copies the fixture's *contents* into dir, so there is no
    // fixture/ subdirectory to probe. Make one.
    const sub = join(dir, 'nested', 'deep')
    mkdirSync(sub, { recursive: true })
    assert.equal(workspace(sub).root, workspace(dir).root)
  })
})
