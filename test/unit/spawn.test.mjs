import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { announcedIn, tail, logPathFor } from '../../lib/spawn.mjs'

test('it reads the announced url from the shapes real dev servers print', () => {
  const cases = [
    ['  - Local:        http://localhost:3000', 3000],
    ['  ➜  Local:   http://localhost:5173/', 5173],
    ['Local:   http://127.0.0.1:8080', 8080],
    ['listening on http://localhost:4321 now', 4321],
    ['  Local:   http://localhost:3000\ncurtain-fixture ready', 3000],
  ]
  for (const [text, port] of cases) {
    assert.equal(announcedIn(text)?.port, port, text)
  }
})

test('the first announcement wins, because a restart appends a second one', () => {
  const text = '  Local: http://localhost:3000\n\n  Local: http://localhost:3001\n'
  assert.equal(announcedIn(text).port, 3000)
})

test('a network url is not an announcement, so we never claim someone else s host', () => {
  assert.equal(announcedIn('  Network: http://192.168.1.20:3000'), null)
  assert.equal(announcedIn('  Deployed: https://example.com'), null)
})

test('no announcement reads as null rather than a guess', () => {
  assert.equal(announcedIn(''), null)
  assert.equal(announcedIn('compiling...\nready\n'), null)
})

test('the url keeps its origin and drops any trailing path', () => {
  assert.equal(announcedIn('  ➜  Local:   http://localhost:5173/').url, 'http://localhost:5173')
})

test('tail returns the last n lines and everything when there are fewer', () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  assert.equal(tail(text, 3), 'line 97\nline 98\nline 99')
  assert.equal(tail('only', 40), 'only')
  assert.equal(tail('', 40), '')
})

test('logs live under the state directory, one per app', () => {
  assert.equal(logPathFor('/repo', 'admin'), join('/repo', '.curtain', 'logs', 'admin.log'))
})
