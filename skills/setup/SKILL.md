---
name: setup
description: Use when a repo has no curtain.json, or when `curtain doctor` reports NO_CONFIG. Detects how the project starts and writes the config.
---

# Teach Curtain about this project

Detection is deterministic and the asking is not, so this runs in two halves and
you are the middle.

## 1. Detect

    curtain setup detect --json

You get the package manager, the candidate start commands with where each was
found, any monorepo app directories, and a `questions` list.

## 2. Ask

Ask the user the questions, in your own words, in one message. Keep it short: at
most one round of questions. What matters is the project `name`, a start command
per app, and which env files to declare.

The `name` keys the machine-level env-values store, so `apply` refuses a config
declaring env files without one. Detect proposes one; confirm rather than invent.
Declare the env files detect infers from committed examples: that is what lets
`curtain up` repair a fresh clone or worktree by itself.

If a candidate is obvious, say what you are assuming instead of asking. A repo
with `make admin-dev` and `make guest-dev` needs no interview, only confirmation.

Detection is generous on purpose: a production-preview target can appear next to
the real dev server. Pick, do not paste the whole list.

The `ready` marker is optional. Ask for the line the app prints when it is
serving, and if the user does not know, leave it out: Curtain polls the URL
instead. Never invent a marker, since a wrong one turns every start into a
timeout.

## 3. Apply

    echo '<the config as JSON>' | curtain setup apply --config -

That writes `curtain.json` and adds `.curtain/` to `.gitignore`. Then run
`curtain doctor` to confirm, and tell the user to commit `curtain.json` so their
teammates and every future worktree inherit it.

Recording needs a browser: `curtain setup browser` installs a shared Playwright
and Chromium under your cache, reused by every checkout. Never add a browser to
the project's own dependencies to make a recording work.

If the project has a deployed hostname, add `"envs": { "prod": "example.com" }`:
recording refuses any target that does not classify as local, and an unknown
host counts as prod, so this only needs declaring to *allow* a preview host.

## What not to do

Do not write `curtain.json` by hand with the Write tool: `apply` validates it and
handles the gitignore. Do not put ports or pids in it, since they are always
discovered live. Do not touch the project's `.mcp.json`.
