---
name: up
description: Use when starting this project's dev services, or when a test, demo or manual check needs the app running. Starts only what is missing and reports which URL belongs to which app.
---

# Bring the stack up

Run `curtain doctor` first. It resolves everything and tells you whether the
phase can run at all.

- Exit 0 means go, even when it lists `NOT_RUNNING`. That is what `up` is for.
- Exit 1 means blocked. Read the `problems` entries and act on the `fix` line.

Read that code from `curtain` itself. Piping to `tail` or `head` reports the
pipe's status, not Curtain's, so a blocked run looks like a clean one; `--json`
gives you the whole result when the output is long.

Then `curtain up` (or `curtain up admin` for one app).

## Reading the result

`started` is what you just launched. `reused` is what was already healthy and was
deliberately left alone, which is why the second run is fast. Report the URLs
back to the user, one line per app.

## When it does not work

Branch on the problem `code`, never on the wording.

| Code | What to do |
|---|---|
| `NO_CONFIG` | This repo has never been set up. Use the `setup` skill |
| `START_FAILED` | The command exited. The `output` field is the tail of its log; show it and read it, do not retry blindly |
| `NOT_READY` | Still compiling after the timeout. It is still running. Say so, wait, run `curtain up` again |
| `NOT_ANSWERING` | The port is open and the app is silent. Point the user at the `log` path |
| `UNHEALTHY` | It answers, with the wrong thing. A checkout that never ran needs its dependencies installed and its packages built first; otherwise read the `log` |
| `NO_ENV_VALUES` | The app needs an env file that exists nowhere on this machine. Use the `env` skill; do not start it by hand to see what happens |
| `PORT_TAKEN` | Another checkout owns that port. Name the `owner` so the user knows which one, then let Curtain use a different port |
| `UNCLAIMED_SERVER` | Something is listening that Curtain cannot attribute. Do not adopt it and do not kill it. Mention it once |

Never start a server with a bare `npm run dev` or a raw `make` call to work
around a problem. A server Curtain did not start is a server `down` cannot stop,
which is the exact mess this replaces.
