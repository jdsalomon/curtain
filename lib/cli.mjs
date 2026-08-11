import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolve } from './resolve.mjs'
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
