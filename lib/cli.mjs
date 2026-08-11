import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolve } from './resolve.mjs'
import { doctor } from './doctor.mjs'
import { up } from './up.mjs'
import { down } from './down.mjs'
import { emit, renderResolved } from './report.mjs'

const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))

/** Global flags every command accepts. Command-specific options are merged in by each entry. */
const GLOBAL_OPTIONS = {
  json: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
}

export const COMMANDS = {
  // Shape: name: { summary, usage, options, run: async ({ values, positionals }) => number }
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
