// Playwright and ffmpeg are the only two things Curtain cannot do itself, and
// neither is a dependency. `curtain up` must not cost a 130MB browser download to
// someone who only wants to know which port their admin app is on, so both are
// resolved at the moment a walk actually needs them, from wherever they already
// exist on the machine.
//
// A missing one is a problem with a fix line, not a crash: the raw webm is still
// a usable artifact without ffmpeg, and the failure names the command to run.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { problem } from './problems.mjs'

/** Where `curtain setup browser` puts an install when nothing else has one. Under
 *  the user's cache rather than the repo, so N checkouts share one Chromium. */
export const BROWSER_CACHE = join(homedir(), '.cache', 'curtain', 'browser')

/**
 * Every directory that could legitimately own a Playwright install, nearest first.
 * Order is the policy: an explicit override beats the project, the project beats
 * the plugin, and the shared cache is the last resort. Returning the list rather
 * than the winner is what makes the failure message able to say where it looked.
 */
export function playwrightCandidates(root) {
  const out = []
  if (process.env.CURTAIN_PLAYWRIGHT) out.push(process.env.CURTAIN_PLAYWRIGHT)
  if (root) out.push(root)
  out.push(join(import.meta.dirname, '..'))
  out.push(BROWSER_CACHE)
  return [...new Set(out)]
}

/** Resolve `playwright` as if required from `dir`, without importing it. */
function resolveFrom(dir, specifier = 'playwright') {
  try {
    // The referrer file need not exist; Node resolves from its directory.
    return createRequire(join(dir, 'noop.cjs')).resolve(specifier)
  } catch {
    return null
  }
}

/**
 * Load Chromium from the first candidate that has it.
 * Returns `{ chromium, from, entry }`, or `{ problem }` when nothing has one.
 */
export async function loadChromium({ root = null, candidates = null } = {}) {
  const searched = candidates ?? playwrightCandidates(root)
  for (const dir of searched) {
    const entry = resolveFrom(dir)
    if (!entry) continue
    const mod = await import(pathToFileURL(entry).href)
    const chromium = mod.chromium ?? mod.default?.chromium
    if (chromium) return { chromium, from: dir, entry, searched }
    return {
      problem: problem('MISSING_CHROMIUM', {
        searched,
        fix: `found playwright at ${entry} but it exports no chromium; reinstall it`,
      }),
    }
  }
  return {
    problem: problem('MISSING_CHROMIUM', {
      searched,
      fix: 'no playwright install found; run `npm i playwright && npx playwright install chromium` '
        + 'in this project, or point CURTAIN_PLAYWRIGHT at a directory that has one',
    }),
  }
}

/**
 * A Playwright install can exist while its browser binary does not, which fails
 * at launch with a long download instruction rather than at resolve time. Asking
 * first turns that into a problem code with the one command that fixes it.
 */
export function chromiumInstalled(chromium) {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    // Older or stubbed builds may refuse to answer; let launch be the judge.
    return true
  }
}

export function ffmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const FFMPEG_PROBLEM = () =>
  problem('MISSING_FFMPEG', {
    fix: 'install ffmpeg to get an mp4 and a gif; the raw webm was kept either way '
      + '(macOS: `brew install ffmpeg`, Debian: `apt install ffmpeg`)',
  })
