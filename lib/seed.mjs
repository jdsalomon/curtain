// Give a workspace data of its own.
//
// Curtain cannot know what your data means, so it does not try: a seed is a
// script you wrote, in your repo, and Curtain only runs it and remembers what
// it hands back. Every line of database knowledge stays yours, which is also
// why the engine can stay dependency-free.
//
// A seed is shaped exactly like a walk (`curtain/seeds/<name>.mjs`, an optional
// `meta`, a default async function) so there is one thing to learn rather than
// two. New states arrive as new files: adding `empty.mjs` cannot break
// `full.mjs`, whereas adding a branch to one parameterised script can break
// every state in it. That is the whole reason there is no options mechanism
// here, and it is deliberate rather than unfinished.
//
// The smallest useful seed is one line:
//
//     export default async ({ run }) => run('make provision')
//
// Return an object to make facts (a slug, a login) discoverable by a walk.
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { workspace as resolveWorkspace } from './workspace.mjs'
import { loadConfig, SOURCE_DIR, STATE_DIR } from './config.mjs'
import { problem } from './problems.mjs'

export const seedsDir = (configDir) => join(configDir, SOURCE_DIR, 'seeds')

/** Seeds this project has. A leading underscore marks a shared helper and keeps
 *  it off the menu, the same convention walks use for scratch probes. */
export function listSeeds(configDir) {
  const dir = seedsDir(configDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .map((f) => basename(f, '.mjs'))
    .sort()
}

const tenantPath = (root, name) => join(root, STATE_DIR, 'seeds', `${name}.json`)

/** What the last run of this seed returned, or null. A record for humans and
 *  for `curtain resolve`; never the source of truth for a walk, which re-runs
 *  the seed and uses the fresh answer. A stored slug outlives the data it
 *  names, exactly as a stored port outlives the server. */
export function readTenant(root, name) {
  try {
    return JSON.parse(readFileSync(tenantPath(root, name), 'utf8'))
  } catch {
    return null
  }
}

function writeTenant(root, name, tenant) {
  const path = tenantPath(root, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(tenant, null, 2)}\n`)
  return path
}

/** The shell a seed script gets. Output is captured so a failure can show what
 *  the command said instead of a stack trace, and the cwd is the config dir, so
 *  a seed runs where the project's own commands expect to run. */
export function makeRun({ cwd, exec = execSync, timeoutMs = 300_000 }) {
  return (command) => {
    try {
      return String(exec(command, {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) ?? '')
    } catch (err) {
      const detail = [err.stdout, err.stderr].filter(Boolean).join('').trim()
      const e = new Error(`\`${command}\` failed${detail ? `\n${detail}` : ''}`)
      e.command = command
      e.output = detail
      throw e
    }
  }
}

/**
 * Run one seed. Returns a result rather than throwing, so the CLI owns the exit
 * code and `--json` matches every other phase.
 */
export async function seed(name, { cwd = process.cwd(), io = {} } = {}) {
  const problems = []
  const ws = resolveWorkspace(cwd, io.git)
  const { configured, config, dir: configDir } = loadConfig(cwd, ws.root)

  if (!configured) {
    problems.push(problem('NO_CONFIG', { fix: 'run `curtain setup` in this repo' }))
    return { seed: name, tenant: null, problems, exitCode: 1 }
  }

  const available = listSeeds(configDir)
  const file = join(seedsDir(configDir), `${name}.mjs`)
  if (!name || !existsSync(file)) {
    problems.push(problem('NO_SUCH_SEED', {
      seed: name ?? null,
      available,
      fix: available.length
        ? `no seed named "${name}"; this project has ${available.join(', ')}`
        : `create ${join(SOURCE_DIR, 'seeds', `${name || '<name>'}.mjs`)}`,
    }))
    return { seed: name, tenant: null, available, problems, exitCode: 1 }
  }

  const mod = await import(pathToFileURL(file).href)
  const provision = mod.default
  if (typeof provision !== 'function') {
    problems.push(problem('NO_SUCH_SEED', {
      seed: name,
      available,
      fix: `${file} must export a default async function`,
    }))
    return { seed: name, tenant: null, available, problems, exitCode: 1 }
  }

  const ctx = {
    run: makeRun({ cwd: configDir, exec: io.exec }),
    workspace: ws,
    log: (...args) => process.stderr.write(`  ${args.join(' ')}\n`),
  }

  let tenant = null
  try {
    tenant = (await provision(ctx)) ?? null
  } catch (err) {
    problems.push(problem('SEED_FAILED', {
      seed: name,
      message: err.message,
      output: err.output ?? null,
      fix: 'the seed command failed; read its output above, do not retry blindly',
    }))
    return { seed: name, tenant: null, problems, exitCode: 1 }
  }

  const recorded = tenant ? writeTenant(ws.root, name, tenant) : null
  return { seed: name, tenant, recorded, meta: mod.meta ?? {}, problems, exitCode: 0 }
}
