# Changelog

## 0.5.2

Found by pointing an agent at a project that had just migrated to Curtain and asking it to build
something visible in the app and record proof. It succeeded, and these are what it hit on the way.

- **A fingerprint is now a health check, not only an identity check.** `probe` accepts any HTTP
  status on purpose, because a healthy app's root often redirects or 404s. The cost was that a dev
  server with a broken build answered 500 to everything and passed as live: `curtain up` said
  `started`, and a walk filmed the broken app before timing out inside it. An app that declares a
  `fingerprint` has already stated what it must serve, so that statement is now checked against this
  workspace's own server, not only against strangers on other ports. A mismatch is `UNHEALTHY`, it
  blocks, and its `fix` names the likeliest cause: a checkout that has never had its dependencies
  installed or its workspace packages built. A walk refuses to record against it rather than
  producing a video that blames the feature. The service stays claimed, deliberately, so `up` cannot
  start a second copy on a port already held.

- **`envStore` in curtain.json points at a values store you already have.** Curtain assumed the store
  was always its own (`~/.config/curtain/<name>/`), so a project that had kept its env values in one
  place for years was told they existed nowhere and invited to adopt, which would have copied live
  credentials into a rival store with two files to keep in step forever after. Paths inside the store
  mirror the checkout either way, so an existing store laid out that way needs no migration, and
  `envStore` replaces `name` as the thing that keys it.

- **Two traps that cost an agent real time are now written down.** `curtain doctor | tail` reports the
  pipe's exit status and not Curtain's, so a blocked run reads as a clean one; the `up` skill now says
  to read the code from Curtain directly, or use `--json` when the output is long. And artifacts are
  keyed by walk name, so a later failing run deletes the mp4 an earlier pass left: that is the
  artifact rule working, but nothing said so.

## 0.5.1

Fixes from a second clean-room run, this time on a real monorepo: an agent with no prior knowledge of
either was given the repository and Curtain's skills and asked to set it up from nothing. It
succeeded, and everything here is what it hit on the way.

- **`curtain setup browser`** now exists. It installs a shared Playwright and Chromium under
  `~/.cache/curtain/browser`, which every checkout reuses and no project manifest records. Previously
  `MISSING_CHROMIUM` offered only two bad options, adding a browser to the project's own dependencies
  or pointing an environment variable at an install you had to already know about. The third path was
  searched but never mentioned, nothing populated it, and a source comment named this command a
  release before it was written. The agent escaped only by reading that source
- Navigation and element lookups no longer share one timeout. Finding an element still waits 10s,
  because a missing button is missing now; navigating waits 60s, because a dev server compiles a
  route the first time it is asked for. One shared value meant either failures crawled or first
  navigations flaked, and a cold Next route hit exactly that. Both are overridable per walk
  (`meta.timeout`, `meta.navigationTimeout`) and both are now documented, which the existing
  `meta.timeout` never was
- The walk skill mentions `.filter({ visible: true })`, since a responsive layout that renders the
  same text twice will otherwise hang a locator for the full timeout
- The seed skill says that idempotent is not the same as restoring: a walk that persists a selection
  changes what the next run sees, and the seed has to reset that too
- The fixture's item store is per instance (`FIXTURE_STORE`), the way a real app takes a database
  URL. Test files run in parallel, so the file-backed store added in 0.4.0 let concurrent tests
  overwrite each other, which showed up only in the full suite and only sometimes

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.

## 0.5.0

Delete what you are done with, and nothing you might still want. `curtain cleanup` invoked bare is a
dry run: counts, sizes, and nothing removed.

- `curtain cleanup` measures Curtain's own artifacts (recordings, logs) exactly, because Curtain
  made them, and lists the seeds that could undo themselves. `--yes` is the only way anything goes
- **The dry run never calls a host teardown**, not even to preview it. A script that ignored a
  `dryRun` flag would delete for real, and the safety of a preview must not rest on someone else's
  care, so teardowns are named rather than inspected
- A seed undoes itself by exporting `cleanup`, beside the half that made the data, so provisioning
  and teardown cannot drift apart. A seed with no `cleanup` is simply not listed, which is honest:
  it made data it cannot unmake
- A seed is a candidate only when this workspace recorded running it, so cleanup cannot reach
  another checkout's data
- A failed teardown keeps its record and raises `CLEANUP_FAILED` rather than forgetting the data
- Data is undone before artifacts are deleted, so a teardown that fails has not already cost you the
  recording that shows what happened
- Nothing here touches the runfile, so `curtain down` can still stop what is running, and nothing
  touches a shared service, database or container: those belong to every checkout, not to this one
- The `down` skill now hands off to `cleanup` for what has piled up, instead of describing a debt
  section that only ever covered listeners

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.

## 0.4.0

Isolated data per workspace. `curtain seed` runs the provisioning script you already have and
remembers what it made, so a walk can stop assuming the data it needs happens to be there.

- `curtain seed <name>` runs `curtain/seeds/<name>.mjs`; `curtain seed` lists them. A seed is
  shaped exactly like a walk, so there is one thing to learn rather than two
- The smallest useful seed is one line. Returning an object makes those facts reachable from a
  walk as `tenant`, which is how a recording stops hardcoding a slug the seed invented
- A walk declares `seed: 'name'` in its meta; Curtain runs it before recording, every time, and
  fails the walk there rather than filming the wrong data. Seeds are idempotent by contract
- A new state is a new file. Adding `empty.mjs` beside `full.mjs` cannot break `full.mjs`, whereas
  adding a branch to one parameterised script can break every state in it, so there is no options
  mechanism. Underscored files are shared helpers and stay off the menu
- `SEED_FAILED` carries the failed command's own output; `NO_SUCH_SEED` names the seeds that exist
- Curtain still never touches your database: it runs your command in the directory holding
  curtain.json and stores what you return. Nothing here knows what any of it means
