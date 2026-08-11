// Where am I? Everything else keys off the answer, so it is deliberately the
// smallest module: four git questions and a hash.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'

/** Trimmed stdout, or null for any failure. Callers treat null as "not a repo". */
export function gitRunner(cwd) {
  return (args) => {
    try {
      const out = execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out.trim() || null
    } catch {
      return null
    }
  }
}

/** 8 hex of the absolute root path. Short enough to namespace a tenant slug,
 *  long enough that two checkouts on one machine will not collide. */
export function workspaceId(root) {
  return createHash('sha256').update(root).digest('hex').slice(0, 8)
}

export function workspace(cwd = process.cwd(), git = gitRunner(cwd)) {
  const root = git(['rev-parse', '--show-toplevel'])
  if (!root) {
    const loose = resolvePath(cwd)
    return { root: loose, id: workspaceId(loose), kind: 'loose', branch: null }
  }
  // A worktree's git dir lives under the main checkout's; a main checkout's is
  // its own. This is the only reliable distinction: path shape is not one,
  // because a worktree is often created *inside* the main checkout.
  const gitDir = git(['rev-parse', '--absolute-git-dir'])
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const kind = gitDir && commonDir && gitDir !== commonDir ? 'worktree' : 'main'

  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  return {
    root,
    id: workspaceId(root),
    kind,
    branch: head && head !== 'HEAD' ? head : null,
  }
}
