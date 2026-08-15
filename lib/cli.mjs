import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolve } from './resolve.mjs'
import { doctor } from './doctor.mjs'
import { up } from './up.mjs'
import { down } from './down.mjs'
import { walk, listWalks } from './walk.mjs'
import { seed, listSeeds, readTenant } from './seed.mjs'
import { cleanup, humanBytes } from './cleanup.mjs'
import { envStatus, envProblems, adopt, link, renderEnv } from './envfiles.mjs'
import { loadConfig } from './config.mjs'
import { detectCandidates, applyConfig } from './setup.mjs'
import { provisionBrowser, BROWSER_CACHE } from './browser.mjs'
import { workspace } from './workspace.mjs'
import { emit, renderResolved } from './report.mjs'

const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))

/** A problem's message can be several lines of a failed command's output; all of
 *  them belong under the code, not just the first. */
const indent = (text) => String(text).split('\n').map((l) => `  ${l}`).join('\n')

/** Global flags every command accepts. Command-specific options are merged in by each entry. */
const GLOBAL_OPTIONS = {
  json: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
}

export const COMMANDS = {
  // Shape: name: { summary, usage, options, run: async ({ values, positionals }) => number }
}

/** Commands the roadmap promises but which do not exist yet, mapped to the release
 *  that will bring them. ROADMAP.md and docs/DESIGN.md may reference these; skills
 *  and the README may not. Delete an entry the moment its command ships: the doc
 *  tests go red until you do, which is how the roadmap gets reread on every release. */
export const PLANNED = {
  actions: 'v0.7.0',
}

COMMANDS.setup = {
  summary: 'detect how this project starts, then write curtain.json',
  usage: [
    'Usage: curtain setup detect [--json]',
    '       curtain setup apply --config <file|-> [--force]',
    '       curtain setup browser',
    '',
    'detect is read-only and reports candidates plus the questions worth asking.',
    'apply writes curtain.json and gitignores the state directory.',
    'browser installs a shared Playwright and Chromium under your cache, so no',
    'project manifest gains a dependency it never asked for.',
  ].join('\n'),
  options: { config: { type: 'string' }, force: { type: 'boolean', default: false } },
  async run({ values, positionals }) {
    const [sub] = positionals
    const ws = workspace()

    if (sub === 'detect' || !sub) {
      const d = detectCandidates({ root: ws.root })
      const lines = [`root       ${ws.root}`, `name       ${d.name} (proposed)`, `packages   ${d.packageManager}`]
      if (d.appDirs.length) lines.push(`apps       ${d.appDirs.join(', ')}`)
      if (d.envExamples.length) {
        lines.push('env        ' + d.envExamples.map((e) => e.declare).join(', ') + '  (implied by committed examples)')
      }
      if (d.candidates.length) {
        lines.push('', 'candidate start commands')
        for (const c of d.candidates) lines.push(`  ${c.app.padEnd(12)} ${c.start}  (${c.source})`)
      } else {
        lines.push('', 'no start command detected')
      }
      lines.push('', 'still to answer')
      for (const q of d.questions) lines.push(`  ${q.ask}`)
      return emit(values, { ...d, root: ws.root }, lines.join('\n'))
    }

    if (sub === 'browser') {
      const r = await provisionBrowser({ log: (m) => process.stderr.write(`  ${m}\n`) })
      const lines = r.already
        ? [`ready    ${r.dir}`, 'a shared browser was already installed']
        : r.problems.length ? [] : [`installed ${r.dir}`, 'every checkout on this machine can use it']
      for (const p of r.problems) {
        lines.push('', p.code)
        if (p.message) lines.push(indent(p.message))
        if (p.fix) lines.push(`  ${p.fix}`)
      }
      return emit(values, { ...r, exitCode: r.problems.length ? 1 : 0 }, lines.join('\n'))
    }

    if (sub === 'apply') {
      if (!values.config) {
        process.stderr.write('curtain setup apply: --config <file|-> is required\n')
        return 2
      }
      const raw = values.config === '-'
        ? readFileSync(0, 'utf8')
        : readFileSync(values.config, 'utf8')
      let config
      try {
        config = JSON.parse(raw)
      } catch (err) {
        process.stderr.write(`curtain setup apply: config is not valid JSON: ${err.message}\n`)
        return 2
      }
      try {
        const r = applyConfig({ root: ws.root, config, force: values.force })
        return emit(values, r, `wrote ${r.written}${r.gitignored ? '\ngitignored .curtain/' : ''}`)
      } catch (err) {
        process.stderr.write(`curtain setup apply: ${err.message}\n`)
        return 1
      }
    }

    process.stderr.write(`curtain setup: unknown subcommand "${sub}"\n\n${COMMANDS.setup.usage}\n`)
    return 2
  },
}

