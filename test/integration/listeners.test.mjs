import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { listeners, realCwdOf } from '../../lib/listeners.mjs'
import { sandbox } from '../helpers/sandbox.mjs'

test('real lsof finds a port this process is listening on', async () => {
  const server = createServer((_, res) => res.end('ok'))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  try {
    const { items, problems } = listeners({ root: process.cwd() })
    assert.deepEqual(problems, [])
    const mine = items.find((i) => i.port === port && i.pid === process.pid)
    assert.ok(mine, `expected to find pid ${process.pid} on port ${port}`)
    assert.equal(mine.kind, 'mine', 'the test process runs inside the plugin repo')
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('real lsof can read this process s cwd', () => {
  assert.equal(realCwdOf(process.pid), process.cwd())
})

test('a server started from another git root classifies as foreign and is named', async () => {
  await sandbox(async (dir) => {
    const server = createServer((_, res) => res.end('ok'))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address()
    try {
      // Classify from the sandbox's point of view: this test process lives in
      // the plugin repo, so to the sandbox it is somebody else's.
      const { items } = listeners({ root: dir })
      const found = items.find((i) => i.port === port)
      assert.ok(found)
      assert.equal(found.kind, 'foreign')
      assert.equal(typeof found.owner, 'string')
      assert.ok(found.owner.length > 0, 'a foreign server must be attributable')
    } finally {
      server.close()
      await once(server, 'close')
    }
  })
})