- The fixture's items moved from process memory to a file, because real data outlives the process
  that serves it, and that is what makes it seedable before the app is up. It gained
  `provision.mjs` (a stand-in for a project's own provisioning command) and two seeds
- The fixture's walk now declares `seed: 'empty'` instead of assuming an empty list, which is the
  whole feature demonstrated on itself

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.

## 0.3.1

Fixes from the first clean-room run: an agent that had never seen Curtain set it up on a
real monorepo and reported the friction. Everything here is its findings.

- `setup detect` now proposes the project `name` (from an unscoped package.json name, else
  the directory), and `setup apply` refuses a config that declares env files without one,
  before writing anything. Previously the scripted interview produced a config that broke
  `curtain env` at first use
- Detect notices committed `.env.example` files and proposes the gitignored siblings as
  env declarations, so the repair machinery is discoverable at setup time instead of at
  the first failure
- The ready-marker question now offers what the framework dependencies imply (Next, Vite,
  Nuxt, Astro) instead of an empty options list
- `UNCLAIMED_SERVER` fires only for listeners running from this workspace's git root.
  Ambient sockets (a music player, Docker, a browser) stay visible as data and as the
  report's ambient count, but a problem that fired on every run of a busy laptop stopped
  being read, and it disagreed with doctor's debt section about the very same listeners,
  which already used the correct filter. The two views now share one filter, pinned by test
- The setup skill explains `name` and the env declarations; the down skill's description
  of doctor's debt output now matches what doctor actually prints; the `envs` prod/preview
  key is documented in the README and the setup skill

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.

## 0.3.0

A fresh checkout starts itself. Env files are gitignored, so they travel with neither a
clone nor a worktree; the first `curtain up` in a new checkout was a crash whose log
blamed the app. Now the cause has a name, and when the values already exist on the
machine, `up` repairs it without being asked.

- Apps declare the env files they need: `"env": [".env.local"]` in curtain.json. Paths
  and names only; declaring env requires a top-level project `name`, which keys the store
- The schema/values split: `.env.example` (committed, per branch) says which variables an
  app needs; the values live once per project in a machine-level store every checkout
  symlinks to
- `curtain env` reports where each declared file is; `curtain env adopt` moves a real
  file into the store and leaves a symlink; `curtain env link` creates missing links
- `curtain up` links missing env files itself before starting, and refuses to start an
  app whose values exist nowhere, naming the file instead of crashing the app to find out
- A branch that adds a variable is caught by name: the example's keys are compared with
  the values file's keys, and the drift is reported as `ENV_KEYS_MISSING`
- Values appear in no output, no log and no `--json`, without exception; states and key
  names only. The store is written once per file, at adopt, and nothing can overwrite it:
  a disagreeing checkout file is an `ENV_CONFLICT` for a human, never a merge
- The fixture gains a `vip` role that exits unless `--env-file` hands it `VIP_CODE`, so
  the machinery has something real to fail against
- Curtain never injects variables into a process: the app reads its own file, Curtain
  only makes the file exist

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.

## 0.2.0

A recording that is also a test. `curtain walk` drives the real app in a real browser and films it,
and because a missing element throws, a clean video is a passing test rather than a claim.

- `curtain walk <name>` runs a walk; `curtain walk` lists what this project has
- A walk is a module Curtain imports and hands a toolkit, not a script you run, so it
  imports no Playwright and resolves no path into the plugin
- A walk names the app it drives and never a port, which is what 0.1.0 was for: the
  resolver supplies the URL, so a recording cannot land on a stale port or another
  worktree's server
- An mp4 is written only for a run that passed, and the artifact directory is wiped
  before recording, so a failed run cannot leave a file that passes for a fresh one
- A failed run keeps its raw webm, because the frames before a failure usually explain it
- A synthetic cursor with click ripples, since a screencast captures no OS pointer. It
  carries a light ring outside the accent ring so it stays visible on dark surfaces
- `cleanup` runs even when the walk throws, while the page and request context are alive,
  and its own failure is reported separately rather than replacing the original error
- A target that does not classify as local is refused; `--force` is the only way past it
- Playwright and ffmpeg are resolved when a walk needs them, never depended on, so the
  engine stays dependency-free and `curtain up` costs nobody a browser download.
  `CURTAIN_PLAYWRIGHT` points at an install that lives elsewhere
- Artifacts land in `.curtain/walks/<name>/`, one directory per walk per workspace, so two
  branches recording at once cannot overwrite each other
- The fixture is dressed like a real product, because it is what the recording shows

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.

## 0.1.0

First release: the somewhere. Everything an agent does to your app happens somewhere, and this is
that layer, shipped alone and shipped properly. Recording arrives in 0.2.0.

- `curtain up` starts only what is not running and reuses what is healthy
- `curtain down` stops exactly what this workspace started, by process group,
  and never touches another checkout's server
- `curtain doctor` says whether a phase can run and reports accumulated debt
  without deleting anything
- `curtain resolve --json` prints the resolved truth: workspace, config, live
  services, other people's servers, unattributed listeners, problems
- `curtain setup` detects how a project starts and writes `curtain.json`
- Service identity comes from who started the process, with the announced
  loopback URL as the primary source and the process group's own listener as the
  fallback, because two apps in one repository share a git root and paths cannot
  tell them apart
- Listeners are classified by resolving each one's cwd to its own git root, so a
  worktree living inside its parent checkout is correctly another checkout's
- Ships Playwright MCP, used from 0.2.0 onward
- A dependency-free fixture app that is both the tutorial and the test target
- Harness-portable by construction: nothing under `lib/` knows what is calling it, so
  the Claude Code plugin manifest is the only harness-specific file

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.