COMMANDS.resolve = {
  summary: 'print the resolved target: workspace, config, services, problems',
  usage: 'Usage: curtain resolve [--target <url>] [--json]',
  options: { target: { type: 'string' } },
  async run({ values }) {
    // Always 0: resolve describes reality, it does not pass judgement on it.
    // Only `doctor` turns problems into an exit code.
    const r = await resolve({ target: values.target ?? null })
    return emit(values, { ...r, exitCode: 0 }, renderResolved(r))
  },
}

COMMANDS.up = {
  summary: 'start what is not running; reuse what is',
  usage: 'Usage: curtain up [app...] [--json]',
  async run({ values, positionals }) {
    const result = await up({ apps: positionals })
    const lines = []
    for (const [name, s] of Object.entries(result.started)) {
      lines.push(`started  ${name.padEnd(10)} ${s.url}  pid ${s.pid}`)
    }
    for (const [name, s] of Object.entries(result.reused)) {
      lines.push(`reused   ${name.padEnd(10)} ${s.url}  pid ${s.pid}`)
    }
    for (const l of result.linkedEnv ?? []) {
      lines.push(`linked   ${l.app.padEnd(10)} ${l.file} from the values store`)
    }
    for (const p of result.problems) {
      lines.push('', `${p.code}${p.app ? ` ${p.app}` : ''}`)
      if (p.fix) lines.push(`  ${p.fix}`)
      if (p.output) lines.push(p.output.split('\n').map((l) => `  | ${l}`).join('\n'))
    }
    if (!lines.length) lines.push('nothing configured to start')
    return emit(values, result, lines.join('\n'))
  },
}

COMMANDS.down = {
  summary: 'stop what this workspace started, and nothing else',
  usage: 'Usage: curtain down [app...] [--json]',
  async run({ values, positionals }) {
    const result = await down({ apps: positionals })
    const lines = []
    for (const [name, s] of Object.entries(result.stopped)) {
      lines.push(`stopped  ${name.padEnd(10)} was ${s.url}`)
    }
    for (const name of result.alreadyGone) lines.push(`gone     ${name.padEnd(10)} already stopped`)
    for (const f of result.failed) {
      lines.push(`FAILED   ${f.app.padEnd(10)} pid ${f.pid} would not die; check it by hand`)
    }
    if (!lines.length) lines.push('nothing to stop')
    return emit(values, result, lines.join('\n'))
  },
}

