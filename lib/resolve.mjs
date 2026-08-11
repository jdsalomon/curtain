// The one thing every phase calls, and the only thing that has to be pure: it
// never starts, kills, seeds or writes. That purity is what makes it callable
// from `up`, `down` and `walk` alike, and testable with no app running.
import { join } from 'node:path'
import { workspace as resolveWorkspace } from './workspace.mjs'
import { loadConfig, STATE_DIR } from './config.mjs'
import { classifyEnv } from './env.mjs'
import { verifyRunfile } from './runfile.mjs'
import { listeners as enumerateListeners, matchFingerprint as realFingerprint } from './listeners.mjs'
import { problem } from './problems.mjs'

export async function resolve({ cwd = process.cwd(), target = null, io = {} } = {}) {
  const problems = []

  const workspace = resolveWorkspace(cwd, io.git)
  const { configured, config, dir: configDir, sources } = loadConfig(cwd, workspace.root)
  if (!configured) {
    problems.push(problem('NO_CONFIG', { fix: 'run `curtain setup` in this repo' }))
  }

  // 1. The runfile, verified. Never trusted without kill -0 plus an HTTP probe.
  const verified = await verifyRunfile(workspace.root, io)
  const services = { ...verified.live }
  for (const entry of verified.notAnswering) {
    problems.push(problem('NOT_ANSWERING', {
      app: entry.app,
      port: entry.port,
      fix: `server is listening but not responding; check ${entry.log ?? 'its log'}`,
    }))
  }

  // 2. Everything else that is listening.
  const enumerate = io.listeners ?? enumerateListeners
  const { items, problems: listenerProblems } = await enumerate({ root: workspace.root, io })
  problems.push(...listenerProblems)

  const claimedPorts = new Set(Object.values(services).map((s) => s.port))
  const foreign = items.filter((i) => i.kind === 'foreign')
  const loose = items.filter((i) => i.kind !== 'foreign' && !claimedPorts.has(i.port))

  // 3. A listener the runfile forgot is attributed only by fingerprint. `mine`
  //    is not enough: it says the repo is mine, not which app the process is.
  const fingerprint = io.matchFingerprint ?? realFingerprint
  const unclaimed = []
  for (const item of loose) {
    const url = `http://localhost:${item.port}`
    let attributed = null
    for (const [name, app] of Object.entries(config.apps ?? {})) {
      if (name in services || !app.fingerprint) continue
      if (await fingerprint(url, app.fingerprint, io)) {
        attributed = name
        break
      }
    }
    if (attributed) {
      services[attributed] = { ...item, app: attributed, url, ready: true, source: 'fingerprint' }
    } else {
      unclaimed.push(item)
    }
  }

  // One problem for the whole set, not one per listener. `lsof` sees every socket
  // on the machine, so a real laptop has dozens of these (a music player, Docker,
  // a browser). Raising one problem each buried the two that mattered under
  // thirty that did not. The full list stays in `unclaimed` because `up` needs it
  // to name whoever holds a port it wanted.
  if (unclaimed.length) {
    problems.push(problem('UNCLAIMED_SERVER', {
      port: unclaimed[0].port,
      pid: unclaimed[0].pid,
      count: unclaimed.length,
      ports: unclaimed.map((u) => u.port),
      fix: unclaimed.length === 1
        ? 'add a `fingerprint` for this app in curtain.json, or stop the process'
        : `${unclaimed.length} listeners are not attributable to a configured app; `
          + 'add a `fingerprint` in curtain.json for any that are yours',
    }))
  }

  // 4. Configured apps with nothing live behind them.
  for (const name of Object.keys(config.apps ?? {})) {
    if (name in services) continue
    if (problems.some((p) => p.code === 'NOT_ANSWERING' && p.app === name)) continue
    problems.push(problem('NOT_RUNNING', { app: name, fix: `run \`curtain up ${name}\`` }))
  }

  return {
    workspace,
    configured,
    config,
    configDir,
    sources,
    services,
    foreign,
    unclaimed,
    artifacts: { root: join(workspace.root, STATE_DIR) },
    env: target ? classifyEnv(target, config.envs) : 'local',
    target,
    problems,
  }
}
