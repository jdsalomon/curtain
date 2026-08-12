# Contributing

## The development loop

Curtain develops as a `@skills-dir` plugin, which is discovered in place rather than
copied, so edits to a `SKILL.md` are live:

```bash
git clone https://github.com/jdsalomon/curtain
ln -s "$PWD/curtain" ~/.claude/skills/curtain
```

It loads as `curtain@skills-dir` on the next session. Changes to `bin/`, `.mcp.json` or
the manifest need `/reload-plugins`; skill edits do not.

**Pick one install, not both.** The README's marketplace install and this symlink are
alternatives. Running both gives you two copies of Curtain: a live one and a frozen one,
with duplicate skills, two browser MCP servers, and two `bin/curtain` on `PATH`, whose
precedence you are not choosing deliberately. Adding the marketplace is harmless, since
it only registers a source; installing from it while the symlink is active is not.

```bash
claude plugin list | grep -A 3 curtain   # expect exactly one entry while developing
```

Verify the plugin is seen and both manifests are well formed:

```bash
claude plugin details curtain
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

Pointing `validate` at the repo root resolves the *marketplace* manifest, so validate the
two files explicitly.

### `curtain` on PATH

An enabled plugin's `bin/` directory is added to the Bash tool's `PATH`, which is why the
skills call a bare `curtain` with no plugin-root plumbing. This is verified for both
install paths, which is worth stating because they differ: a marketplace install is copied
into the plugin cache, while a `@skills-dir` plugin is discovered in place. Both get their
`bin/` on `PATH`, symlink included.

It cannot be observed in the session that created the symlink. After `/reload-plugins`,
`which curtain` confirms it.

## Tests

```bash
npm test                  # unit and integration
npm run test:unit
npm run test:integration
```

No install step: Curtain has zero runtime dependencies and the runner is `node:test`.
Node `>=20.11`.

The scripts pass shell-expanded globs (`test/unit/*.test.mjs`) rather than directory
names, because Node 22 stopped treating a bare directory positional as a directory to
scan while Node 20 still does. Explicit file paths work on both.

Three tests carry more weight than the rest, and breaking them should be treated as a
design question rather than a flake:

- **A worktree created inside its parent checkout classifies as another checkout's.**
  This is the bug the project exists to fix, stated as an assertion.
- **A server survives the process that started it exiting.** The only test that catches a
  refactor back to piped stdio, where the read end closes when the CLI exits and the
  server dies minutes later on its next write, looking exactly like an application bug.
- **Every command named in a document exists.** The guard against prose describing
  mechanics that are no longer there.

## House rules

- **Mechanics in tested code, judgment in prose.** A skill over 60 lines fails the doc
  test on purpose: if you are explaining mechanics to a model, move them into the CLI.
- **`resolve()` is pure.** It never starts, kills, seeds or writes. Writing is the
  caller's job.
- **Failures are values.** Anything a phase might survive is a `problems[]` entry with a
  stable code and a `fix` line, constructed through the factory in `lib/problems.mjs` so a
  typo fails at the call site.
- **Ports and pids are never stored in config.** Always discovered live.
- **No em dashes in user-facing text.** Enforced by the doc test.
- **`curtain/` is committed source, `.curtain/` is gitignored state.** Dotted is
  disposable, and the distinction is load-bearing.

## Pull requests

CI runs the full suite on macOS and Linux, plus Node 20.11 to prove the engines floor is
real. Both platforms are required: reading a process's working directory is genuinely
different code on each.

For a change with a runtime surface, run the fixture tutorial from a clean clone before
marking it ready. That is the shippable gate, and it is the one a stranger experiences
first.
