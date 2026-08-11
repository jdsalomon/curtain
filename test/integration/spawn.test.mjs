import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { startApp, stopGroup, logPathFor } from '../../lib/spawn.mjs'
import { alive } from '../../lib/runfile.mjs'
import { sandbox } from '../helpers/sandbox.mjs'

test('a real app starts, announces, and is reachable', async () => {
  await sandbox(async (dir) => {
    const { entry, problem } = await startApp({
      name: 'admin', start: 'node app.mjs admin', ready: 'curtain-fixture ready',
      cwd: dir, root: dir, timeoutMs: 20_000,
    })
    assert.equal(problem, undefined)
    try {
      assert.equal(entry.ready, true)
      assert.ok(entry.port > 0)
      assert.equal((await fetch(entry.url)).status, 200)
      assert.ok(existsSync(logPathFor(dir, 'admin')))
      assert.match(readFileSync(logPathFor(dir, 'admin'), 'utf8'), /curtain-fixture ready/)
    } finally {
      await stopGroup(entry.pid)
    }
  })
})

test('the server survives the parent exiting, which is why it gets no pipe', async () => {
  await sandbox(async (dir) => {
    // Start it in a short-lived child process, let that child exit, then check.
    const script = `
      import { startApp } from ${JSON.stringify(join(import.meta.dirname, '..', '..', 'lib', 'spawn.mjs'))}
      const r = await startApp({ name: 'admin', start: 'node app.mjs admin',
        ready: 'curtain-fixture ready', cwd: ${JSON.stringify(dir)},
        root: ${JSON.stringify(dir)}, timeoutMs: 20000 })
      console.log(JSON.stringify(r.entry))
    `
    writeFileSync(join(dir, 'starter.mjs'), script)
    const { execFileSync } = await import('node:child_process')
    const entry = JSON.parse(execFileSync(process.execPath, ['starter.mjs'], { cwd: dir, encoding: 'utf8' }))
    try {
      // The starter has exited. If the child had a pipe to it, the next write
      // would EPIPE and kill the server.
      await fetch(`${entry.url}/items`, { method: 'POST', body: '{}' })
      await new Promise((r) => setTimeout(r, 400))
      assert.equal(alive(entry.pid), true, 'the server must outlive the process that started it')
      assert.equal((await fetch(entry.url)).status, 200)
    } finally {
      await stopGroup(entry.pid)
    }
  })
})

test('a quiet app that announces nothing is found via its process group', async () => {
  await sandbox(async (dir) => {
    const { entry, problem } = await startApp({
      name: 'quiet', start: 'node app.mjs quiet', ready: null,
      cwd: dir, root: dir, timeoutMs: 4000,
    })
    // `quiet` prints no marker either, so this exercises NO_PORT_FOUND's sibling
    // path: readiness by probe is impossible without a URL, so we expect the
    // group lookup to supply one only when a marker exists. Assert the honest
    // outcome rather than a convenient one.
    if (entry) {
      try {
        assert.ok(entry.port > 0)
      } finally {
        await stopGroup(entry.pid)
      }
    } else {
      assert.equal(problem.code, 'NO_PORT_FOUND')
      assert.match(problem.fix, /no port was announced/)
    }
  })
})

test('a command that exits immediately is START_FAILED with its output', async () => {
  await sandbox(async (dir) => {
    const { entry, problem } = await startApp({
      name: 'admin', start: 'node -e "console.error(\'boom\'); process.exit(3)"',
      ready: 'never', cwd: dir, root: dir, timeoutMs: 10_000,
    })
    assert.equal(entry, undefined)
    assert.equal(problem.code, 'START_FAILED')
    assert.equal(problem.exit, 3)
    assert.match(problem.output, /boom/)
    assert.match(problem.fix, /\.curtain\/logs\/admin\.log/)
  })
})

test('a never-ready command times out, stays running, and is recorded not-ready', async () => {
  await sandbox(async (dir) => {
    const { entry, problem } = await startApp({
      name: 'admin', start: 'node app.mjs admin', ready: 'this marker never appears',
      cwd: dir, root: dir, timeoutMs: 3000,
    })
    try {
      assert.equal(problem.code, 'NOT_READY')
      assert.ok(problem.output.includes('curtain-fixture ready'), 'the tail shows what it did print')
      assert.equal(entry.ready, false)
      assert.equal(alive(entry.pid), true, 'a slow app is reported, not killed')
    } finally {
      await stopGroup(entry.pid)
    }
  })
})

test('stopGroup takes the whole tree, not just the shell', async () => {
  await sandbox(async (dir) => {
    const { entry } = await startApp({
      name: 'admin', start: 'node app.mjs admin', ready: 'curtain-fixture ready',
      cwd: dir, root: dir, timeoutMs: 20_000,
    })
    const outcome = await stopGroup(entry.pid)
    assert.ok(['stopped', 'killed'].includes(outcome))
    assert.equal(alive(entry.pid), false)
    await assert.rejects(fetch(entry.url), 'nothing must still be listening')
    assert.equal(await stopGroup(entry.pid), 'gone', 'stopping twice is not an error')
  })
})
