// What did this workspace start, and is it still there? The file is a claim;
// verification is what makes it a fact. Never trusted without both checks.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { STATE_DIR } from './config.mjs'

export function runfilePath(root) {
  return join(root, STATE_DIR, 'services.json')
}

export function readRunfile(root) {
  const path = runfilePath(root)
  if (!existsSync(path)) return { apps: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { apps: parsed?.apps ?? {} }
  } catch {
    // Disposable state: a corrupt runfile is an empty runfile, not an error.
    return { apps: {} }
  }
}

/** Atomic, so a crash mid-write cannot leave a truncated claim behind. */
export function writeRunfile(root, apps) {
  const path = runfilePath(root)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ apps }, null, 2)}\n`)
  renameSync(tmp, path)
}

export function upsertEntry(root, name, entry) {
  const { apps } = readRunfile(root)
  apps[name] = entry
  writeRunfile(root, apps)
}

export function removeEntry(root, name) {
  const { apps } = readRunfile(root)
  delete apps[name]
  writeRunfile(root, apps)
}

/** EPERM means the pid exists but belongs to someone else, which is still alive. */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

/** Any HTTP status proves the server answers. A 404 or a 302 is an answer;
 *  requiring 200 would call a healthy app dead because its root route redirects. */
export async function probe(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: err.name ?? 'Error' }
  }
}

/** Reads and classifies. Writes nothing: resolve() calls this and stays pure. */
export async function verifyRunfile(root, io = {}) {
  const isAlive = io.alive ?? alive
  const doProbe = io.probe ?? probe
  const { apps } = readRunfile(root)

  const live = {}
  const dropped = []
  const notAnswering = []

  await Promise.all(Object.entries(apps).map(async ([name, entry]) => {
    if (!isAlive(entry.pid)) {
      dropped.push(entry)
      return
    }
    const result = await doProbe(entry.url)
    if (result.ok) live[name] = { ...entry, source: 'runfile', status: result.status }
    else notAnswering.push(entry)
  }))

  return { live, dropped, notAnswering }
}
