import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runfilePath, readRunfile, writeRunfile, upsertEntry, removeEntry, alive, verifyRunfile,
} from '../../lib/runfile.mjs'
import { fakeProbe } from '../helpers/fakes.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'curtain-run-'))
const entry = (over = {}) => ({
  app: 'admin', pid: 111, url: 'http://localhost:3000', port: 3000,
  command: 'node app.mjs admin', cwd: '/repo', log: '/repo/.curtain/logs/admin.log',
  startedAt: '2026-08-11T00:00:00.000Z', ready: true, ...over,
})

test('the runfile lives under the state directory', () => {
  assert.equal(runfilePath('/repo'), join('/repo', '.curtain', 'services.json'))
})

test('a missing runfile reads as empty rather than throwing', () => {
  const dir = tmp()
  try {
    assert.deepEqual(readRunfile(dir), { apps: {} })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a corrupt runfile reads as empty, because it is disposable state', () => {
  const dir = tmp()
  try {
    mkdirSync(join(dir, '.curtain'), { recursive: true })
    writeFileSync(runfilePath(dir), '{ truncated')
    assert.deepEqual(readRunfile(dir), { apps: {} })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('write then read round-trips, creating the state directory', () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry() })
    assert.ok(existsSync(runfilePath(dir)))
    assert.equal(readRunfile(dir).apps.admin.port, 3000)
    assert.match(readFileSync(runfilePath(dir), 'utf8'), /\n$/, 'trailing newline')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('upsert leaves siblings alone and remove takes only its own', () => {
  const dir = tmp()
  try {
    upsertEntry(dir, 'admin', entry())
    upsertEntry(dir, 'guest', entry({ app: 'guest', pid: 222, port: 3001 }))
    assert.deepEqual(Object.keys(readRunfile(dir).apps).sort(), ['admin', 'guest'])
    removeEntry(dir, 'admin')
    assert.deepEqual(Object.keys(readRunfile(dir).apps), ['guest'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('alive is true for this process and false for a pid that cannot exist', () => {
  assert.equal(alive(process.pid), true)
  assert.equal(alive(2 ** 30), false)
})

test('a dead pid is dropped on read, so the runfile self-heals', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry({ pid: 2 ** 30 }) })
    const r = await verifyRunfile(dir, { alive, probe: fakeProbe({}) })
    assert.deepEqual(Object.keys(r.live), [])
    assert.equal(r.dropped.length, 1)
    assert.equal(r.dropped[0].app, 'admin')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a live pid that answers is live, and any status counts as answering', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry({ pid: process.pid }) })
    const r = await verifyRunfile(dir, {
      alive,
      probe: fakeProbe({ 'http://localhost:3000': { ok: true, status: 404 } }),
    })
    assert.deepEqual(Object.keys(r.live), ['admin'])
    assert.equal(r.notAnswering.length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a live pid that does not answer is reported separately, not silently live', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry({ pid: process.pid }) })
    const r = await verifyRunfile(dir, { alive, probe: fakeProbe({}) })
    assert.deepEqual(Object.keys(r.live), [], 'not answering is not live')
    assert.equal(r.notAnswering.length, 1)
    assert.equal(r.dropped.length, 0, 'the process exists, so do not drop its entry')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('verification never rewrites the file, because resolve must stay pure', async () => {
  const dir = tmp()
  try {
    writeRunfile(dir, { admin: entry({ pid: 2 ** 30 }) })
    const before = readFileSync(runfilePath(dir), 'utf8')
    await verifyRunfile(dir, { alive, probe: fakeProbe({}) })
    assert.equal(readFileSync(runfilePath(dir), 'utf8'), before)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
