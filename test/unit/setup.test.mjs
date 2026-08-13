import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseMakefileTargets, scriptCandidates, detectCandidates, applyConfig,
} from '../../lib/setup.mjs'

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'curtain-setup-')))

test('makefile targets are read, and internals are skipped', () => {
  const mk = [
    '.PHONY: all admin-dev',
    'admin-dev:',
    '\tpnpm --filter admin dev',
    'guest-dev: deps',
    '\tpnpm --filter guest dev',
    '.hidden-target:',
    '\techo no',
    '# comment: not a target',
    'VAR := value',
  ].join('\n')
  assert.deepEqual(parseMakefileTargets(mk), ['admin-dev', 'guest-dev'])
})

test('dev-shaped npm scripts become candidates and others do not', () => {
  const got = scriptCandidates({
    scripts: {
      dev: 'next dev',
      'dev:admin': 'next dev apps/admin',
      'admin:dev': 'next dev apps/admin',
      build: 'next build',
      test: 'vitest',
      lint: 'eslint .',
      start: 'next start',
    },
  })
  const names = got.map((c) => c.start).sort()
  assert.deepEqual(names, ['npm run dev', 'npm run dev:admin', 'npm run admin:dev'].sort())
  assert.ok(!got.some((c) => /build|test|lint/.test(c.start)), 'only dev-shaped scripts')
  assert.ok(!got.some((c) => c.start === 'npm run start'), 'start is production, not the dev loop')
})

test('an app name is derived from the script suffix where there is one', () => {
  const got = scriptCandidates({ scripts: { 'dev:admin': 'x', 'guest:dev': 'y', dev: 'z' } })
  const byApp = Object.fromEntries(got.map((c) => [c.app, c.start]))
  assert.equal(byApp.admin, 'npm run dev:admin')
  assert.equal(byApp.guest, 'npm run guest:dev')
  assert.ok('app' in byApp || 'dev' in byApp, 'a bare `dev` gets a generic name, not a crash')
})

test('detection reports the package manager from the lockfile', () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'x' } }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    assert.equal(detectCandidates({ root: dir }).packageManager, 'pnpm')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('detection with nothing to find asks rather than inventing a command', () => {
  const dir = tmp()
  try {
    const d = detectCandidates({ root: dir })
    assert.deepEqual(d.candidates, [])
    const q = d.questions.find((x) => x.key === 'apps')
    assert.ok(q, 'it must ask how to start the app')
    assert.match(q.ask, /start/i)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply writes the config and gitignores the state directory', () => {
  const dir = tmp()
  try {
    const r = applyConfig({ root: dir, config: { apps: { admin: { start: 'make admin-dev' } } } })
    assert.equal(r.written, join(dir, 'curtain.json'))
    assert.equal(JSON.parse(readFileSync(r.written, 'utf8')).apps.admin.start, 'make admin-dev')
    assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.curtain\/$/m)
    assert.equal(r.gitignored, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply does not duplicate an existing gitignore entry', () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.curtain/\n')
    const r = applyConfig({ root: dir, config: { apps: {} } })
    const body = readFileSync(join(dir, '.gitignore'), 'utf8')
    assert.equal(body.match(/\.curtain\//g).length, 1)
    assert.equal(r.gitignored, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply refuses to clobber an existing config unless forced', () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, 'curtain.json'), JSON.stringify({ apps: { keep: { start: 'x' } } }))
    assert.throws(() => applyConfig({ root: dir, config: { apps: {} } }), /already exists/)
    applyConfig({ root: dir, config: { apps: { fresh: { start: 'y' } } }, force: true })
    assert.ok('fresh' in JSON.parse(readFileSync(join(dir, 'curtain.json'), 'utf8')).apps)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply rejects a config with no start command, since it could never work', () => {
  const dir = tmp()
  try {
    assert.throws(
      () => applyConfig({ root: dir, config: { apps: { admin: { ready: 'Ready in' } } } }),
      /start/,
    )
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('detect proposes a project name, from package.json or the directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curtain-setup-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'myproj', scripts: { dev: 'x' } }))
    const d = detectCandidates({ root: dir })
    assert.equal(d.name, 'myproj')
    const q = d.questions.find((x) => x.key === 'name')
    assert.deepEqual(q.options, ['myproj'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a scoped package name falls back to the directory, which every checkout shares less', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curtain-setup-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@org/thing' }))
    const d = detectCandidates({ root: dir })
    assert.ok(!d.name.startsWith('@'), 'a scope prefix makes an ugly store directory')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a committed .env.example implies the env file to declare', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curtain-setup-'))
  try {
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true })
    writeFileSync(join(dir, 'apps', 'web', 'package.json'), '{}')
    writeFileSync(join(dir, 'apps', 'web', '.env.example'), 'KEY=\n')
    const d = detectCandidates({ root: dir })
    assert.deepEqual(d.envExamples, [{ example: 'apps/web/.env.example', declare: 'apps/web/.env.local' }])
    assert.ok(d.questions.some((q) => q.key === 'env'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the ready question offers the marker the framework dependency implies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curtain-setup-'))
  try {
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true })
    writeFileSync(join(dir, 'apps', 'web', 'package.json'),
      JSON.stringify({ dependencies: { next: '^14' } }))
    const d = detectCandidates({ root: dir })
    const q = d.questions.find((x) => x.key === 'ready')
    assert.deepEqual(q.options, ['Ready in'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('apply refuses env declarations without a name, before anything is written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curtain-setup-'))
  try {
    assert.throws(
      () => applyConfig({ root: dir, config: { apps: { a: { start: 'x', env: ['.env.local'] } } } }),
      /needs a top-level "name"/,
    )
    assert.ok(!existsSync(join(dir, 'curtain.json')), 'nothing may be written on refusal')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
