// What did this project tell us? Nothing here can go stale in a way that lies,
// because ports, pids and tenants are never stored.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'

export const CONFIG_NAME = 'curtain.json'
export const LOCAL_NAME = 'curtain.local.json'
export const STATE_DIR = '.curtain'    // gitignored, disposable
export const SOURCE_DIR = 'curtain'    // committed, the action cache and walks

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Recursive for objects, replacement for everything else. Arrays replace so an
 *  override can shrink a list, which concatenation would make impossible. */
export function deepMerge(base, over) {
  if (over === undefined) return base
  if (!isPlain(base) || !isPlain(over)) return over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v
  return out
}

/** Nearest `name` walking up from `from`, never above `stopAt`. */
export function findUp(name, from, stopAt) {
  let dir = resolvePath(from)
  const stop = resolvePath(stopAt)
  while (true) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
    if (dir === stop) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`)
  }
}

export function loadConfig(cwd, root) {
  const path = findUp(CONFIG_NAME, cwd, root)
  if (!path) return { configured: false, config: {}, dir: null, sources: [] }

  const dir = dirname(path)
  const sources = [path]
  let config = readJson(path)

  const localPath = join(dir, LOCAL_NAME)
  if (existsSync(localPath)) {
    config = deepMerge(config, readJson(localPath))
    sources.push(localPath)
  }
  return { configured: true, config, dir, sources }
}
