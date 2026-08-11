/** A git runner that answers from a map keyed by the joined argv. */
export function fakeGit(map) {
  return (args) => {
    const key = args.join(' ')
    if (!(key in map)) return null
    return map[key]
  }
}

/** An lsof runner keyed the same way, for listeners.mjs. */
export function fakeLsof(map) {
  return (args) => {
    const key = args.join(' ')
    if (!(key in map)) throw new Error(`fakeLsof: unexpected args: ${key}`)
    return map[key]
  }
}

/** An HTTP probe that answers from a url -> result map; unknown urls do not answer. */
export function fakeProbe(map) {
  return async (url) => map[url] ?? { ok: false, error: 'TimeoutError' }
}
