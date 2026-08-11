import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))

/** Global flags every command accepts. Command-specific options are merged in by each entry. */
const GLOBAL_OPTIONS = {
  json: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
}

export const COMMANDS = {
  // Populated by Tasks 7 through 12. Shape:
  //   name: { summary, usage, options, run: async ({ values, positionals }) => number }
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
