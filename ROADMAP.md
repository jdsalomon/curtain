# Roadmap

Curtain's ambition is small to describe and large to build: **your agent should never have to say
"it works, trust me."**

Bring the stack up. Give it data of its own. Drive the real app in a real browser. Record what
happened. Tear it down. One command each, in a repo Curtain has never seen, without a wiki page
telling anyone which port is which.

An agent that can do that stops reporting and starts showing. That is the whole thesis: the gap
between "I implemented it" and "here it is working" is where trust in agentic work is currently lost,
and it is a tooling gap rather than a model one.

**Status: v0.1.0 is the only release.** Everything after it is a plan, not a promise, and the
versions are the order of work rather than dates.

## Why this exists

Measured on a single developer machine, in one project, on one ordinary afternoon:

- **five dev servers** running across four checkouts of the same repository, and no way to tell
  which was which
- **twenty-one** committed browser tests pinned to a port that nothing was listening on, so they
  passed against whatever happened to answer
- **three** independent implementations of "find the dev server", in prose, disagreeing with each
  other
- **260 MB** of recordings nothing ever deleted, and ten abandoned test datasets in the local
  database

None of that is exotic. It is what happens to every repo that grows past one developer and one
branch. The failure mode is the dangerous kind: nothing crashes, the tests go green, and the bug
surfaces later somewhere unrelated.

Curtain's answer is that these facts should be **discovered every time, by tested code**, and never
written down where they can go stale.

## The releases

### v0.1.0, the somewhere · released

Everything an agent does to your app happens somewhere, and getting that somewhere right is the
unglamorous half nobody builds. An agent that drives the wrong server demos someone else's branch and
is completely convincing about it.

So this release is only that. `curtain up` starts what is missing and reuses what is already healthy.
`curtain down` stops exactly what this workspace started and leaves other checkouts alone.
`curtain doctor` says whether anything is blocking you.

Service identity comes from **who started the process**, not from guessing at paths. Paths cannot
answer it: two apps in one repository share a git root, so comparing roots tells you which checkout a
server belongs to and never which app it is. Some setups make it worse by running every app from the
repository root. Listeners nobody claims are reported, never adopted.

*You get:* five servers, five correct answers, and a stop command that cannot kill your colleague's.
Every later release stands on this one.

### v0.2.0, isolated data per workspace · planned

`curtain seed` runs **your** provisioning command and confirms it worked. Each workspace gets its own
data, so two branches, or two agents, can work at once without overwriting each other.

Curtain never touches your database. It cannot know what your data means, so the host owns the
provisioning and Curtain owns the guarantee that it ran and that the result is discoverable.

Plus `curtain cleanup`, which invoked bare is a dry run: it shows you what it would delete, with
counts and sizes, and deletes nothing.

*You get:* parallel work that does not corrupt itself, and a cleanup you can trust because it shows
its work first.

### v0.3.0, a recording that is also a test · planned

`curtain walk` drives your app and records it, with a synthetic cursor, because a screen recording
captures no mouse pointer. If an element is missing, the run throws and exits non-zero.

That is the whole trick: **a clean video is a passing test.** One artifact, two jobs, no extra
authoring. Data a run created is reversed even when the run crashes, and there is a safety rail
before anyone points this at production.

*You get:* the thing you paste into a pull request, which is simultaneously the thing that proves it
works.

### v0.4.0, one declaration, demo or test · planned

Write the storyboard once as **scenes**, each tagged with what it covers: the happy path, an edge
case, an error, the bug you just fixed. Then render it as a narrated video for humans or as a fast
suite for CI. Same scenes, different renderer, so the demo and the test cannot drift apart.

Coverage stops being a claim in a pull request description and becomes an exit code:
`--require happy,edge,regression` fails when a class is missing.

*You get:* demos and tests as one artifact, and an answer to "did you test the edge cases" that is
not a promise.

### v0.5.0, it gets faster the more you use it · planned

`curtain actions` is a cache of the interactions you have already worked out, keyed by surface and
action. Before writing a new one, Curtain looks for the existing one. An entry that stops matching
is marked broken rather than silently trusted, and changing one tells you every scene about to break.

