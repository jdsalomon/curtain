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
