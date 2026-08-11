// Detect what we can, and hand the rest to the skill as questions. The CLI must
// never block on stdin: its caller is an agent, and a prompt inside a tool call
// is a hang. So detection and writing are separate, and the asking happens in
// between, in prose, where judgment belongs.
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_NAME, STATE_DIR } from './config.mjs'

const LOCKFILES = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'package-lock.json': 'npm',
}

/** A target is a line-initial name followed by a colon. Skip .PHONY and friends,
 *  and skip variable assignments, which also contain a colon. */
export function parseMakefileTargets(text) {
  const out = []
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z0-9][A-Za-z0-9_.\-]*)\s*:(?!=)/.exec(line)
    if (m) out.push(m[1])
  }
  return [...new Set(out)]
}

const DEV_SHAPED = /(^|[:\-_])dev([:\-_]|$)/i

/** Strip the `dev` word out of a task name to get the app it refers to.
 *  Removing an inner word leaves its separators on both sides, so `guest-dev-prod`
 *  becomes `guest--prod` unless the doubles are collapsed. */
const appNameFrom = (name) =>
  name
    .replace(/(^|[:\-_])dev([:\-_]|$)/i, '$1$2')
    .replace(/[:\-_]{2,}/g, '-')
    .replace(/^[:\-_]|[:\-_]$/g, '') || 'app'

export function scriptCandidates(pkg, runner = 'npm run') {
  const scripts = pkg?.scripts ?? {}
  return Object.keys(scripts)
    .filter((name) => DEV_SHAPED.test(name))
    .map((name) => ({ app: appNameFrom(name), start: `${runner} ${name}`, source: 'package.json' }))
}

function makeCandidates(root) {
  const path = ['Makefile', 'makefile', 'GNUmakefile'].map((f) => join(root, f)).find(existsSync)
  if (!path) return []
  return parseMakefileTargets(readFileSync(path, 'utf8'))
    .filter((t) => DEV_SHAPED.test(t))
    .map((t) => ({ app: appNameFrom(t), start: `make ${t}`, source: 'Makefile' }))
}

function appDirs(root) {
  for (const parent of ['apps', 'packages', 'services']) {
    const dir = join(root, parent)
    if (!existsSync(dir)) continue
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'package.json')))
      .map((e) => `${parent}/${e.name}`)
    if (entries.length) return entries
  }
  return []
}

export function detectCandidates({ root }) {
  const pkgPath = join(root, 'package.json')
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null

  const packageManager =
    Object.entries(LOCKFILES).find(([f]) => existsSync(join(root, f)))?.[1] ?? 'npm'
  const runner = packageManager === 'npm' ? 'npm run' : `${packageManager} run`

  const fromMake = makeCandidates(root)
  const candidates = [...fromMake, ...scriptCandidates(pkg, runner)]
  const dirs = appDirs(root)

  const questions = []
  if (!candidates.length) {
    questions.push({
      key: 'apps',
      ask: 'How do you start this project in development? One command per app.',
      options: [],
    })
  } else {
    questions.push({
      key: 'apps',
      ask: 'Which of these start the apps you want Curtain to manage, and what should each be called?',
      options: candidates,
    })
  }
  questions.push({
    key: 'ready',
    ask: 'What does each app print when it is ready to serve? Leave it out to poll the URL instead.',
    options: [],
  })

  return {
    packageManager,
    scripts: Object.keys(pkg?.scripts ?? {}),
    makeTargets: fromMake.map((c) => c.start),
    appDirs: dirs,
    candidates,
    questions,
  }
}

export function applyConfig({ root, config, force = false }) {
  const path = join(root, CONFIG_NAME)
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists; pass --force to replace it`)
  }
  for (const [name, app] of Object.entries(config.apps ?? {})) {
    if (!app?.start) throw new Error(`app "${name}" needs a \`start\` command`)
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)

  // The state directory must be ignored, or a runfile full of local pids gets
  // committed and every teammate inherits a claim on processes that never
  // existed on their machine.
  const ignorePath = join(root, '.gitignore')
  const line = `${STATE_DIR}/`
  const current = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : ''
  let gitignored = false
  if (!current.split('\n').some((l) => l.trim() === line)) {
    appendFileSync(ignorePath, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`)
    gitignored = true
  }
  return { written: path, gitignored }
}