*You get:* the fifth recording is much cheaper to make than the first.

### v1.0.0, works in a repo it has never seen · planned

Point Curtain at an unfamiliar project and it configures itself from one or two questions: your
package manager, your start commands, your monorepo layout. Whatever it cannot detect, it asks once,
in plain language, and writes down only facts that cannot go stale.

*You get:* the whole loop, in a repo nobody prepared for it.

### v1.1.0, layout truth · planned

The bugs nobody writes an assertion for: a button covered by a modal, white text on a white
background, a label clipped at 200 pixels, a page that scrolls sideways on a phone, a tap target too
small for a thumb, content that jumps while loading.

All of it is geometry, so all of it is computable, with no model, no API key and no network. Across
every viewport you name, because almost every layout bug only exists at one width.

*You get:* the class of frontend bug that passes every test suite ever written.

### v1.2.0, locators that heal themselves · planned

A vision model as a **third way of finding an element**, next to a role and a test id. It fills gaps
in the cache rather than running on every pass, so replays stay deterministic and free. When an
interaction stops matching, it is relocated and repaired instead of merely failing.

It also reaches what a page structure cannot describe at all: a map, a chart, a video control, a
drawing canvas.

Three rules keep it honest, and they are deliberate limits rather than caveats:

1. it fills cache misses, never the replay path
2. it is used only where no structural locator can exist
3. **it is refused outright in test mode**, because coordinate clicks drift with viewport, fonts and
   operating system, and that is exactly the flakiness this project exists to remove

*You get:* interactions that repair themselves, and surfaces that were previously untestable.

## Which agent harness

Curtain is **not built for one agent harness.** The engine is a zero-dependency Node CLI plus an MCP
server, which is deliberately the most portable shape available: a command any harness can run, and a
protocol several already speak. Nothing under `lib/` knows what is calling it.

What is harness-specific is only the packaging. Today that means a Claude Code plugin manifest, which
buys skill discovery, an MCP server that installs with the plugin, and `bin/` on the tool `PATH`.
Everywhere else you clone it, put the binary on your `PATH`, and register the MCP server yourself.

The prose half is markdown with YAML frontmatter, which is close enough to what most harnesses want
that porting it is editing, not rewriting.

**Planned:** first-class packaging for other harnesses, once there is more than one shape worth
supporting. Not sooner, because guessing at an abstraction before the second real case is how you get
an adapter layer that fits nothing.

## What "released" means here

Each version has to clear three gates before it is tagged. They are checkable, not aspirational.

| Gate | The test |
|---|---|
| **Shippable** | A stranger installs the tag and gets the stated value with nothing else present. Proven by running that version's tutorial from a clean clone |
| **Testable** | The behaviour is asserted rather than demonstrated. Unit and integration suites green on macOS and Linux, plus a test that every command named in the docs exists |
| **Open-sourceable** | The value is legible in one sentence, the changelog says what changed, and an automated check confirms nothing about where this came from leaked into the code |

## Deliberate non-goals

Saying no is most of the design.

- **No engine choice.** One browser driver, shipped and owned. There is no adapter layer and no way
  to plug in your own, because a tool that supports everything documents nothing.
- **No test framework.** Curtain runs your loop. Your assertions stay yours.
- **No pixel assertions on video.** Still-image baselines per scene, yes. Asserting on the contents
  of an mp4, never.
- **No stored ports or process ids.** They are discovered every time. A stored port is a lie waiting
  to happen.
- **No automatic deletion of anything you might still want.** Recordings and seeded data are removed
  when you ask, and never before. Everything ephemeral is removed without asking.
- **Windows, for now.** macOS and Linux. Service discovery reports an unsupported platform rather
  than pretending.

## How this changes

Versions ship in order, since each builds on the one before. The exception is v1.1.0, which depends
only on scenes and can arrive earlier if layout bugs turn out to hurt more than caching does.

The reasoning behind every decision here lives in [docs/DESIGN.md](docs/DESIGN.md), including the
ones that were wrong first.
