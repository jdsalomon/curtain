// Stop only what this workspace claims. Deliberately does not call resolve():
// a broken curtain.json must never be able to trap a running server, and this
// is the command that proves problems are values rather than throws.
//
// It removes nothing from disk. Files are `curtain cleanup`'s business.
import { workspace as resolveWorkspace } from './workspace.mjs'
import { readRunfile, removeEntry, alive as realAlive } from './runfile.mjs'
import { stopGroup } from './spawn.mjs'

export async function down({ apps = [], cwd = process.cwd(), io = {} } = {}) {
  const { root } = resolveWorkspace(cwd, io.git)
  const { apps: claimed } = readRunfile(root)
  const isAlive = io.alive ?? realAlive

  const wanted = apps.length ? apps.filter((a) => a in claimed) : Object.keys(claimed)

  const stopped = {}
  const alreadyGone = []
  const failed = []

  for (const name of wanted) {
    const entry = claimed[name]
    if (!isAlive(entry.pid)) {
      alreadyGone.push(name)
      removeEntry(root, name)
      continue
    }
    const outcome = await stopGroup(entry.pid, io)
    if (outcome === 'killed' && isAlive(entry.pid)) {
      failed.push({ app: name, pid: entry.pid, url: entry.url })
      continue    // keep the claim: something is still there and a human should know
    }
    stopped[name] = { ...entry, outcome }
    removeEntry(root, name)
  }

  return { stopped, alreadyGone, failed, exitCode: failed.length ? 1 : 0 }
}
