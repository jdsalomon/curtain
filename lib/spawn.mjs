// Start a server that outlives this process.
//
// The child never gets a pipe to us: when the CLI exits, a pipe's read end
// closes and the next write earns EPIPE, so a dev server would die minutes
// later and look like an app bug. It writes to a log file instead, and we tail
// the file for readiness. The log is also the error report and the thing a
// human opens.
//
// detached:true makes the child lead a process group, so one signal to -pid
// reaches the shell, the task runner and the server. The runfile stores that
// group id.
import { openSync, closeSync, mkdirSync, readFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { STATE_DIR } from './config.mjs'
import { alive, probe as realProbe } from './runfile.mjs'
import { listeners as enumerateListeners } from './listeners.mjs'
import { problem } from './problems.mjs'

/** Only loopback. A LAN URL belongs to this machine's current network, not to
 *  the app, and recording it produces a URL that breaks on the next wifi hop. */
const ANNOUNCED = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/

export function announcedIn(text) {
  const m = ANNOUNCED.exec(text ?? '')
  if (!m) return null
  return { url: m[0], port: Number(m[1]) }
}

export function tail(text, n = 40) {
  return (text ?? '').split('\n').slice(-n).join('\n')
}

export function logPathFor(root, app) {
  return join(root, STATE_DIR, 'logs', `${app}.log`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readLog(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function shell(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
  } catch {
    return ''
  }
}

/** The process group a pid belongs to. Every descendant of a detached start
 *  inherits the leader's group, which is what makes the lookup below work when
 *  the listener is several processes removed from the one we spawned. */
export function pgidOf(pid, io = {}) {
  const exec = io.ps ?? shell
  const n = Number(String(exec('ps', ['-o', 'pgid=', '-p', String(pid)])).trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/** The port the process group itself is listening on. The fallback for apps
 *  that announce nothing, which is why the fixture ships a `quiet` role.
 *
 *  Two lookups, because the shape depends on the start command. `sh -c 'node
 *  app.mjs'` execs, so the pid we spawned IS the server. `make dev` does not:
 *  the leader stays `make` and the listener is a grandchild with a different
 *  pid but the same process group. */
function portOfGroup(pid, io = {}) {
  const enumerate = io.listeners ?? enumerateListeners
  const { items } = enumerate({ root: '/nonexistent-so-nothing-is-mine', io })
  const direct = items.find((i) => i.pid === pid)
  if (direct) return direct.port
  for (const item of items) {
    if (pgidOf(item.pid, io) === pid) return item.port
  }
  return null
}

const entryFor = ({ name, pid, url, port, start, cwd, log, ready }) => ({
  app: name,
  pid,
  url,
  port,
  command: start,
  cwd,
  log,
  startedAt: new Date().toISOString(),
  ready,
  source: 'runfile',
})

export async function startApp({
  name, start, ready, cwd, root, timeoutMs = 120_000, io = {},
}) {
  const log = logPathFor(root, name)
  mkdirSync(dirname(log), { recursive: true })
  // 'w' not 'a': the log describes this run, and a previous run's announcement
  // would otherwise be read as this run's port.
  const fd = openSync(log, 'w')

  let child
  try {
    child = spawn(start, {
      cwd,
      shell: true,
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    closeSync(fd)
  }

  const pid = child.pid
  child.unref()

  let exited = null
  child.once('exit', (code, signal) => { exited = { code, signal } })

  const doProbe = io.probe ?? realProbe
  const deadline = Date.now() + timeoutMs
  let announced = null

  while (Date.now() < deadline) {
    await sleep(150)
    const text = readLog(log)

    if (exited) {
      return {
        problem: problem('START_FAILED', {
          app: name,
          command: start,
          exit: exited.code,
          signal: exited.signal,
          log,
          output: tail(text),
          fix: `the start command exited before becoming ready; see ${log}`,
        }),
      }
    }

    announced ??= announcedIn(text)

    // Ready when the configured marker appears, or when the announced URL
    // answers. Both together would deadlock an app that answers before it logs.
    const markerSeen = ready ? text.includes(ready) : false
    if (announced && (markerSeen || (!ready && (await doProbe(announced.url)).ok))) {
      return {
        entry: entryFor({
          name, pid, url: announced.url, port: announced.port, start, cwd, log, ready: true,
        }),
      }
    }

    // The quiet case: ready by its marker, but it never said where it listens.
    if (!announced && markerSeen) {
      const port = portOfGroup(pid, io)
      if (port) {
        return {
          entry: entryFor({
            name, pid, url: `http://localhost:${port}`, port, start, cwd, log, ready: true,
          }),
        }
      }
    }
  }

  // Timed out. Leave it running: killing a server that is merely slow to
  // compile is worse than reporting it, and the next `up` will find and wait
  // for it. Record it as not-ready so nothing treats it as usable.
  const text = readLog(log)
  const port = announced?.port ?? portOfGroup(pid, io)
  return {
    problem: problem(port ? 'NOT_READY' : 'NO_PORT_FOUND', {
      app: name,
      pid,
      port,
      log,
      waitedMs: timeoutMs,
      output: tail(text),
      fix: port
        ? `still not ready after ${Math.round(timeoutMs / 1000)}s; it is still running, see ${log}`
        : `no port was announced and none found for the process group; see ${log}`,
    }),
    entry: port
      ? entryFor({
          name, pid, url: `http://localhost:${port}`, port, start, cwd, log, ready: false,
        })
      : null,
  }
}

/** SIGTERM the group, then SIGKILL if it is still there. Negative pid is the
 *  whole group, which is the point of having started it detached. */
export async function stopGroup(pid, io = {}) {
  const isAlive = io.alive ?? alive
  const kill = io.kill ?? ((target, sig) => process.kill(target, sig))
  const graceMs = io.graceMs ?? 3000

  if (!isAlive(pid)) return 'gone'
  try {
    kill(-pid, 'SIGTERM')
  } catch {
    try { kill(pid, 'SIGTERM') } catch { return 'gone' }
  }

  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    await sleep(100)
    if (!isAlive(pid)) return 'stopped'
  }
  try { kill(-pid, 'SIGKILL') } catch { /* already gone */ }
  await sleep(200)
  return 'killed'
}
