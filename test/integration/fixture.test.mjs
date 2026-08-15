import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { once } from 'node:events'
import { tmpdir } from 'node:os'

const FIXTURE = join(import.meta.dirname, '..', '..', 'fixture')

/** A private items file per app instance: test files run in parallel, and a
 *  shared store made them overwrite each other's data. */
let storeSeq = 0
const store = () => join(tmpdir(), `curtain-items-${process.pid}-${storeSeq++}.json`)

/** Start a fixture role, resolve once it announces, always kill it. */
async function withApp(role, fn) {
  const child = spawn(process.execPath, ['app.mjs', role], { cwd: FIXTURE, env: { ...process.env, FIXTURE_STORE: store() } })
  let out = ''
  const announced = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d
      const m = /http:\/\/localhost:(\d+)/.exec(out)
      if (m) resolve({ url: m[0], port: Number(m[1]) })
    })
    child.once('exit', (code) => reject(new Error(`exited ${code}: ${out}`)))
    setTimeout(() => reject(new Error(`no announcement in 5s: ${out}`)), 5000).unref()
  })
  try {
    return await fn(await announced, () => out)
  } finally {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

test('admin announces its port and says it is ready', async () => {
  await withApp('admin', async ({ url }, out) => {
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /admin/)
    assert.match(out(), /curtain-fixture ready/)
  })
})

test('admin serves a login form the fingerprint can match', async () => {
  await withApp('admin', async ({ url }) => {
    const body = await (await fetch(`${url}/login`)).text()
    assert.match(body, /name="password"/)
  })
})

test('items round-trips a write and can be emptied', async () => {
  await withApp('guest', async ({ url }) => {
    assert.deepEqual(await (await fetch(`${url}/items`)).json(), [])
    const created = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'one' }),
    })
    assert.equal(created.status, 201)
    assert.deepEqual(await (await fetch(`${url}/items`)).json(), [{ label: 'one' }])
    assert.equal((await fetch(`${url}/items`, { method: 'DELETE' })).status, 204)
    assert.deepEqual(await (await fetch(`${url}/items`)).json(), [])
  })
})

test('quiet listens but announces nothing, which is the fallback-discovery case', async () => {
  const child = spawn(process.execPath, ['app.mjs', 'quiet'], { cwd: FIXTURE })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  await new Promise((r) => setTimeout(r, 800))
  try {
    assert.doesNotMatch(out, /http:\/\/localhost/, 'quiet must not announce a URL')
  } finally {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
})
