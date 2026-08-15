---
name: seed
description: Use when a walk or a manual check needs data that is not there, when a workspace needs its own copy of test data, or when the user asks to seed, provision or reset the local data. Runs the project's own provisioning script and makes what it created discoverable.
---

# Give this workspace data of its own

`curtain seed` lists this project's seeds; `curtain seed <name>` runs one.
Curtain cannot know what your data means, so a seed is **your** script: Curtain
runs it and remembers what it hands back.

## Writing one

`curtain/seeds/<name>.mjs`, shaped like a walk. The smallest useful seed is
`export default async ({ run }) => { run('make provision') }`. Return an object
to make facts reachable from a walk as `tenant`:

```js
export const meta = { description: 'one account, no rows yet' }

export default async function empty({ run, workspace }) {
  run(`make provision TAG=${workspace.id}`)      // namespace per checkout
  return { slug: `demo-${workspace.id}` }
}
```

`run` executes where curtain.json lives, so project commands work unchanged, and
its output is captured for the failure message.

## A new state is a new file

Adding `empty.mjs` beside `full.mjs` cannot break `full.mjs`; adding a branch to
one parameterised script can break every state in it. There is no options
mechanism, on purpose. Write the state you need **when you need it**, and put
shared code in an underscored helper (`_common.mjs`), which stays off the menu.

## Using one from a walk

```js
export const meta = { target: 'guest', seed: 'empty' }

export default async ({ page, url, tenant }) => page.goto(url(`/${tenant.slug}`))
```

Curtain runs the seed before recording, every time, so **seeds must be
idempotent**. Never hardcode in a walk what a seed invented; read `tenant`.

| Code | What to do |
|---|---|
| `SEED_FAILED` | The command failed. `message` carries its output; read it, do not retry blindly |
| `NO_SUCH_SEED` | Wrong name, or no default export. `available` lists the real ones |
| `NO_CONFIG` | Use the `setup` skill first |

Curtain never talks to your database, owns a migration, or deletes anything. A
reset before provisioning belongs inside your script, where you can see it.
