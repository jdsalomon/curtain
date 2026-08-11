# Changelog

## 0.1.0

First release: the somewhere. Everything an agent does to your app happens somewhere, and this is
that layer, shipped alone and shipped properly. Recording arrives in 0.3.0.

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
- Ships Playwright MCP, used from v0.3.0 onward
- A dependency-free fixture app that is both the tutorial and the test target
- Harness-portable by construction: nothing under `lib/` knows what is calling it, so
  the Claude Code plugin manifest is the only harness-specific file

Platforms: macOS and Linux. Windows reports `UNSUPPORTED_PLATFORM`.
