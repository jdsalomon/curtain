// Delete what you are done with, and nothing you might still want.
//
// Two halves, and the difference between them is the whole design:
//
//   - ARTIFACTS are Curtain's own (recordings, logs). It made them, it knows
//     exactly what they are and what they weigh, so it can measure them and
//     remove them itself.
//   - DATA is yours. Curtain cannot know what it means, so a seed that can undo
//     itself says so by exporting `cleanup`, and Curtain calls it. The script
//     that made the data is the script that unmakes it, in the same file, which
//     is the only way the two stay in step.
//
// Invoked bare this is a dry run: it measures, it lists, and it deletes nothing.
// A dry run never calls a host teardown either, not even to ask what it would
// do, because a script that ignores a `dryRun` flag deletes for real and the
// safety of the preview would rest on someone else's care. So Curtain reports
// exactly what it owns and only *names* the teardowns it would invoke. Being
// honest about that boundary is better than a preview that might be lying.
//
// Only seeds this workspace actually recorded running are candidates, so
// cleanup cannot reach another checkout's data. And nothing here can reach the
// infrastructure underneath it: stopping a server is not deleting a database,
// and neither is deleting a row.
import { readdirSync, statSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { workspace as resolveWorkspace } from './workspace.mjs'
import { loadConfig, STATE_DIR } from './config.mjs'
import { seedsDir, readTenant, makeRun } from './seed.mjs'
import { problem } from './problems.mjs'
import { pathToFileURL } from 'node:url'

/** Bytes and file count under a path, following nothing. */
export function measure(path) {
  let bytes = 0
  let files = 0
  const walk = (p) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry))
      return
    }
    bytes += st.size
    files += 1
  }
  walk(path)
  return { bytes, files }
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** Everything cleanup would consider, measured. Writes nothing, ever. */
export function inventory({ cwd = process.cwd(), io = {} } = {}) {
  const ws = resolveWorkspace(cwd, io.git)
  const { configured, config, dir: configDir } = loadConfig(cwd, ws.root)
  const state = join(ws.root, STATE_DIR)

  const artifacts = []
  for (const [kind, dir] of [['recording', join(state, 'walks')], ['log', join(state, 'logs')]]) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue          // .DS_Store and friends
      const path = join(dir, entry)
      artifacts.push({ kind, name: entry.replace(/\.log$/, ''), path, ...measure(path) })
    }
  }

  // A seed is a data candidate only if this workspace recorded running it AND
  // the script says it can undo itself.
  const data = []
  const recorded = existsSync(join(state, 'seeds'))
    ? readdirSync(join(state, 'seeds')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    : []
  for (const name of recorded) {
    data.push({
      seed: name,
      tenant: readTenant(ws.root, name),
      file: join(seedsDir(configDir ?? ws.root), `${name}.mjs`),
      record: join(state, 'seeds', `${name}.json`),
    })
  }

  return {
    workspace: ws,
    configured,
    config,
    configDir,
    artifacts,
    data,
    bytes: artifacts.reduce((n, a) => n + a.bytes, 0),
  }
}

/** Does this seed know how to undo itself? Answered by importing it, which is
 *  why the inventory alone does not: listing should not execute anything. */
async function teardownOf(file) {
  if (!existsSync(file)) return null
  const mod = await import(pathToFileURL(file).href)
  return typeof mod.cleanup === 'function' ? mod.cleanup : null
}

/**
 * Bare: measure and list, delete nothing. With `yes`, remove the artifacts and
 * invoke each seed's own teardown.
 */
export async function cleanup({ cwd = process.cwd(), yes = false, io = {} } = {}) {
  const inv = inventory({ cwd, io })
  const problems = []

  // Which recorded seeds can actually undo themselves, named but never called
  // during a dry run.
  const undoable = []
  for (const d of inv.data) {
    const teardown = await teardownOf(d.file).catch(() => null)
    if (teardown) undoable.push({ ...d, teardown })
  }

  if (!yes) {
    return {
      dryRun: true,
      artifacts: inv.artifacts,
      data: undoable.map(({ teardown, ...d }) => d),
      bytes: inv.bytes,
      removed: [],
      problems,
      exitCode: 0,
    }
  }

  // Data first: an artifact is cheap to lose, and a teardown that fails should
  // not do so after its recording has already been deleted.
  const removed = []
  for (const d of undoable) {
    try {
      await d.teardown({
        run: makeRun({ cwd: inv.configDir ?? inv.workspace.root, exec: io.exec }),
        workspace: inv.workspace,
        tenant: d.tenant,
        log: (...a) => process.stderr.write(`  ${a.join(' ')}\n`),
      })
      unlinkSync(d.record)
      removed.push({ kind: 'data', name: d.seed })
    } catch (err) {
      problems.push(problem('CLEANUP_FAILED', {
        seed: d.seed,
        message: err.message,
        fix: `${d.seed} could not undo itself; its data is still there and its record is kept`,
      }))
    }
  }

  for (const a of inv.artifacts) {
    rmSync(a.path, { recursive: true, force: true })
    removed.push({ kind: a.kind, name: a.name, bytes: a.bytes })
  }

  return {
    dryRun: false,
    artifacts: inv.artifacts,
    data: undoable.map(({ teardown, ...d }) => d),
    bytes: inv.bytes,
    removed,
    problems,
    exitCode: problems.length ? 1 : 0,
  }
}
