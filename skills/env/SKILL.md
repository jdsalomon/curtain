---
name: env
description: Use when `curtain up` reports NO_ENV_VALUES or MISSING_ENV, when a fresh clone or worktree cannot start, or when setting up a project whose apps need env files. Gets a checkout the configuration it needs without ever reading a value.
---

# Get this checkout its env files

Env files are gitignored, so they travel with neither a clone nor a worktree.
Curtain splits the problem in two: the **schema** (`.env.example`, committed,
per branch) and the **values** (one canonical file per project on this machine,
symlinked into every checkout).

`curtain env` shows where each declared file is. Branch on the code:

| Code | What to do |
|---|---|
| `MISSING_ENV` | Values exist in the store; `curtain up` links them itself. Nothing to ask |
| `NO_ENV_VALUES` | Values exist nowhere. Run the interview below |
| `ENV_KEYS_MISSING` | This branch's example declares keys the values lack. Ask the user for those keys only, by name |
| `ENV_CONFLICT` | The checkout file and the store disagree. Show both paths, let the user reconcile; never pick a side |
| `NO_PROJECT_NAME` | Add a top-level `"name"` to curtain.json; it keys the store |

## The interview, when values exist nowhere

1. Read `.env.example` for the key names. Ask the user for the values in one
   message, by name. If an example is missing, ask what the app needs to start.
2. Write the answers to the declared file in this checkout (it is gitignored).
3. `curtain env adopt` moves it into the store and leaves a symlink behind.

From then on every checkout, present and future, is `curtain up` away: the link
is created automatically.

## Declaring env in curtain.json

```json
{ "name": "myproject",
  "apps": { "admin": { "start": "...", "env": [".env.local"] } } }
```

Paths are relative to curtain.json. The app must read the file itself (most
frameworks do; a bare Node server wants `node --env-file=.env.local ...`):
Curtain never injects variables into a process, it only makes the file exist.

## What never happens

Values never appear in Curtain's output, in `--json`, or in anything you echo
back to the user: statuses and key **names** only, and treat any values the
user gives you as write-only. The store is written once per file, at adopt,
and never overwritten; there is no command that can clobber it.
