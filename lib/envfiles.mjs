// Env files are the reason a fresh checkout cannot start: they are gitignored,
// and gitignored files travel with neither a clone nor a worktree. The model
// splits env into the two things it actually is:
//
//   - the SCHEMA (which variables an app needs) is `.env.example`, committed,
//     and therefore versioned with the branch;
//   - the VALUES are one canonical file per project on this machine, created
//     once, that every checkout reaches through a symlink.
//
// Values are deliberately per-project, not per-checkout: every worktree points
// at the same local infrastructure, so twenty checkouts sharing one values file
// is the correct arrangement, not a shortcut. What differs per branch is the
// schema, and that drift is detectable: the branch's example names a key the
// canonical file was created before it existed.
//
// Two rules with no exceptions. Values never appear in any output, log or JSON;
// this module reports key NAMES only, which are already public in the example.
// And the canonical file is written once, at adoption, and never again: nothing
// in Curtain can overwrite it, which is what makes pointing every checkout at
// it safe.
import {
  existsSync, lstatSync, readFileSync, mkdirSync, renameSync, symlinkSync, unlinkSync,
} from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { problem } from './problems.mjs'

/** One store per project on this machine, keyed by the committed `name` in
 *  curtain.json. Nothing derived from a checkout path can work here: every
 *  worktree has a different path, and they must all reach the same values.
 *
 *  A project that already keeps its values somewhere says where with `envStore`,
 *  and Curtain uses that directory rather than inventing a second one. Without
 *  it, a team whose store predates Curtain is told its values exist nowhere and
 *  invited to adopt, which copies live credentials into a rival store: two files
 *  to keep in step, and the single-source rule quietly broken. Paths inside the
 *  store mirror the checkout either way, so a store already laid out that way
 *  needs no migration. */
export function storeRoot(name, envStore = null) {
  if (envStore) {
    const expanded = envStore.startsWith('~') ? join(homedir(), envStore.slice(1)) : envStore
    return resolvePath(expanded)
  }
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'curtain', name)
}

/** Key names only. The values on those lines never leave this module. */
export function envKeys(text) {
  const keys = []
  for (const line of String(text).split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m) keys.push(m[1])
  }
  return keys
}

/** The committed example that declares this file's schema, or null. Both common
 *  conventions are honoured: `.env.local.example` beside the file, and a plain
 *  `.env.example` in the same directory. */
export function exampleFor(abs) {
  const suffixed = `${abs}.example`
  if (existsSync(suffixed)) return suffixed
  const plain = join(dirname(abs), '.env.example')
  if (existsSync(plain)) return plain
  return null
}

function stateOf(abs) {
  try {
    return lstatSync(abs).isSymbolicLink() ? 'linked' : 'file'
  } catch {
    return 'missing'
  }
}

/** Every declared env file across every app, with where it is and what it lacks.
 *  Read-only, so resolve can call it. Paths are relative to the config dir,
 *  which is also where start commands run. */
export function envStatus({ configDir, config }) {
  const name = config.name ?? null
  // An explicit store needs no `name`: the name exists only to key a store
  // Curtain invented, and a project that brought its own has already said where.
  const store = config.envStore ? storeRoot(name, config.envStore)
    : name ? storeRoot(name)
    : null
  const entries = []
  for (const [app, spec] of Object.entries(config.apps ?? {})) {
    for (const rel of spec.env ?? []) {
      const abs = join(configDir, rel)
      const canonical = store ? join(store, rel) : null
      const state = stateOf(abs)
      const example = exampleFor(abs)

      // Schema drift, by name only: keys the example declares that the file
      // this checkout would actually read does not define.
      let missingKeys = []
      const source = state !== 'missing' ? abs
        : canonical && existsSync(canonical) ? canonical
        : null
      if (example && source) {
        const have = new Set(envKeys(readFileSync(source, 'utf8')))
        missingKeys = envKeys(readFileSync(example, 'utf8')).filter((k) => !have.has(k))
      }

      entries.push({
        app,
        rel,
        abs,
        state,                                            // 'file' | 'linked' | 'missing'
        canonical,
        canonicalExists: canonical ? existsSync(canonical) : false,
        example,
        missingKeys,
      })
    }
  }
  return { name, store, entries }
}

