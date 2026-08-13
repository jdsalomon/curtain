// Start only the gap. Never restart a healthy server: that reuse is the single
// largest latency win here, because a cold framework compile costs far more
// than everything else this tool does put together.
import { resolve } from './resolve.mjs'
import { startApp } from './spawn.mjs'
import { upsertEntry } from './runfile.mjs'
import { link as linkEnv } from './envfiles.mjs'
import { problem, isBlocking } from './problems.mjs'

/** The port a failed start was fighting over, read from what it printed.
 *
 *  Ports are never stored in config, so there is no declared port to compare a
 *  collision against. The evidence is in the output: node says EADDRINUSE, and
 *  most dev servers say "port N is in use" before falling back to another one. */
export function portInUseIn(text) {
  if (!text) return null
  const inUse = /port\s+(\d+)\s+is\s+(?:already\s+)?in\s+use/i.exec(text)
  if (inUse) return Number(inUse[1])
  const addrInUse = /EADDRINUSE[^\n]*?:(\d+)\b/i.exec(text)
  if (addrInUse) return Number(addrInUse[1])
  return null
}

export async function up({ apps = [], cwd = process.cwd(), io = {} } = {}) {
  const resolved = await resolve({ cwd, io })
  const configured = Object.keys(resolved.config.apps ?? {})

  if (!resolved.configured) {
    return {
      started: {}, reused: {}, blocked: [],
      problems: resolved.problems.filter((p) => p.code === 'NO_CONFIG'),
      exitCode: 1,
    }
  }

  const unknown = apps.filter((a) => !configured.includes(a))
  if (unknown.length) {
    return {
      started: {}, reused: {}, blocked: [],
      problems: [problem('NOT_RUNNING', {
        app: unknown.join(', '),
        fix: `not configured; this repo declares: ${configured.join(', ')}`,
      })],
      exitCode: 2,
    }
  }

  const wanted = apps.length ? apps : configured
  const reused = {}
  const started = {}
  const problems = []

  // A fresh clone or worktree is missing its gitignored env files. When the
  // canonical values already exist, the fix is a symlink, which is exactly the
  // kind of workspace-local, non-destructive write `up` is for: repair it and
  // say so, rather than reporting a problem the user then fixes by hand.
  const linked = resolved.configured ? linkEnv({ configDir: resolved.configDir, config: resolved.config }).linked : []

  // What linking cannot fix: values that exist nowhere. Starting such an app
  // anyway produces a crash whose log blames the app; refusing names the cause.
  const noValues = new Set(
    resolved.problems.filter((p) => p.code === 'NO_ENV_VALUES').map((p) => p.app),
  )
  problems.push(...resolved.problems.filter((p) => p.code === 'NO_ENV_VALUES' && wanted.includes(p.app)))

  // Who holds which port, so a collision can name the owner. Foreign servers
  // get a friendly checkout name; anything else on the machine at least gets a
  // command and a pid, which still beats a bare failure.
  const holderByPort = new Map()
  for (const item of resolved.unclaimed) {
    holderByPort.set(item.port, { ...item, owner: item.command ?? `pid ${item.pid}` })
  }
  for (const f of resolved.foreign) holderByPort.set(f.port, f)

  for (const name of wanted) {
    if (resolved.services[name]) {
      reused[name] = resolved.services[name]
      continue
    }
    if (noValues.has(name)) continue
    const app = resolved.config.apps[name]
    const result = await startApp({
      name,
      start: app.start,
      ready: app.ready ?? null,
      cwd: resolved.configDir,
      root: resolved.workspace.root,
      timeoutMs: app.timeoutMs ?? 120_000,
      io,
    })

    // Record whatever we learned, even a not-ready process: the next `up` must
    // find it rather than starting a second copy.
    if (result.entry) upsertEntry(resolved.workspace.root, name, result.entry)

    if (result.problem) {
      problems.push(result.problem)
      const contested = portInUseIn(result.problem.output)
      const clash = contested === null ? null : holderByPort.get(contested)
      if (clash) {
        problems.push(problem('PORT_TAKEN', {
          app: name,
          port: contested,
          owner: clash.owner,
          fix: `${contested} belongs to ${clash.owner}; free it or configure a different port`,
        }))
      }
      continue
    }
    started[name] = result.entry
  }

  return {
    started, reused, blocked: [],
    linkedEnv: linked.map((e) => ({ app: e.app, file: e.rel })),
    problems,
    exitCode: isBlocking(problems) ? 1 : 0,
  }
}
