# Curtain

Know and control your dev services.

**Playwright writes the script. Curtain stages it.**

Curtain is a Claude Code plugin. v0.1.0 does one thing well: it knows which of
your dev servers are running, starts only the ones that are missing, and stops
only the ones this workspace started. If you work in git worktrees, that last
word is the whole point.

## The problem it solves

Five dev servers across four checkouts of the same repo. Which one is on 3001?
Which branch is it running? Your test just passed, but against whose code?

Curtain answers by asking who started each process, not by guessing from paths.
It resolves every listener's cwd to that cwd's own git root and compares roots
exactly, which is the only method that survives a worktree living inside its
parent checkout, and the only method that survives Turbopack, `turbo dev` and
`nx`, where every app reports the repo root as its cwd.

## Install

    /plugin marketplace add jdsalomon/curtain
    /plugin install curtain@curtain

## Try it in under a minute

    cd fixture
    curtain up

Two dependency-free apps start on ports the OS picked. Run `curtain up` again and
nothing restarts. Start a rival copy with `node rogue.mjs`, then `curtain doctor`
and watch Curtain name whose it is instead of adopting it. Then `curtain down`.

See `fixture/README.md` for the walkthrough.

## Use it on your own project

    /setup     detects how your project starts, asks what it cannot detect
    /up        starts what is missing, reuses what is healthy
    /down      stops exactly what this workspace started

Under the skills there is a CLI you can run yourself:

    curtain doctor            can this phase run, and what debt has piled up
    curtain resolve --json    the raw truth, for when you want to see it
    curtain up [app...]
    curtain down [app...]
    curtain setup detect | apply

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

Ports and pids are never stored. They are discovered every time, because a
stored port is a lie waiting to happen. `curtain.local.json` is gitignored and
deep-merged over the top for the one case that needs it: a teammate who starts
the app differently.

`.curtain/` is machine-local state and belongs in `.gitignore`, which `setup`
handles. The dot is the mnemonic: dotted is disposable.

## Platforms

macOS and Linux. Windows is out of scope for v1: service discovery returns
`UNSUPPORTED_PLATFORM` rather than pretending.

## Development

    git clone https://github.com/jdsalomon/curtain
    ln -s "$PWD/curtain" ~/.claude/skills/curtain

It loads as `curtain@skills-dir` on the next session, discovered in place, so
edits to a `SKILL.md` are live. Changes to `bin/`, `.mcp.json` or the manifest
need `/reload-plugins`.

An enabled plugin's `bin/` directory is added to the Bash tool's `PATH`, which is
why the skills call a bare `curtain` with no plugin-root plumbing. That holds for
both install paths, symlink included, though it cannot be observed in the session
that created the symlink. After `/reload-plugins`, `which curtain` confirms it.

    npm test                  unit and integration
    npm run gate:vocab        the plugin must not know where it came from

No dependencies to install. That is deliberate: the fixture proves the tool works
with nothing but node, and a tool that demands a toolchain before it can
demonstrate itself has already lost the argument.

Node `>=20.11`. The test scripts pass shell-expanded globs rather than directory
names, because Node 22 stopped scanning a bare directory positional while Node 20
still does; explicit file paths work on both.

## Roadmap

Curtain's ambition, and what is deliberately out of scope, is in
[ROADMAP.md](ROADMAP.md). Nothing beyond v0.1.0 is released yet.

## License

MIT
