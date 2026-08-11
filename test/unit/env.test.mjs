import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyEnv, matchHost } from '../../lib/env.mjs'

const ENVS = { preview: '*.vercel.app', prod: 'example.com' }

test('loopback in every spelling is local', () => {
  for (const url of [
    'http://localhost:3000',
    'http://127.0.0.1:3000/login',
    'http://[::1]:3000',
    'https://admin.localhost:3000',
  ]) {
    assert.equal(classifyEnv(url, ENVS), 'local', url)
  }
})

test('a wildcard preview pattern matches subdomains and the bare apex', () => {
  assert.equal(classifyEnv('https://my-branch-abc.vercel.app', ENVS), 'preview')
  assert.equal(classifyEnv('https://vercel.app', ENVS), 'preview')
})

test('the declared prod host is prod', () => {
  assert.equal(classifyEnv('https://example.com/admin', ENVS), 'prod')
})

test('an unknown remote host is prod, so the default fails safe', () => {
  assert.equal(classifyEnv('https://staging.somewhere-else.io', ENVS), 'prod')
  assert.equal(classifyEnv('https://example.com.evil.test', ENVS), 'prod',
    'a suffix that merely contains the prod host must not read as prod')
})

test('with no envs configured, remote is still prod and local is still local', () => {
  assert.equal(classifyEnv('https://anything.test', {}), 'prod')
  assert.equal(classifyEnv('http://localhost:1234', {}), 'local')
})

test('a private LAN address is not local, because it is someone else s machine', () => {
  assert.equal(classifyEnv('http://192.168.1.20:3000', ENVS), 'prod')
})

test('an unparseable url is prod rather than local', () => {
  assert.equal(classifyEnv('not a url', ENVS), 'prod')
})

test('matchHost handles the wildcard and the exact case only', () => {
  assert.equal(matchHost('a.b.vercel.app', '*.vercel.app'), true)
  assert.equal(matchHost('vercel.app', '*.vercel.app'), true)
  assert.equal(matchHost('notvercel.app', '*.vercel.app'), false)
  assert.equal(matchHost('example.com', 'example.com'), true)
  assert.equal(matchHost('www.example.com', 'example.com'), false)
})
