// How dangerous is this URL? Only three answers, and the unknown answer is the
// dangerous one on purpose: a host we cannot classify is treated as production.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Exact match, or a single leading `*.` matching any subdomain and the apex. */
export function matchHost(host, pattern) {
  if (!host || !pattern) return false
  const p = pattern.toLowerCase()
  if (p.startsWith('*.')) {
    const apex = p.slice(2)
    return host === apex || host.endsWith(`.${apex}`)
  }
  return host === p
}

export function classifyEnv(url, envs = {}) {
  const host = hostOf(url)
  if (!host) return 'prod'
  if (LOOPBACK.has(host) || host.endsWith('.localhost')) return 'local'
  if (matchHost(host, envs.preview)) return 'preview'
  if (matchHost(host, envs.prod)) return 'prod'
  return 'prod'
}
