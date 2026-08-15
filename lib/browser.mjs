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
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync, execSync } from 'node:child_process'
import { problem } from './problems.mjs'

/** Where `curtain setup browser` puts an install when nothing else has one. Under
 *  the user's cache rather than the repo, so N checkouts share one Chromium and
 *  no project's manifest gains a dependency it did not ask for. */
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
      fix: 'no playwright install found; run `curtain setup browser` to put one in '
        + `${BROWSER_CACHE}, which every checkout shares and no project manifest records. `
        + 'Or install playwright in this project, or point CURTAIN_PLAYWRIGHT at a directory that has one',
    }),
  }
}

/**
 * Put a Playwright and a Chromium somewhere every checkout can reach.
 *
 * This exists because the alternatives are both bad: adding a browser to the
 * project's own manifest is a dependency the project never asked for and has to
 * justify in review, and pointing an environment variable at an install assumes
 * you already know where one is. A shared cache under the user's home is neither.
 */
export async function provisionBrowser({ exec = execSync, log = () => {} } = {}) {
  const already = await loadChromium({ candidates: [BROWSER_CACHE] })
  if (!already.problem && chromiumInstalled(already.chromium)) {
    return { dir: BROWSER_CACHE, already: true, problems: [] }
  }

  const run = (command, note) => {
    log(note)
    exec(command, { cwd: BROWSER_CACHE, encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'] })
  }

  try {
    mkdirSync(BROWSER_CACHE, { recursive: true })
    if (!existsSync(join(BROWSER_CACHE, 'package.json'))) {
      run('npm init -y', 'creating the shared browser directory')
    }
    run('npm install playwright --no-fund --no-audit', 'installing playwright')
    // Re-uses an already downloaded build, so this is usually instant.
    run('npx playwright install chromium', 'installing chromium (~130 MB the first time)')
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('').trim()
    return {
      dir: BROWSER_CACHE,
      already: false,
      problems: [problem('BROWSER_INSTALL_FAILED', {
        message: detail || err.message,
        fix: `installing into ${BROWSER_CACHE} failed; the output above is npm's, not Curtain's`,
      })],
    }
  }

  const check = await loadChromium({ candidates: [BROWSER_CACHE] })
  if (check.problem || !chromiumInstalled(check.chromium)) {
    return {
      dir: BROWSER_CACHE,
      already: false,
      problems: [problem('BROWSER_INSTALL_FAILED', {
        message: 'the install reported success but no chromium is resolvable',
        fix: `inspect ${BROWSER_CACHE} by hand`,
      })],
    }
  }
  return { dir: BROWSER_CACHE, already: false, problems: [] }
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
