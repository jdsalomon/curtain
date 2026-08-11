# Curtain

> Playwright writes the script. Curtain stages it.

Curtain makes the local development loop fast and boring: know which of your dev
services are already running, start only the ones that are missing, and stop only
the ones you started. It works when several checkouts of the same repo are running
at once, which is where most dev scripts quietly fall apart.

**Status: nothing is released yet.** v0.1.0 is in progress. See
[ROADMAP.md](ROADMAP.md) for where this is going and what is deliberately out of
scope.

## Development

Curtain develops as a `@skills-dir` plugin, which is discovered in place rather
than copied, so edits to `SKILL.md` are live:

```bash
ln -s /path/to/curtain ~/.claude/skills/curtain
# loads next session as curtain@skills-dir
```

Changes to `.mcp.json` or `bin/` need `/reload-plugins`; skill edits do not.

Verify the plugin is seen and both manifests are well formed:

```bash
claude plugin details curtain
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

Note that pointing `validate` at the repo root resolves the *marketplace*
manifest, so validate the two files explicitly.

### Is `curtain` on PATH?

Claude Code adds an enabled plugin's `bin/` directory to the Bash tool's `PATH`,
which is why the skills call a bare `curtain`. This is confirmed for
marketplace-installed plugins: their `~/.claude/plugins/cache/<plugin>/<version>/bin`
directories appear on `PATH`.

**Whether it also applies to `@skills-dir` plugins is not yet confirmed**, because
it cannot be observed in the session that created the symlink. After
`/reload-plugins` or in a fresh session, run:

```bash
curtain --version   # expect 0.1.0
```

If that resolves, a bare `curtain` is correct everywhere. If it reports "command
not found", call the absolute path instead:

```bash
"${CLAUDE_PLUGIN_ROOT}"/bin/curtain --version
```

The skills accept either, so nothing breaks while this is open.

## Tests

```bash
npm test                  # unit and integration
npm run test:unit
npm run test:integration
npm run gate:vocab        # the plugin must not know where it came from
```

Tests need no install step: Curtain has zero runtime dependencies, and the test
runner is `node:test`. Node `>=20.11` is required.

The test scripts pass shell-expanded globs (`test/unit/*.test.mjs`) rather than
directory names, because Node 22 stopped treating a bare directory positional as
a directory to scan while Node 20 still does. Explicit file paths work on both.

## License

MIT