COMMANDS.env = {
  summary: 'where each declared env file is, and the links a checkout needs',
  usage: [
    'Usage: curtain env [--json]          status of every declared env file',
    '       curtain env link             create missing symlinks from the store',
    '       curtain env adopt           move real files into the store, link back',
    '',
    'Values never appear in any output; states and missing key names only.',
    'The store is written once per file, at adopt, and never overwritten.',
  ].join('\n'),
  async run({ values, positionals }) {
    const [sub] = positionals
    const ws = workspace()
    const { configured, config, dir: configDir } = loadConfig(process.cwd(), ws.root)
    if (!configured) {
      process.stderr.write('curtain env: no curtain.json here; run `curtain setup` first\n')
      return 1
    }

    if (sub === 'link' || sub === 'adopt') {
      const r = sub === 'link' ? { adopted: [], ...link({ configDir, config }) } : adopt({ configDir, config })
      const lines = []
      for (const e of r.adopted) lines.push(`adopted  ${e.app.padEnd(10)} ${e.rel} -> ${e.canonical}`)
      for (const e of r.linked) lines.push(`linked   ${e.app.padEnd(10)} ${e.rel}`)
      for (const p of r.problems ?? []) {
        lines.push('', `${p.code}${p.app ? ` ${p.app}` : ''}`)
        if (p.fix) lines.push(`  ${p.fix}`)
      }
      if (!lines.length) lines.push('nothing to do')
      const exitCode = (r.problems ?? []).length ? 1 : 0
      return emit(values, { ...r, exitCode }, lines.join('\n'))
    }

    if (sub && sub !== 'status') {
      process.stderr.write(`curtain env: unknown subcommand "${sub}"\n\n${COMMANDS.env.usage}\n`)
      return 2
    }

    const status = envStatus({ configDir, config })
    const problems = envProblems(status)
    const lines = status.entries.length
      ? ['env', ...renderEnv(status.entries)]
      : ['no env files declared; add `"env": [".env.local"]` to an app in curtain.json']
    for (const p of problems) {
      if (p.code === 'ENV_KEYS_MISSING' || p.code === 'MISSING_ENV') continue  // already visible per line
      lines.push('', `${p.code}${p.app ? ` ${p.app}` : ''}`)
      if (p.fix) lines.push(`  ${p.fix}`)
    }
    return emit(values, { ...status, problems, exitCode: 0 }, lines.join('\n'))
  },
}

COMMANDS.seed = {
  summary: 'give this workspace data of its own',
  usage: [
    'Usage: curtain seed [name] [--json]',
    '',
    'With no name, lists the seeds this project has.',
    'A seed is your script in curtain/seeds/<name>.mjs; Curtain runs it and',
    'remembers what it returns, so a walk can find the data it made.',
  ].join('\n'),
  async run({ values, positionals }) {
    const [name] = positionals

    if (!name) {
      const ws = workspace()
      const { configured, dir } = loadConfig(process.cwd(), ws.root)
      const available = configured ? listSeeds(dir) : []
      const lines = available.length
        ? ['seeds', ...available.map((n) => {
            const t = readTenant(ws.root, n)
            return `  ${n.padEnd(16)}${t ? `last made ${JSON.stringify(t)}` : 'not run here yet'}`
          }), '', 'run one with `curtain seed <name>`']
        : [`no seeds yet; create ${join('curtain', 'seeds', '<name>.mjs')}`]
      return emit(values, { available, exitCode: 0 }, lines.join('\n'))
    }

    const result = await seed(name, {})
    const lines = []
    if (result.exitCode === 0) {
      lines.push(`seeded   ${result.seed}`)
      if (result.tenant) {
        for (const [k, v] of Object.entries(result.tenant)) lines.push(`  ${k.padEnd(12)} ${v}`)
      }
    }
    for (const p of result.problems) {
      lines.push('', `${p.code}${p.seed ? ` ${p.seed}` : ''}`)
      if (p.message) lines.push(indent(p.message))
      if (p.fix) lines.push(`  ${p.fix}`)
    }
    return emit(values, result, lines.join('\n'))
  },
}

COMMANDS.walk = {
  summary: 'drive the app in a real browser and record it',
  usage: [
    'Usage: curtain walk [name] [--force] [--no-gif] [--json]',
    '',
    'With no name, lists the walks this project has.',
    'A walk names the app it drives, so it never names a port.',
    'An mp4 is produced only for a run that passed; a failed run keeps its webm.',
  ].join('\n'),
  options: { force: { type: 'boolean', default: false }, gif: { type: 'boolean', default: true } },
  async run({ values, positionals }) {
    const [name] = positionals

    if (!name) {
      const r = await resolve({})
      const available = r.configured ? listWalks(r.configDir) : []
      const lines = available.length
        ? ['walks', ...available.map((w) => `  ${w}`), '', 'run one with `curtain walk <name>`']
        : [`no walks yet; create ${join('curtain', 'walks', '<name>.mjs')}`]
      return emit(values, { available, exitCode: 0 }, lines.join('\n'))
    }

    const result = await walk(name, { force: values.force, gif: values.gif })
    const lines = []
    if (result.target) {
      lines.push(`walk     ${result.walk}`)
      lines.push(`target   ${result.target.name} at ${result.target.url}`)
    }
    if (result.artifacts?.mp4) lines.push(`video    ${result.artifacts.mp4}`)
    if (result.artifacts?.gif) lines.push(`gif      ${result.artifacts.gif}`)
    else if (result.artifacts?.video) lines.push(`webm     ${result.artifacts.video}`)
    for (const p of result.problems) {
      lines.push('', `${p.code}${p.app ? ` ${p.app}` : ''}`)
      if (p.message) lines.push(indent(p.message))
      if (p.fix) lines.push(`  ${p.fix}`)
    }
    lines.push('', result.passed ? 'passed' : 'FAILED')
    return emit(values, result, lines.join('\n'))
  },
}

