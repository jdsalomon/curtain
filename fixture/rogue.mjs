// A second copy of the app, running from a different git root, so the harness
// must classify it as `foreign` and name its owner rather than adopting it.
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const dir = mkdtempSync(join(tmpdir(), 'curtain-rogue-'))
cpSync(new URL('./app.mjs', import.meta.url), join(dir, 'app.mjs'))
writeFileSync(join(dir, 'curtain.json'), JSON.stringify({ apps: {} }, null, 2))
execFileSync('git', ['init', '-q'], { cwd: dir })

console.log(`rogue root: ${dir}`)
const child = spawn(process.execPath, ['app.mjs', process.argv[2] ?? 'admin'], {
  cwd: dir,
  stdio: 'inherit',
})
process.on('SIGINT', () => child.kill('SIGTERM'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
