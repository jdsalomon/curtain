import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { down } from '../../lib/down.mjs'
import { writeRunfile, readRunfile } from '../../lib/runfile.mjs'

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'curtain-down-')))
const entry = (over) => ({
  app: 'admin', pid: 1234, url: 'http://localhost:3000', port: 3000,
  command: 'x', cwd: '/repo', log: '/repo/.curtain/logs/admin.log',
  startedAt: '2026-08-11T00:00:00.000Z', ready: true, ...over,
})

// down reads the runfile directly, so cwd only has to be a directory.
const io = (aliveMap) => ({
  git: () => null,
  alive: (pid) => Boolean(aliveMap[pid]),
  kill: (target) => { aliveMap[Math.abs(target)] = false },
  graceMs: 50,
})

test('it stops what the runfile claims and empties those entries', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry(), guest: entry({ app: 'guest', pid: 5678, port: 3001 }) })
    const r = await down({ cwd: dir, io: io({ 1234: true, 5678: true }) })
    assert.deepEqual(Object.keys(r.stopped).sort(), ['admin', 'guest'])
    assert.deepEqual(readRunfile(dir).apps, {})
    assert.equal(r.exitCode, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a named app stops alone and the sibling entry survives', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry(), guest: entry({ app: 'guest', pid: 5678, port: 3001 }) })
    await down({ apps: ['admin'], cwd: dir, io: io({ 1234: true, 5678: true }) })
    assert.deepEqual(Object.keys(readRunfile(dir).apps), ['guest'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an already-dead process is reported gone and its entry cleared', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry() })
    const r = await down({ cwd: dir, io: io({}) })
    assert.deepEqual(Object.keys(r.stopped), [])
    assert.deepEqual(r.alreadyGone, ['admin'])
    assert.deepEqual(readRunfile(dir).apps, {}, 'a stale claim is removed either way')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an empty runfile is success, not an error', async () => {
  const dir = tmp()
  try {
    const r = await down({ cwd: dir, io: io({}) })
    assert.equal(r.exitCode, 0)
    assert.deepEqual(Object.keys(r.stopped), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a broken config does not stop cleanup, because down never resolves', async () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, 'curtain.json'), '{ not json at all')
    writeRunfile(dir, { admin: entry() })
    const r = await down({ cwd: dir, io: io({ 1234: true }) })
    assert.deepEqual(Object.keys(r.stopped), ['admin'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('it signals the process group, not the bare pid', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry() })
    const signalled = []
    // Alive until something kills it. A fake that returns true exactly once is
    // consumed by down's own liveness check, so stopGroup sees a dead process
    // and returns before signalling anything.
    const living = { 1234: true }
    await down({
      cwd: dir,
      io: {
        git: () => null,
        alive: (pid) => Boolean(living[pid]),
        kill: (target, sig) => {
          signalled.push([target, sig])
          living[Math.abs(target)] = false
        },
        graceMs: 20,
      },
    })
    assert.equal(signalled[0][0], -1234, 'negative pid is the whole group')
    assert.equal(signalled[0][1], 'SIGTERM')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
