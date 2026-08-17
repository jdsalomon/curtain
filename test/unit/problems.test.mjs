import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CODES, problem, isBlocking, BLOCKING } from '../../lib/problems.mjs'

test('an unknown code throws, which is the whole point of the factory', () => {
  assert.throws(() => problem('NOPE'), /unknown problem code: NOPE/)
})

test('a known code carries its fields through', () => {
  const p = problem('PORT_TAKEN', { app: 'admin', port: 3000, owner: 'worktrees/feat' })
  assert.equal(p.code, 'PORT_TAKEN')
  assert.equal(p.owner, 'worktrees/feat')
})

test('every code is spelled the same as its key, so the table cannot drift', () => {
  for (const [key, value] of Object.entries(CODES)) assert.equal(key, value)
})

test('every blocking code is a real code', () => {
  for (const code of BLOCKING) assert.ok(CODES[code], `${code} is not in CODES`)
})

test('NOT_RUNNING does not block, or up could never run', () => {
  assert.equal(isBlocking([problem('NOT_RUNNING', { app: 'admin' })]), false)
  assert.equal(isBlocking([problem('NO_CONFIG', {})]), true)
  assert.equal(isBlocking([]), false)
})

test('UNHEALTHY blocks, because a server answering the wrong thing wastes a recording', () => {
  assert.equal(isBlocking([problem('UNHEALTHY', { app: 'admin', port: 3000 })]), true)
  // NOT_ANSWERING stays information: it is what `up` exists to fix.
  assert.equal(isBlocking([problem('NOT_ANSWERING', { app: 'admin' })]), false)
})
