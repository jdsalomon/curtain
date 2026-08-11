import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

test('plugin manifest names the plugin and points at the mcp config', () => {
  const m = read('.claude-plugin/plugin.json')
  assert.equal(m.name, 'curtain')
  assert.match(m.name, /^[a-z0-9-]+$/, 'name must be kebab-case')
  assert.equal(m.mcpServers, './.mcp.json')
  assert.ok(existsSync(join(ROOT, '.mcp.json')), 'the mcp config it points at must exist')
  assert.ok(!('skills' in m), 'omit skills so the default skills/ scan applies')
})

test('the mcp config ships playwright and nothing else', () => {
  const m = read('.mcp.json')
  assert.deepEqual(Object.keys(m.mcpServers), ['playwright'])
  assert.equal(m.mcpServers.playwright.command, 'npx')
  assert.deepEqual(m.mcpServers.playwright.args, ['@playwright/mcp@latest'])
})

test('the marketplace publishes this repo as its own plugin', () => {
  const m = read('.claude-plugin/marketplace.json')
  assert.equal(m.name, 'curtain')
  assert.ok(m.owner?.name, 'owner.name is required')
  assert.equal(m.plugins.length, 1)
  assert.equal(m.plugins[0].name, 'curtain')
  assert.equal(m.plugins[0].source, './')
})

test('version is declared once and agreed everywhere', () => {
  const pkg = read('package.json')
  const plugin = read('.claude-plugin/plugin.json')
  assert.equal(plugin.version, pkg.version, 'plugin.json and package.json must agree')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
})

test('bin/curtain is extension-less and executable, so PATH gives a bare command', () => {
  const pkg = read('package.json')
  assert.equal(pkg.bin.curtain, './bin/curtain')
  const { mode } = statSync(join(ROOT, 'bin', 'curtain'))
  assert.ok(mode & 0o111, 'bin/curtain must have the executable bit')
})