COMMANDS.cleanup = {
  summary: 'show what could be deleted; delete it only when told to',
  usage: [
    'Usage: curtain cleanup [--yes] [--json]',
    '',
    'Bare, this is a dry run: it measures, lists, and deletes nothing.',
    'A dry run never calls a seed teardown, so the preview cannot lie by',
    'running something that ignores it; host teardowns are named, not invoked.',
    '--yes removes the artifacts and asks each recorded seed to undo itself.',
  ].join('\n'),
  options: { yes: { type: 'boolean', default: false } },
  async run({ values }) {
    const r = await cleanup({ yes: values.yes })
    const lines = []

    if (r.artifacts.length) {
      lines.push(r.dryRun ? 'would delete' : 'deleted')
      for (const a of r.artifacts) {
        lines.push(`  ${a.kind.padEnd(10)} ${a.name.padEnd(16)} ${String(a.files).padStart(3)} files  ${humanBytes(a.bytes)}`)
      }
      lines.push(`  ${''.padEnd(10)} ${'total'.padEnd(16)} ${humanBytes(r.bytes).padStart(10)}`)
    }
    if (r.data.length) {
      lines.push('', r.dryRun ? 'would ask these seeds to undo themselves' : 'undone')
      for (const d of r.data) lines.push(`  ${d.seed}`)
    }
    for (const p of r.problems) {
      lines.push('', `${p.code}${p.seed ? ` ${p.seed}` : ''}`)
      if (p.message) lines.push(indent(p.message))
      if (p.fix) lines.push(`  ${p.fix}`)
    }
    if (!r.artifacts.length && !r.data.length) lines.push('nothing to clean up')
    else if (r.dryRun) lines.push('', 'nothing was deleted; run `curtain cleanup --yes` to do it')

    return emit(values, r, lines.join('\n'))
  },
}

COMMANDS.doctor = {
  summary: 'check dependencies and config, show the resolved target and any debt',
  usage: 'Usage: curtain doctor [--json]',
  async run({ values }) {
    const result = await doctor()
    const lines = [renderResolved(result.resolved)]
    if (result.debt.unclaimedServers.length) {
      lines.push('', 'debt')
      for (const u of result.debt.unclaimedServers) {
        lines.push(`  :${u.port} ${u.command ?? '?'} (pid ${u.pid})`)
        lines.push(`    ${u.suggestion}`)
      }
    }
    lines.push('', result.exitCode === 0 ? 'ready' : 'blocked, see problems above')
    return emit(values, result, lines.join('\n'))
  },
}

function usage() {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length), 7)
  const lines = Object.entries(COMMANDS)
    .map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`)
    .join('\n')
  return `curtain ${PKG.version}\n\nUsage: curtain <command> [options]\n\n${lines}\n`
}

export async function run(argv) {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === '-h') {
    process.stdout.write(usage())
    return 0
  }
  if (name === '--version' || name === '-v') {
    process.stdout.write(`${PKG.version}\n`)
    return 0
  }
  const command = COMMANDS[name]
  if (!command) {
    process.stderr.write(`curtain: unknown command "${name}"\n\n${usage()}`)
    return 2
  }
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      options: { ...GLOBAL_OPTIONS, ...(command.options ?? {}) },
      allowPositionals: true,
    })
  } catch (err) {
    process.stderr.write(`curtain ${name}: ${err.message}\n\n${command.usage}\n`)
    return 2
  }
  if (parsed.values.help) {
    process.stdout.write(`${command.usage}\n`)
    return 0
  }
  return await command.run(parsed)
}
