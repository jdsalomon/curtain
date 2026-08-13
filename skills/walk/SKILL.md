---
name: walk
description: Use after finishing a feature, when the user asks for a demo or a recording, or when a change needs proving rather than describing. Drives the real app in a real browser and records it, so a clean video is also a passing test.
---

# Show what you built

`curtain walk` lists this project's walks. `curtain walk <name>` runs one. Run
`curtain up` first: a walk names the app it drives, and the resolver turns that
name into wherever the app is listening right now.

## Plan the shot list before writing anything

A demo is not one lucky click-through. Decide the scenes first, three to six of
them: the happy path, the empty state, the boundary, and the thing you just
fixed. Then write the walk to that list, in one continuous order.

## Writing a walk

Create `curtain/walks/<name>.mjs`. It exports a default async function and gets a
toolkit; it never imports Playwright and never names a port.

```js
export const meta = { target: 'admin', viewport: 'phone' }   // phone | tablet | desktop

export default async function ({ page, url, click, point, type, sleep, log }) {
  await page.goto(url('/login'))
  await type(page.getByLabel('Email'), 'ada@example.com')
  await click(page.getByRole('button', { name: 'Sign in' }))
  await page.locator('.saved').waitFor()    // the assertion IS the demo
  await sleep(1200)                         // let the payoff land on camera
}

export async function cleanup({ request, url }) {   // runs even if the walk throws
  await request.delete(url('/items'))
}
```

`click` and `point` glide a visible cursor and ripple; `point` does not activate,
for things you must show but not press. Locate by role, label or test id, never by
visible copy, so a walk survives a restyle and a translation.

## The artifact rule

An mp4 exists only for a run that passed; a failed run keeps its raw webm, since
the frames before the failure usually explain it. Check the exit code.

| Code | What to do |
|---|---|
| `WALK_FAILED` | A step threw. `message` says which; the webm shows the state it reached |
| `CLEANUP_FAILED` | Data was left behind. Say so plainly, it needs a human |
| `NOT_RUNNING` | The app this walk targets is down. Run `curtain up <app>` |
| `MISSING_CHROMIUM` | No Playwright found. Show the `fix` line, do not install unasked |
| `MISSING_FFMPEG` | The webm is fine, there is just no mp4 or gif. Mention once |
| `TARGET_NOT_LOCAL` | Refused: a walk mutates data. Never pass `--force` on the user's behalf |

## After recording

Print the absolute path, say in one line what the clip shows, and stop. Posting
it to a pull request is outward-facing, so never publish unprompted.
