// Detect what we can, and hand the rest to the skill as questions. The CLI must
// never block on stdin: its caller is an agent, and a prompt inside a tool call
// is a hang. So detection and writing are separate, and the asking happens in
// between, in prose, where judgment belongs.
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { CONFIG_NAME, STATE_DIR } from './config.mjs'

/** What a framework prints when its dev server is serving, keyed by the
 *  dependency that identifies it. Case matters: the ready check is a substring
 *  match on real output. */
const READY_MARKERS = {
  next: 'Ready in',
  vite: 'ready in',
  nuxt: 'Local:',
  astro: 'ready in',
}

function depsOf(dir) {
  const path = join(dir, 'package.json')
  if (!existsSync(path)) return {}
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    return { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    return {}
  }
}

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

  // The project name keys the shared env-values store, so a config without one
  // breaks `curtain env` for every checkout. Propose rather than silently
  // derive: a human should see what the store will be called.
  const name = pkg?.name && !pkg.name.startsWith('@') ? pkg.name : basename(root)

  // An `.env.example` is a committed declaration that a gitignored sibling must
  // exist, which is exactly what `env` needs to know and exactly what a fresh
  // checkout is missing. Root and each app dir are checked.
  const envExamples = ['', ...dirs]
    .filter((d) => existsSync(join(root, d, '.env.example')))
    .map((d) => ({
      example: d ? `${d}/.env.example` : '.env.example',
      declare: d ? `${d}/.env.local` : '.env.local',
    }))

  // Frameworks announce readiness in known words; offer what the dependencies
  // imply instead of an empty options list.
  const readyOptions = [...new Set(
    ['', ...dirs].flatMap((d) => {
      const deps = depsOf(join(root, d))
      return Object.entries(READY_MARKERS)
        .filter(([dep]) => dep in deps)
        .map(([, marker]) => marker)
    }),
  )]

  const questions = []
  questions.push({
    key: 'name',
    ask: 'What should the project be called? It keys the shared env-values store, so every checkout must agree.',
    options: [name],
  })
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
    options: readyOptions,
  })
  if (envExamples.length) {
    questions.push({
      key: 'env',
      ask: 'These committed examples imply gitignored env files an app needs; declare them so a fresh checkout can be repaired?',
      options: envExamples,
    })
  }

  return {
    name,
    packageManager,
    scripts: Object.keys(pkg?.scripts ?? {}),
    makeTargets: fromMake.map((c) => c.start),
    appDirs: dirs,
    envExamples,
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
    if (app.env?.length && !config.name) {
      throw new Error(`app "${name}" declares env files, so the config needs a top-level "name" to key the values store`)
    }
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
