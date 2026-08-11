import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { once } from 'node:events'
import { sandbox } from '../helpers/sandbox.mjs'
import { alive } from '../../lib/runfile.mjs'

const CLI = join(import.meta.dirname, '..', '..', 'bin', 'curtain')

function curtain(args, cwd) {
  try {
    return { status: 0, out: execFileSync(CLI, args, { cwd, encoding: 'utf8', timeout: 60_000 }) }
  } catch (err) {
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}
const json = (args, cwd) => JSON.parse(curtain(args, cwd).out)

/** Start a fixture helper detached, so it can be torn down as a whole group.
 *
 *  rogue.mjs spawns the real app as a grandchild with inherited stdio, so the
 *  app holds this runner's stdout pipe open. Killing only rogue leaves that
 *  pipe alive and `node --test` never exits. Signalling the group closes it. */
function helper(script, args, cwd) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return {
    child,
    pid: child.pid,
    async port() {
      let out = ''
      return await new Promise((resolve, reject) => {
        child.stdout.on('data', (d) => {
          out += d
          const m = /http:\/\/localhost:(\d+)/.exec(out)
          if (m) resolve(Number(m[1]))
        })
        setTimeout(() => reject(new Error(`${script} never announced: ${out}`)), 10_000).unref()
      })
    },
    async stop() {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      await once(child, 'exit').catch(() => {})
    },
  }
}

test('up starts every configured app, then down stops exactly them', async () => {
  await sandbox(async (dir) => {
    const started = json(['up', '--json'], dir)
    assert.deepEqual(Object.keys(started.started).sort(), ['admin', 'guest'])
    assert.equal(started.exitCode, 0)

    for (const s of Object.values(started.started)) {
      assert.equal((await fetch(s.url)).status, 200)
    }

    const runfile = JSON.parse(readFileSync(join(dir, '.curtain', 'services.json'), 'utf8'))
    assert.deepEqual(Object.keys(runfile.apps).sort(), ['admin', 'guest'])

    const stopped = json(['down', '--json'], dir)
    assert.deepEqual(Object.keys(stopped.stopped).sort(), ['admin', 'guest'])
    for (const s of Object.values(started.started)) {
      assert.equal(alive(s.pid), false)
    }
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, '.curtain', 'services.json'), 'utf8')).apps, {},
      'down empties the runfile of what it stopped',
    )
  })
})

test('up twice starts nothing the second time and says it reused', async () => {
  await sandbox(async (dir) => {
    const first = json(['up', '--json'], dir)
    try {
      const second = json(['up', '--json'], dir)
      assert.deepEqual(Object.keys(second.started), [], 'nothing restarts')
      assert.deepEqual(Object.keys(second.reused).sort(), ['admin', 'guest'])
      assert.equal(second.reused.admin.port, first.started.admin.port, 'same port, same process')
      assert.equal(second.reused.admin.pid, first.started.admin.pid)
      assert.match(curtain(['up'], dir).out, /reused/)
    } finally {
      curtain(['down'], dir)
    }
  })
})

test('up on a named app leaves the other alone', async () => {
  await sandbox(async (dir) => {
    try {
      const r = json(['up', 'admin', '--json'], dir)
      assert.deepEqual(Object.keys(r.started), ['admin'])
      const resolved = json(['resolve', '--json'], dir)
      assert.ok(resolved.problems.some((p) => p.code === 'NOT_RUNNING' && p.app === 'guest'))
    } finally {
      curtain(['down'], dir)
    }
  })
})

test('up names an unknown app instead of starting something', async () => {
  await sandbox(async (dir) => {
    const { status, out } = curtain(['up', 'nope'], dir)
    assert.equal(status, 2)
    assert.match(out, /nope/)
    assert.match(out, /admin/, 'it should list what is actually configured')
  })
})

test('down never touches a server another workspace started', async () => {
  await sandbox(async (dir) => {
    const rogue = helper('rogue.mjs', ['admin'], dir)
    const port = await rogue.port()
    try {
      const resolved = json(['resolve', '--json'], dir)
      const found = resolved.foreign.find((f) => f.port === port)
      assert.ok(found, 'the rogue must be seen')
      assert.equal(typeof found.owner, 'string')

      curtain(['down'], dir)
      assert.equal((await fetch(`http://localhost:${port}`)).status, 200,
        'down must leave a foreign server running')
    } finally {
      await rogue.stop()
    }
  })
})

test('a deaf server is reported NOT_ANSWERING rather than counted as up', async () => {
  await sandbox(async (dir) => {
    const deaf = helper('deaf.mjs', [], dir)
    const port = await deaf.port()
    try {
      // Claim it in the runfile the way `up` would have, then resolve.
      const { upsertEntry } = await import('../../lib/runfile.mjs')
      upsertEntry(dir, 'admin', {
        app: 'admin', pid: deaf.pid, url: `http://localhost:${port}`, port,
        command: 'node deaf.mjs', cwd: dir, log: join(dir, '.curtain', 'logs', 'admin.log'),
        startedAt: new Date().toISOString(), ready: true,
      })
      const resolved = json(['resolve', '--json'], dir)
      assert.equal(resolved.services.admin, undefined, 'an open port is not an up app')
      const p = resolved.problems.find((x) => x.code === 'NOT_ANSWERING')
      assert.equal(p.app, 'admin')
      assert.equal(p.port, port)
    } finally {
      await deaf.stop()
    }
  })
})

test('a start command that fails blocks with the last lines of its log', async () => {
  await sandbox(async (dir) => {
    writeFileSync(join(dir, 'curtain.local.json'), JSON.stringify({
      apps: { admin: { start: 'node -e "console.error(\'kaboom\'); process.exit(1)"' } },
    }))
    const { status, out } = curtain(['up', 'admin'], dir)
    assert.equal(status, 1)
    assert.match(out, /START_FAILED/)
    assert.match(out, /kaboom/, 'the output must be shown, not just referenced')
    assert.ok(existsSync(join(dir, '.curtain', 'logs', 'admin.log')))
  })
})
