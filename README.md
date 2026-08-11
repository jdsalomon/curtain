<div align="center">

<img src="assets/icon-256.png" alt="" width="132" height="132">

# Curtain

### Let your agents show you what they built.

Your agent says the feature works. Curtain is how it proves it: bring the stack up,
drive the real app in a real browser, record what happened, tear it down.

<sub>**Playwright writes the script. Curtain stages it.**</sub>

[![ci](https://github.com/jdsalomon/curtain/actions/workflows/ci.yml/badge.svg)](https://github.com/jdsalomon/curtain/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-A61131?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.11-330215?style=flat-square)](package.json)
[![dependencies](https://img.shields.io/badge/dependencies-none-E49B4F?style=flat-square)](package.json)

</div>

---

> **Status: v0.1.0, the services layer.** Everything an agent does to your app has to
> happen *somewhere*, and getting that somewhere right turned out to be the hard part.
> So v0.1.0 ships it alone, and ships it properly. Recording comes in v0.3.0. The
> [roadmap](ROADMAP.md) marks every unreleased version as planned, on purpose.

## Why the somewhere is the hard part

Five dev servers across four checkouts of the same repo. Which one is on 3001? Which
branch is it running? Your agent just told you the test passed, but against whose code?

```
$ curtain resolve

workspace  /Users/you/code/app/.worktrees/feature-x
           worktree on feature/x, id 7c382ad4

running
  admin      http://localhost:4310  pid 41022  via runfile
  guest      http://localhost:4311  pid 41023  via runfile

other checkouts
  3001       app                 pid 4109
  3003       app-hotfix          pid 34039
  3010       worktrees/redesign  pid 97912
```

Two of those are yours. Three are not. Curtain will never start over the top of them,
and `curtain down` will never kill them.

An agent that cannot tell those apart will happily demo you someone else's branch.

## How it knows

By asking **who started each process**, not by guessing from paths.

Every listener's working directory is resolved to *that directory's own git root*, and
roots are compared exactly. This is the only method that survives a worktree living
inside its parent checkout, which is the normal layout and which every path-prefix
check gets wrong.

Paths stop there, though: two apps in one repository share a git root. Which *app* a
server is comes from provenance, the loopback URL it announced when Curtain started it,
with the process group's own listener as fallback for apps that print nothing.

A server Curtain cannot account for is reported and **never adopted**.

## Try it in under a minute

No install step, no dependencies, no database:

```bash
cd fixture
curtain up          # two apps start on ports the OS picked
curtain up          # nothing restarts: "reused"
node rogue.mjs &    # a rival copy from another git root
curtain doctor      # named as another checkout's, not adopted
curtain down        # stops yours, leaves the rogue alone
```

See [`fixture/README.md`](fixture/README.md) for the walkthrough and the three awkward
cases it ships on purpose.

## Install

Curtain is a **zero-dependency Node CLI plus an MCP server**, so it is not tied to one
agent harness. Claude Code gets a plugin manifest today; anything that can run a
command and speak MCP can drive it.

<details open>
<summary><b>Claude Code</b></summary>

```
/plugin marketplace add jdsalomon/curtain
/plugin install curtain@curtain
```

Skills (`/up`, `/down`, `/setup`) and the Playwright MCP server come with it, and
`bin/` lands on the Bash tool's `PATH`, so a bare `curtain` just works.

</details>

<details>
<summary><b>Any other agent harness</b></summary>

```bash
git clone https://github.com/jdsalomon/curtain
cd curtain && npm link          # or just put ./bin on your PATH
curtain --version
```

Then point your harness at the browser MCP server the same way Curtain's own
[`.mcp.json`](.mcp.json) does. The CLI is the whole engine: it takes no arguments it
cannot discover, prints `--json` for every command, and has no Claude-specific code
anywhere in `lib/`.

The prose half (when to bring things up, how to read a failure) lives in
[`skills/`](skills/) as plain markdown with YAML frontmatter. Point your harness at
those files, or read them yourself.

First-class packaging for other harnesses is on the [roadmap](ROADMAP.md).

</details>

## Use it on your own project

| Skill | What it does |
|---|---|
| `/setup` | detects how your project starts, asks only what it cannot detect |
| `/up` | starts what is missing, reuses what is healthy |
| `/down` | stops exactly what this workspace started |

Under the skills is a CLI you can run yourself:

```bash
curtain doctor            # can this phase run, and what debt has piled up
curtain resolve --json    # the raw truth, for when you want to see it
curtain up   [app...]
curtain down [app...]
curtain setup detect | apply
```

Every command takes `--json`. Failures are values with stable codes and a `fix` line,
never a stack trace, so an agent branches on the code and never on wording.

## Configuration

One committed file, `curtain.json`, holding only facts that cannot go stale:

```json
{
  "apps": {
    "admin": {
      "start": "make admin-dev",
      "ready": "Ready in",
      "fingerprint": { "path": "/login", "expect": "password" }
    },
    "guest": { "start": "make guest-dev", "ready": "Ready in" }
  }
}
```

**Ports and pids are never stored.** They are discovered every time, because a stored
port is a lie waiting to happen. `curtain.local.json` is gitignored and deep-merged
over the top for the one case that needs it: a teammate who starts the app differently.

`.curtain/` is machine-local state and belongs in `.gitignore`, which `setup` handles.
The dot is the mnemonic: **dotted is disposable.**

## Platforms

macOS and Linux, both covered by CI, because reading a process's working directory is
`/proc` on one and `lsof` on the other. Windows is out of scope for v1: discovery
reports `UNSUPPORTED_PLATFORM` rather than pretending.

## Where this is going

**Your agent should never have to say "it works, trust me."**

Bring the stack up. Give it data of its own. Drive the real app. Record what happened.
Tear it down. One command each, in a repo Curtain has never seen.

v0.1.0 is the foundation. Isolated data per workspace, recordings that double as tests,
one declaration rendered as either a demo or a test suite, and a cache that makes each
new recording cheaper are the releases after it.

Read [ROADMAP.md](ROADMAP.md) for the arc and [docs/DESIGN.md](docs/DESIGN.md) for why
it is built this way, including the decisions that were wrong first.

## Development

```bash
git clone https://github.com/jdsalomon/curtain
ln -s "$PWD/curtain" ~/.claude/skills/curtain
```

It loads as `curtain@skills-dir` on the next session, discovered in place, so edits to
a `SKILL.md` are live. Changes to `bin/`, `.mcp.json` or the manifest need
`/reload-plugins`.

```bash
npm test              # unit and integration, no install needed
npm run gate:vocab    # optional, see scripts/vocab-gate.sh
```

Node `>=20.11`. The test scripts pass shell-expanded globs rather than directory names,
because Node 22 stopped scanning a bare directory positional while Node 20 still does;
explicit file paths work on both.

Brand assets and the palette are in [`assets/`](assets/) and [docs/BRAND.md](docs/BRAND.md).

## License

MIT
