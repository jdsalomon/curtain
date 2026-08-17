// The one thing every phase calls, and the only thing that has to be pure: it
// never starts, kills, seeds or writes. That purity is what makes it callable
// from `up`, `down` and `walk` alike, and testable with no app running.
import { join } from 'node:path'
import { workspace as resolveWorkspace } from './workspace.mjs'
import { loadConfig, STATE_DIR } from './config.mjs'
import { classifyEnv } from './env.mjs'
import { verifyRunfile } from './runfile.mjs'
import { listeners as enumerateListeners, matchFingerprint as realFingerprint } from './listeners.mjs'
import { envStatus, envProblems } from './envfiles.mjs'
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

  // 1b. Answering is not the same as working. `probe` accepts any HTTP status on
  //     purpose, because a healthy app's root often redirects or 404s, so a dev
  //     server with a broken build answers 500 and passes as live. An app that
  //     declares a fingerprint has already said what it must serve, so that is
  //     the health check: ask it about this workspace's OWN server, not only
  //     about strangers on other ports, which is all it did before.
  //
  //     The service stays in `services`, marked unhealthy, on purpose. Dropping
  //     it would have `up` start a second copy of a server already holding the
  //     port, and two broken servers are worse than one.
  const fingerprint = io.matchFingerprint ?? realFingerprint
  for (const [name, service] of Object.entries(services)) {
    const app = config.apps?.[name]
    if (!app?.fingerprint) continue
    if (await fingerprint(service.url, app.fingerprint, io)) continue
    services[name] = { ...service, healthy: false }
    problems.push(problem('UNHEALTHY', {
      app: name,
      port: service.port,
      path: app.fingerprint.path,
      expect: app.fingerprint.expect,
      fix: `${service.url}${app.fingerprint.path} answered without `
        + `${JSON.stringify(app.fingerprint.expect)}, so this is not a working ${name}; `
        + `read ${service.log ?? 'its log'}. A checkout that has never run needs its `
        + 'dependencies installed, and any workspace packages built, before its server can serve.',
    }))
  }

  // 2. Everything else that is listening.
  const enumerate = io.listeners ?? enumerateListeners
  const { items, problems: listenerProblems } = await enumerate({ root: workspace.root, io })
  problems.push(...listenerProblems)

  const claimedPorts = new Set(Object.values(services).map((s) => s.port))
  const foreign = items.filter((i) => i.kind === 'foreign')
  const loose = items.filter((i) => i.kind !== 'foreign' && !claimedPorts.has(i.port))

  // 3. A listener the runfile forgot is attributed only by fingerprint, and only
  //    when it runs from this git root. Both halves are load-bearing.
  //
  //    `mine` alone is not enough: it says the repo is mine, not which app the
  //    process is, so a fingerprint must confirm it. And a fingerprint alone is
  //    not enough either: a server whose git root we cannot resolve is a
  //    stranger's, and one left over from a deleted checkout will still serve a
  //    matching login page. Adopting it drives a walk against dead code.
  const unclaimed = []
  for (const item of loose) {
    const url = `http://localhost:${item.port}`
    let attributed = null
    for (const [name, app] of Object.entries(config.apps ?? {})) {
      if (item.kind !== 'mine' || name in services || !app.fingerprint) continue
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

  // A problem is raised only for unclaimed listeners running from THIS git
  // root: those are actionable (yours, so fingerprint or stop them). Everything
  // else on the machine (a music player, Docker, a browser) stays in the
  // `unclaimed` data and the report's ambient count, because a problem that
  // fires on every run of a busy laptop stops being read; it once disagreed
  // with doctor's debt about the very same listeners, which used the correct
  // filter. One problem for the set, not one per listener, for the same reason.
  const ours = unclaimed.filter((u) => u.kind === 'mine')
  if (ours.length) {
    problems.push(problem('UNCLAIMED_SERVER', {
      port: ours[0].port,
      pid: ours[0].pid,
      count: ours.length,
      ports: ours.map((u) => u.port),
      fix: ours.length === 1
        ? 'this workspace has a listener no app claims; add a `fingerprint` for it in curtain.json, or stop the process'
        : `this workspace has ${ours.length} listeners no app claims; `
          + 'add a `fingerprint` in curtain.json for each, or stop them',
    }))
  }

  // 4. Env files. Read-only here, like everything else in resolve: the status
  //    is reported and the writes (linking, adopting) belong to `up` and
  //    `curtain env`. Values never appear in this output, only file states and
  //    missing key names.
  const envFiles = configured ? envStatus({ configDir, config }) : { name: null, entries: [] }
  problems.push(...envProblems(envFiles))

  // 5. Configured apps with nothing live behind them.
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
    envFiles,
    artifacts: { root: join(workspace.root, STATE_DIR) },
    env: target ? classifyEnv(target, config.envs) : 'local',
    target,
    problems,
  }
}
