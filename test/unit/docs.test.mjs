import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { COMMANDS } from '../../lib/cli.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const SKILLS = join(ROOT, 'skills')

function docs() {
  const files = []
  for (const name of readdirSync(SKILLS)) {
    const p = join(SKILLS, name, 'SKILL.md')
    if (existsSync(p)) files.push([`skills/${name}/SKILL.md`, readFileSync(p, 'utf8')])
  }
  for (const name of ['README.md', 'fixture/README.md', 'CHANGELOG.md']) {
    const p = join(ROOT, name)
    if (existsSync(p)) files.push([name, readFileSync(p, 'utf8')])
  }
  return files
}

// Subcommands and flags are not commands; only the first word after `curtain` is.
// The match is same-line only (`[ \t]` not `\s`): a doc listing `... curtain` at
// the end of one line and `claude plugin ...` on the next is not a command call.
const KNOWN_NON_COMMANDS = new Set(['detect', 'apply'])

test('every `curtain <command>` in the docs is a real command', () => {
  const names = new Set(Object.keys(COMMANDS))
  for (const [file, body] of docs()) {
    for (const m of body.matchAll(/\bcurtain[ \t]+([a-z][a-z-]*)/g)) {
      const word = m[1]
      if (KNOWN_NON_COMMANDS.has(word)) continue
      assert.ok(names.has(word), `${file} references \`curtain ${word}\`, which is not a command`)
    }
  }
})

test('every command is mentioned by at least one skill, or it is unreachable', () => {
  const mentioned = new Set()
  for (const [, body] of docs()) {
    for (const m of body.matchAll(/\bcurtain[ \t]+([a-z][a-z-]*)/g)) mentioned.add(m[1])
  }
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

test('every problem code a skill branches on is a real code', async () => {
  const { CODES } = await import('../../lib/problems.mjs')
  for (const [file, body] of docs()) {
    for (const m of body.matchAll(/`(([A-Z]+_){1,3}[A-Z]+)`/g)) {
      assert.ok(CODES[m[1]], `${file} branches on \`${m[1]}\`, which is not a problem code`)
    }
  }
})