/** The problems an env status implies. Split from envStatus so resolve can
 *  attach them while `env link`/`adopt` reason about entries directly. */
export function envProblems({ name, store = null, entries }) {
  const problems = []
  if (entries.length && !store) {
    problems.push(problem('NO_PROJECT_NAME', {
      fix: 'apps declare env files, so curtain.json needs a top-level "name" '
        + 'to key the shared values store, or an "envStore" path if this project '
        + 'already keeps its values somewhere; add one and re-run',
    }))
    return problems
  }
  for (const e of entries) {
    if (e.state === 'missing' && e.canonicalExists) {
      problems.push(problem('MISSING_ENV', {
        app: e.app,
        file: e.rel,
        fix: '`curtain up` links it from the store, or run `curtain env link`',
      }))
    }
    if (e.state === 'missing' && !e.canonicalExists) {
      problems.push(problem('NO_ENV_VALUES', {
        app: e.app,
        file: e.rel,
        fix: `no values exist anywhere for ${e.rel}; write it in this checkout `
          + '(ask the user for the values) then run `curtain env adopt`',
      }))
    }
    if (e.missingKeys.length) {
      problems.push(problem('ENV_KEYS_MISSING', {
        app: e.app,
        file: e.rel,
        keys: e.missingKeys,
        fix: `this branch's example declares ${e.missingKeys.join(', ')}; `
          + `add ${e.missingKeys.length === 1 ? 'it' : 'them'} to ${e.canonical ?? e.rel}`,
      }))
    }
  }
  return problems
}

/**
 * Move real files into the store and leave symlinks behind. Create-once is
 * enforced here: a canonical file that already exists is never touched, and a
 * checkout file that disagrees with it is a conflict for a human, not a merge.
 */
export function adopt({ configDir, config }) {
  const status = envStatus({ configDir, config })
  if (!status.store && status.entries.length) {
    return { adopted: [], linked: [], problems: envProblems(status) }
  }

  const adopted = []
  const linked = []
  const problems = []
  for (const e of status.entries) {
    if (e.state !== 'file') continue
    if (e.canonicalExists) {
      if (readFileSync(e.abs, 'utf8') === readFileSync(e.canonical, 'utf8')) {
        // Byte-identical: replacing the copy with a link loses nothing.
        unlinkSync(e.abs)
        symlinkSync(e.canonical, e.abs)
        linked.push(e)
      } else {
        problems.push(problem('ENV_CONFLICT', {
          app: e.app,
          file: e.rel,
          fix: `${e.abs} and ${e.canonical} disagree; reconcile them by hand, `
            + 'then delete the checkout copy and run `curtain env link`',
        }))
      }
      continue
    }
    mkdirSync(dirname(e.canonical), { recursive: true })
    renameSync(e.abs, e.canonical)
    symlinkSync(e.canonical, e.abs)
    adopted.push(e)
  }
  return { adopted, linked, problems }
}

/** Create the missing symlinks a checkout needs, from values that already
 *  exist. This is the whole fix for a fresh clone or worktree, which is why
 *  `up` runs it implicitly. */
export function link({ configDir, config }) {
  const status = envStatus({ configDir, config })
  const linked = []
  for (const e of status.entries) {
    if (e.state !== 'missing' || !e.canonicalExists) continue
    mkdirSync(dirname(e.abs), { recursive: true })
    symlinkSync(e.canonical, e.abs)
    linked.push(e)
  }
  return { linked }
}

/** One human line per entry, for `curtain env` and the resolve report. */
export function renderEnv(entries) {
  const lines = []
  for (const e of entries) {
    const where = e.state === 'linked' ? 'linked'
      : e.state === 'file' ? 'file (run `curtain env adopt` to share it)'
      : e.canonicalExists ? 'missing, values in store'
      : 'missing, no values anywhere'
    const drift = e.missingKeys.length ? `  missing ${e.missingKeys.join(', ')}` : ''
    lines.push(`  ${e.app.padEnd(10)} ${e.rel.padEnd(24)} ${where}${drift}`)
  }
  return lines
}
