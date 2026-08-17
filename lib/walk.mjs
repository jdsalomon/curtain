// Drive the real app in a real browser and record it.
//
// The contract with a walk file is deliberately inverted from the obvious design.
// A walk is not a script you run with node; it is a module Curtain imports and
// calls with a toolkit. Two things follow, and both are the point:
//
//   1. A walk never names a path inside the plugin, whose location on disk is
//      none of its business and changes between a marketplace and a local install.
//   2. A walk names the app it drives (`target: 'guest'`) and never a port. The
//      resolver says where that app is right now, so a walk cannot be recorded
//      against a stale port, another worktree's server, or a colleague's branch.
//
// The artifact rule: an mp4 exists only for a run that passed. A failed run keeps
// its raw webm, because the frames leading up to the failure are usually the
// fastest explanation of it, but it never produces the shareable file. That is how
// "a clean video is a passing test" stays true at the filesystem level rather than
// by anyone remembering to check.
import { readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { resolve as resolveTarget } from './resolve.mjs'
import { seed as seedData } from './seed.mjs'
import { SOURCE_DIR, STATE_DIR } from './config.mjs'
import { classifyEnv } from './env.mjs'
import { problem } from './problems.mjs'
import { loadChromium, chromiumInstalled, ffmpegAvailable, FFMPEG_PROBLEM } from './browser.mjs'
import { installCursor, DEFAULT_ACCENT, sleep, clickThing, pointAt, typeInto } from './cursor.mjs'

/** Named sizes, because a walk should say what device it is proving, not do
 *  arithmetic. Phone first: it is where layout breaks and where guests actually are. */
export const VIEWPORTS = {
  phone: { width: 440, height: 950 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1280, height: 800 },
}

export const walksDir = (configDir) => join(configDir, SOURCE_DIR, 'walks')

/** A named size, an explicit `{width,height}`, or the phone default. An unknown
 *  name falls back rather than throwing: a typo should still record something. */
export function viewportOf(meta = {}) {
  if (typeof meta.viewport === 'string') return VIEWPORTS[meta.viewport] ?? VIEWPORTS.phone
  return meta.viewport ?? VIEWPORTS.phone
}

/** Walks available in this project. A leading underscore marks a scratch probe and
 *  keeps it out of the list without needing a second directory for throwaways. */
export function listWalks(configDir) {
  const dir = walksDir(configDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .map((f) => basename(f, '.mjs'))
    .sort()
}

/** webm to a crisp faststart mp4, plus a small gif for pasting into a review.
 *  Scaling with `-2` keeps both dimensions even, which H.264 and yuv420p require. */
export function encode(webm, outBase, { gif = true } = {}) {
  const mp4 = `${outBase}.mp4`
  execFileSync('ffmpeg', ['-y', '-i', webm,
    '-vf', 'scale=iw*2:ih*2:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-movflags', '+faststart', mp4],
    { stdio: 'ignore' })
  if (!gif) return { mp4, gif: null }

  const gifPath = `${outBase}.gif`
  const palette = `${outBase}.palette.png`
  const filters = 'fps=8,scale=320:-2:flags=lanczos'
  execFileSync('ffmpeg', ['-y', '-i', webm, '-vf', `${filters},palettegen=stats_mode=diff`, palette],
    { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-i', webm, '-i', palette,
    '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`, gifPath],
    { stdio: 'ignore' })
  rmSync(palette, { force: true })
  return { mp4, gif: gifPath }
}

/** Playwright decorates its call log with ANSI colour, which is fine on a terminal
 *  and corrupts `--json` for anything that consumes it. A problem's `message` is
 *  data, so it gets stripped here rather than at the point it is printed. The
 *  pattern requires the escape byte: matching a bare `[2m` would also eat that
 *  substring out of a legitimate message. */
const stripAnsi = (s) => String(s).replace(/\[[0-9;]*m/g, '')

function newestWebm(dir) {
  if (!existsSync(dir)) return null
  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ path: join(dir, f), at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  return found.length ? found[0].path : null
}

/**
 * Run one walk. Returns a result rather than throwing, so the CLI decides the
 * exit code and `--json` gets the same shape as every other phase.
 */
export async function walk(name, { cwd = process.cwd(), force = false, gif = true, io = {} } = {}) {
  const r = await resolveTarget({ cwd, io })
  const problems = []
  const base = { walk: name, workspace: r.workspace, target: null, artifacts: null, problems }

  if (!r.configured) {
    problems.push(problem('NO_CONFIG', { fix: 'run `curtain setup` in this repo' }))
    return { ...base, passed: false, exitCode: 1 }
  }

  // 1. The walk file.
  const available = listWalks(r.configDir)
  const file = join(walksDir(r.configDir), `${name}.mjs`)
  if (!name || !existsSync(file)) {
    problems.push(problem('NO_SUCH_WALK', {
      walk: name ?? null,
      available,
      fix: available.length
        ? `no walk named "${name}"; this project has ${available.join(', ')}`
        : `create ${join(SOURCE_DIR, 'walks', `${name || '<name>'}.mjs`)}`,
    }))
    return { ...base, available, passed: false, exitCode: 1 }
  }
  const mod = await import(pathToFileURL(file).href)
  const run = mod.default
  if (typeof run !== 'function') {
    problems.push(problem('NO_SUCH_WALK', {
      walk: name,
      available,
      fix: `${file} must export a default async function`,
    }))
    return { ...base, available, passed: false, exitCode: 1 }
  }
  const meta = mod.meta ?? {}

  // 2. Where it runs. The walk names an app; the resolver knows the port.
  const appName = meta.target ?? Object.keys(r.services)[0] ?? null
  const service = appName ? r.services[appName] : null
  if (!service) {
    problems.push(problem('NOT_RUNNING', {
      app: appName,
      fix: appName
        ? `this walk targets "${appName}"; run \`curtain up ${appName}\` first`
        : 'nothing is running; run `curtain up` first',
    }))
    return { ...base, passed: false, exitCode: 1 }
  }
  // A server that answers with the wrong thing is refused here rather than
  // filmed. Recording it produces a video of a broken app plus a timeout deep in
  // the walk, and both read as "the feature does not work" when the truth is
  // that this checkout was never built.
  if (service.healthy === false) {
    problems.push(...r.problems.filter((p) => p.code === 'UNHEALTHY' && p.app === appName))
    return { ...base, passed: false, exitCode: 1 }
  }
  const target = { name: appName, url: service.url, port: service.port }
  base.target = target

  // 3. The rail. An unknown host classifies as prod, so this refuses by default
  //    rather than on a denylist, and --force is the only way past it.
  const env = classifyEnv(target.url, r.config.envs)
  if (env !== 'local' && !force) {
    problems.push(problem('TARGET_NOT_LOCAL', {
      app: appName,
      env,
      url: target.url,
      fix: `${target.url} classifies as ${env}; a walk mutates data, so pass --force to mean it`,
    }))
    return { ...base, env, passed: false, exitCode: 1 }
  }

  // 4. The data, when the walk declares it needs some. The seed runs every
  //    time rather than being trusted from a previous run: seeds are idempotent
  //    by contract, and a recorded slug outlives the data it names exactly as a
  //    recorded port outlives the server. A failed seed fails the walk here,
  //    before a browser is launched to record the wrong thing.
  let tenant = null
  if (meta.seed) {
    const seeded = await seedData(meta.seed, { cwd, io })
    if (seeded.exitCode !== 0) {
      problems.push(...seeded.problems)
      return { ...base, passed: false, exitCode: 1 }
    }
    tenant = seeded.tenant
  }

  // 5. The browser.
  const { chromium, from, problem: browserProblem } = await loadChromium({ root: r.workspace.root })
  if (browserProblem) {
    problems.push(browserProblem)
    return { ...base, passed: false, exitCode: 1 }
  }
  if (!chromiumInstalled(chromium)) {
    problems.push(problem('MISSING_CHROMIUM', {
      searched: [from],
      fix: `playwright is installed at ${from} but its browser is not; run \`npx playwright install chromium\``,
    }))
    return { ...base, passed: false, exitCode: 1 }
  }

  // 6. Artifacts. One directory per walk under this workspace's state dir, wiped
  //    before recording. Both halves matter: per-walk-per-workspace means two
  //    branches recording at once cannot overwrite each other (they once did, and
  //    one demo's mp4 came out a byte-for-byte copy of the other's), and wiping
  //    first means a failed run leaves nothing that could pass for a fresh pass.
  const dir = join(r.workspace.root, STATE_DIR, 'walks', name)
  const videoDir = join(dir, 'video')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(videoDir, { recursive: true })
  const outBase = join(dir, name)
  base.artifacts = { dir, video: null, mp4: null, gif: null }

  const viewport = viewportOf(meta)

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: meta.locale ?? 'en-US',
    recordVideo: { dir: videoDir, size: viewport },
  })
  // Two different waits, because they fail for different reasons.
  //
  // Finding an element should be fast: `up` already waited for the app to be
  // ready, so anything a walk cannot find in ten seconds is absent rather than
  // slow, and a demo that is going to fail should fail while someone is still
  // watching. Navigating is the opposite: a dev server compiles a route the
  // first time it is asked for, which legitimately takes far longer than any
  // element lookup should. Sharing one timeout between them means either
  // failures crawl or first navigations flake, and the first walk on a cold
  // Next route hit exactly that.
  context.setDefaultTimeout(meta.timeout ?? 10_000)
  context.setDefaultNavigationTimeout(meta.navigationTimeout ?? 60_000)
  await context.addInitScript(installCursor, meta.accent ?? DEFAULT_ACCENT)
  const page = await context.newPage()

  const log = (...args) => process.stderr.write(`  ${args.join(' ')}\n`)
  const ctx = {
    page,
    target,
    tenant,
    request: context.request,
    url: (path = '/') => new URL(path, target.url).href,
    click: (locator, opts) => clickThing(page, locator, opts),
    point: (locator, opts) => pointAt(page, locator, opts),
    type: (locator, text, opts) => typeInto(page, locator, text, opts),
    sleep,
    log,
  }

  let error = null
  try {
    await run(ctx)
  } catch (err) {
    error = err
  }

  // Cleanup runs while the page and request context are still alive, so it can
  // undo through the UI or the API. Its own failure is reported separately and
  // never replaces the original error, which is the one worth reading.
  let cleanupError = null
  if (typeof mod.cleanup === 'function') {
    try {
      await mod.cleanup(ctx)
    } catch (err) {
      cleanupError = err
    }
  }

  // The webm is only written out when the context closes.
  await context.close()
  await browser.close()
  base.artifacts.video = newestWebm(videoDir)

  if (error) {
    problems.push(problem('WALK_FAILED', {
      walk: name,
      message: stripAnsi(error.message),
      fix: base.artifacts.video
        ? `the recording up to the failure is at ${base.artifacts.video}`
        : 'no video was produced; the browser failed before the first frame',
    }))
  }
  if (cleanupError) {
    problems.push(problem('CLEANUP_FAILED', {
      walk: name,
      message: stripAnsi(cleanupError.message),
      fix: 'the walk may have left data behind; reverse it by hand',
    }))
  }

  const passed = !error && !cleanupError
  // Encode only for a pass, so the existence of an mp4 is itself the verdict.
  if (passed && base.artifacts.video) {
    if (ffmpegAvailable()) {
      const out = encode(base.artifacts.video, outBase, { gif })
      base.artifacts.mp4 = out.mp4
      base.artifacts.gif = out.gif
    } else {
      problems.push(FFMPEG_PROBLEM())
    }
  }
  if (passed && !base.artifacts.video) {
    problems.push(problem('WALK_FAILED', {
      walk: name,
      message: 'the walk completed but no video was produced',
      fix: 'check that the context was not closed inside the walk',
    }))
    return { ...base, browser: from, env, passed: false, exitCode: 1 }
  }

  return { ...base, browser: from, env, tenant, passed, exitCode: passed ? 0 : 1 }
}
