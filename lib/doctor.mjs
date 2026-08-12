// Can this phase run, and what debt has accumulated? Reports, never deletes.
// Exit 1 only when something actually blocks, so a stale artifact never stops
// `up` and a missing tool never stops `down`.
import { resolve } from './resolve.mjs'
import { problem, isBlocking } from './problems.mjs'

const NODE_FLOOR = [20, 11, 0]

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

function gte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

export function checkEnvironment(io = {}) {
  const problems = []
  const version = io.nodeVersion ?? process.version
  if (!gte(parseVersion(version), NODE_FLOOR)) {
    problems.push(problem('NODE_TOO_OLD', {
      found: version,
      required: `>=${NODE_FLOOR.join('.')}`,
      fix: `upgrade node to ${NODE_FLOOR.join('.')} or later`,
    }))
  }
  return problems
}

export async function doctor({ cwd = process.cwd(), io = {} } = {}) {
  const checks = checkEnvironment(io)
  const resolved = await resolve({ cwd, io })
  const all = [...checks, ...resolved.problems]

  // Only listeners in this workspace are debt. Everything else listening on the
  // machine belongs to someone else and is not this project's to pay down.
  const debt = {
    unclaimedServers: resolved.unclaimed
      .filter((u) => u.kind === 'mine')
      .map((u) => ({
        port: u.port,
        pid: u.pid,
        command: u.command,
        suggestion: 'add a fingerprint for it in curtain.json, or stop the process',
      })),
    // v0.2.0 adds orphanTenants; v0.3.0 adds staleArtifacts with bytes.
  }

  return { resolved, checks, debt, exitCode: isBlocking(all) ? 1 : 0 }
}
