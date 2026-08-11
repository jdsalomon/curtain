import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { COMMANDS, PLANNED } from '../../lib/cli.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const SKILLS = join(ROOT, 'skills')

function docs() {
  const files = []
  for (const name of readdirSync(SKILLS)) {
    const p = join(SKILLS, name, 'SKILL.md')
    if (existsSync(p)) files.push([`skills/${name}/SKILL.md`, readFileSync(p, 'utf8')])
  }
  for (const name of ['README.md', 'fixture/README.md', 'CHANGELOG.md', 'ROADMAP.md', 'docs/DESIGN.md']) {
    const p = join(ROOT, name)
    if (existsSync(p)) files.push([name, readFileSync(p, 'utf8')])
  }
  return files
}

// Subcommands and flags are not commands; only the first word after `curtain` is.
// The match is same-line only (`[ \t]` not `\s`): a doc listing `... curtain` at
// the end of one line and `claude plugin ...` on the next is not a command call.
const KNOWN_NON_COMMANDS = new Set(['detect', 'apply'])

// Docs that may promise the future, and docs that may only describe the present.
const FORWARD_LOOKING = new Set(['ROADMAP.md', 'docs/DESIGN.md'])

const operational = () => docs().filter(([f]) => !FORWARD_LOOKING.has(f))
const forward = () => docs().filter(([f]) => FORWARD_LOOKING.has(f))

const referenced = (body) =>
  [...body.matchAll(/\bcurtain[ \t]+([a-z][a-z-]*)/g)]
    .map((m) => m[1])
    .filter((w) => !KNOWN_NON_COMMANDS.has(w))

test('operational docs only reference commands that exist today', () => {
  const real = new Set(Object.keys(COMMANDS))
  for (const [file, body] of operational()) {
    for (const word of referenced(body)) {
      assert.ok(real.has(word), `${file} references \`curtain ${word}\`, which is not a command`)
    }
  }
})

test('forward-looking docs reference only real or declared-planned commands', () => {
  const known = new Set([...Object.keys(COMMANDS), ...Object.keys(PLANNED)])
  for (const [file, body] of forward()) {
    for (const word of referenced(body)) {
      assert.ok(known.has(word),
        `${file} promises \`curtain ${word}\`; add it to PLANNED in lib/cli.mjs with its version`)
    }
  }
})

test('a shipped command is removed from PLANNED, so shipping forces a docs pass', () => {
  for (const name of Object.keys(PLANNED)) {
    assert.ok(!(name in COMMANDS),
      `\`${name}\` ships now but is still listed as planned; delete it from PLANNED and reread the roadmap`)
  }
})

test('every planned command names the version that will bring it', () => {
  for (const [name, version] of Object.entries(PLANNED)) {
    assert.match(version, /^v\d+\.\d+\.\d+$/, `PLANNED.${name} must name a version`)
  }
})

test('every shipped command is mentioned by a skill or the README', () => {
  const mentioned = new Set(operational().flatMap(([, body]) => referenced(body)))
  for (const name of Object.keys(COMMANDS)) {
    assert.ok(mentioned.has(name), `\`curtain ${name}\` exists but no skill or README mentions it`)
  }
})

test('each skill has frontmatter with a name and a description', () => {
  for (const name of readdirSync(SKILLS)) {
    const body = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
    assert.match(body, /^---\n/, `skills/${name} needs frontmatter`)
    assert.match(body, /^name:\s*\S+/m, `skills/${name} needs a name`)
    assert.match(body, /^description:\s*\S+/m, `skills/${name} needs a description`)
  }
})

test('no skill exceeds 60 lines, because mechanics belong in code', () => {
  for (const name of readdirSync(SKILLS)) {
    const lines = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8').split('\n').length
    assert.ok(lines <= 60, `skills/${name}/SKILL.md is ${lines} lines; move mechanics into the CLI`)
  }
})

test('no user-facing doc uses an em dash', () => {
  for (const [file, body] of docs()) {
    assert.ok(!body.includes('—'), `${file} contains an em dash`)
  }
})

test('every problem code a doc branches on is a real code', async () => {
  const { CODES } = await import('../../lib/problems.mjs')
  for (const [file, body] of docs()) {
    for (const m of body.matchAll(/`(([A-Z]+_){1,3}[A-Z]+)`/g)) {
      assert.ok(CODES[m[1]], `${file} branches on \`${m[1]}\`, which is not a problem code`)
    }
  }
})
