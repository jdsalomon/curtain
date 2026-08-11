// Whose server is that? Enumeration is easy; classification is where the bug
// lived. A worktree is usually created inside the checkout it came from, so a
// path prefix test adopts another branch's server as your own. Compare git
// roots, exactly, and never guess.
import { execFileSync } from 'node:child_process'
import { readlinkSync } from 'node:fs'
import { basename, sep } from 'node:path'
import { gitRunner } from './workspace.mjs'
import { problem } from './problems.mjs'

const isWindows = process.platform === 'win32'

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
  } catch (err) {
    // lsof exits 1 when it simply found nothing, and still prints what it found.
    return typeof err.stdout === 'string' ? err.stdout : ''
  }
}

export function portOf(name) {
  if (!name) return null
  const cleaned = name.replace(/\s*\([A-Z]+\)\s*$/, '')
  const m = /:(\d+)$/.exec(cleaned)
  return m ? Number(m[1]) : null
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` emits p=pid, c=command, f=fd, n=name. */
export function parseListeners(text) {
  const seen = new Set()
  const out = []
  let pid = null
  let command = null
  for (const line of text.split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      pid = Number(value)
      command = null
    } else if (tag === 'c') {
      command = value
    } else if (tag === 'n') {
      const port = portOf(value)
      if (!port || pid === null) continue
      const key = `${pid}:${port}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ pid, command, port })
    }
  }
  return out
}

export function parseCwd(text) {
  for (const line of text.split('\n')) {
    if (line[0] === 'n') return line.slice(1)
  }
  return null
}

/** A label a human recognizes: the worktree name when there is one, else the folder.
 *  Both `worktrees/` and `.worktrees/` count, because the dotted spelling is the
 *  common one and matching only the bare form silently degrades to a bare
 *  basename, which is exactly the ambiguity the label exists to remove. */
export function ownerLabel(root) {
  const parts = root.split(sep)
  const i = parts.findLastIndex((p) => p === 'worktrees' || p === '.worktrees')
  if (i !== -1 && parts[i + 1]) return `worktrees/${parts[i + 1]}`
  return basename(root)
}

export function realCwdOf(pid) {
  if (process.platform === 'linux') {
    try {
      return readlinkSync(`/proc/${pid}/cwd`)
    } catch {
      // fall through to lsof, which also works on Linux
    }
  }
  return parseCwd(run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']))
}

export function classifyListener(listener, { root, cwdOf, gitRootOf }) {
  const cwd = cwdOf(listener.pid)
  const ownerRoot = cwd ? gitRootOf(cwd) : null
  if (ownerRoot && ownerRoot === root) return { ...listener, cwd, ownerRoot, kind: 'mine' }
  if (ownerRoot) {
    return { ...listener, cwd, ownerRoot, kind: 'foreign', owner: ownerLabel(ownerRoot) }
  }
  return { ...listener, cwd, ownerRoot: null, kind: 'unclaimed' }
}

/** Optional per-app confirmation for a server the runfile does not claim. */
export async function matchFingerprint(url, fingerprint, io = {}) {
  if (!fingerprint?.path || !fingerprint?.expect) return false
  const doFetch = io.fetch ?? fetch
  try {
    const res = await doFetch(new URL(fingerprint.path, url), {
      signal: AbortSignal.timeout(io.timeoutMs ?? 1500),
    })
    return (await res.text()).includes(fingerprint.expect)
  } catch {
    return false
  }
}

export function listeners({ root, io = {} }) {
  if (isWindows) {
    return {
      items: [],
      problems: [problem('UNSUPPORTED_PLATFORM', {
        platform: process.platform,
        fix: 'Curtain supports macOS and Linux in v1; service discovery is unavailable here',
      })],
    }
  }
  const exec = io.run ?? run
  const raw = parseListeners(exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']))

  // One git call per distinct cwd, not per listener: a monorepo happily has six
  // processes reporting the same directory.
  const cache = new Map()
  const gitRootOf = io.gitRootOf ?? ((cwd) => {
    if (!cache.has(cwd)) cache.set(cwd, gitRunner(cwd)(['rev-parse', '--show-toplevel']))
    return cache.get(cwd)
  })
  const cwdOf = io.cwdOf ?? realCwdOf

  return { items: raw.map((l) => classifyListener(l, { root, cwdOf, gitRootOf })), problems: [] }
}
