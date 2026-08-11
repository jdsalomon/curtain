import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseListeners, portOf, parseCwd, ownerLabel, classifyListener,
} from '../../lib/listeners.mjs'

const LSOF = [
  'p4109', 'cnode', 'f23', 'n*:3001', 'f24', 'n127.0.0.1:3001',
  'p4697', 'cnode', 'f23', 'n[::1]:3002',
  'p8123', 'cPython', 'f5', 'n*:3055',
  'p900', 'crapportd', 'f7', 'n*:49152',
  '',
].join('\n')

test('machine-format lsof yields one entry per pid and port', () => {
  const got = parseListeners(LSOF)
  assert.deepEqual(got, [
    { pid: 4109, command: 'node', port: 3001 },
    { pid: 4697, command: 'node', port: 3002 },
    { pid: 8123, command: 'Python', port: 3055 },
    { pid: 900, command: 'rapportd', port: 49152 },
  ], 'the same pid listening on one port twice is one entry, not two')
})

test('portOf reads every address spelling lsof emits', () => {
  assert.equal(portOf('*:3000'), 3000)
  assert.equal(portOf('127.0.0.1:3000'), 3000)
  assert.equal(portOf('[::1]:3000'), 3000)
  assert.equal(portOf('localhost:3000 (LISTEN)'), 3000)
  assert.equal(portOf('/tmp/some.sock'), null)
  assert.equal(portOf(''), null)
})

test('parseCwd takes the name line', () => {
  assert.equal(parseCwd('p4109\nn/Users/j/repo\n'), '/Users/j/repo')
  assert.equal(parseCwd('p4109\n'), null)
})

test('ownerLabel names a worktree by its worktree, and a checkout by its folder', () => {
  assert.equal(ownerLabel('/Users/j/code/other-checkout'), 'other-checkout')
  assert.equal(ownerLabel('/Users/j/code/app/.worktrees/feat-a'), 'worktrees/feat-a')
  assert.equal(ownerLabel('/Users/j/code/app/.claude/worktrees/feat-b'), 'worktrees/feat-b')
})

test('a listener whose git root is mine is mine', () => {
  const c = classifyListener({ pid: 1, command: 'node', port: 3001 }, {
    root: '/repo',
    gitRootOf: () => '/repo',
    cwdOf: () => '/repo/apps/admin',
  })
  assert.equal(c.kind, 'mine')
})

test('a worktree INSIDE my checkout is foreign, which path prefixes get wrong', () => {
  const c = classifyListener({ pid: 2, command: 'node', port: 3000 }, {
    root: '/repo',
    cwdOf: () => '/repo/.worktrees/feat/apps/guest',
    gitRootOf: () => '/repo/.worktrees/feat',
  })
  assert.equal(c.kind, 'foreign', 'its cwd is under mine but its git root is not')
  assert.equal(c.owner, 'worktrees/feat')
})

test('a listener with no discoverable git root is unclaimed, never guessed at', () => {
  const c = classifyListener({ pid: 3, command: 'Python', port: 3055 }, {
    root: '/repo',
    cwdOf: () => '/opt/somewhere',
    gitRootOf: () => null,
  })
  assert.equal(c.kind, 'unclaimed')
  assert.equal(c.owner, undefined)
})

test('a listener whose cwd cannot be read is unclaimed rather than fatal', () => {
  const c = classifyListener({ pid: 4, command: 'node', port: 3099 }, {
    root: '/repo',
    cwdOf: () => null,
    gitRootOf: () => null,
  })
  assert.equal(c.kind, 'unclaimed')
})
