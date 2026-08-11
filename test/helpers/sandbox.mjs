import { cpSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FIXTURE = join(import.meta.dirname, '..', '..', 'fixture')

/** A throwaway git repo holding a copy of the fixture. realpath because macOS
 *  hands out /var/folders paths that git reports as /private/var/folders, and a
 *  root comparison that misses that is a false `foreign` classification. */
export async function sandbox(fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'curtain-sandbox-')))
  cpSync(FIXTURE, dir, { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'fixture@example.com')
  git('config', 'user.name', 'Fixture')
  git('add', '-A')
  git('commit', '-qm', 'fixture')
  try {
    return await fn(dir, git)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
