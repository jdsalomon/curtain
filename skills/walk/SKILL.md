---
name: walk
description: Use after finishing a feature, when the user asks for a demo or a recording, or when a change needs proving rather than describing. Drives the real app in a real browser and records it, so a clean video is also a passing test.
---

# Show what you built

`curtain walk` lists this project's walks; `curtain walk <name>` runs one. Run
`curtain up` first: a walk names the app it drives, and the resolver turns that
into wherever the app is listening right now.

## Plan the shot list, then write it

A demo is not one lucky click-through: decide three to six scenes first (happy
path, empty state, boundary, the thing you just fixed) and write to that list.
Each is `curtain/walks/<name>.mjs`, a default async function given a toolkit,
importing no Playwright and naming no port.

```js
export const meta = { target: 'admin', viewport: 'phone', seed: 'empty' }

export default async function ({ page, url, click, point, type, sleep, log }) {
  await page.goto(url('/login'))
  await type(page.getByLabel('Email'), 'ada@example.com')
  await click(page.getByRole('button', { name: 'Sign in' }))
  await page.locator('.saved').waitFor()    // the assertion IS the demo
  await sleep(1200)                         // let the payoff land on camera
}

// runs even if the walk throws:
export async function cleanup({ request, url }) { await request.delete(url('/items')) }
```

`click` and `point` glide a cursor and ripple; `point` does not activate, for what
you must show but not press. Locate by role, label or test id, not visible copy,
and add `.filter({ visible: true })` when a responsive layout renders the same
text twice. `viewport` is phone, tablet or desktop; `seed` runs first and hands
you its facts as `tenant`. Finding an element waits 10s (`timeout`), navigating
waits 60s (`navigationTimeout`): a route compiling for the first time is slow in
a way a missing button never is.

## The artifact rule

An mp4 exists only for a run that passed; a failed run keeps its webm, since the
frames before a failure usually explain it. Check the exit code.

| Code | What to do |
|---|---|
| `WALK_FAILED` | A step threw. `message` says which; the webm shows the state it reached |
| `CLEANUP_FAILED` | Data was left behind. Say so plainly, it needs a human |
| `NOT_RUNNING` | The app this walk targets is down. Run `curtain up <app>` |
| `MISSING_CHROMIUM` | No Playwright found. Show the `fix` line, do not install unasked |
| `MISSING_FFMPEG` | The webm is fine, there is just no mp4 or gif. Mention once |
| `TARGET_NOT_LOCAL` | Refused: a walk mutates data. Never pass `--force` on the user's behalf |
| `SEED_FAILED` | The data this walk needs was not made. Use the `seed` skill |

Afterwards print the absolute path, say in one line what it shows, and stop.
Posting to a pull request is outward-facing: never publish unprompted.
