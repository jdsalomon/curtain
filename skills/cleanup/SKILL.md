---
name: cleanup
description: Use when the user asks to clean up, tear down, free space, or close out work, and after a demo when recordings and seeded data have piled up. Shows what could be deleted and deletes only when told to.
---

# Delete what you are done with

`curtain cleanup` measures and lists. It deletes nothing.

**Show the user the list and let them decide.** Only run `curtain cleanup --yes`
when they have said so for this run. Recordings and seeded data are exactly the
kind of thing someone was about to use.

## What it covers, and what it cannot

Curtain's own artifacts (recordings, logs) are measured exactly, because Curtain
made them. Your data is undone by **your** seed: a seed that exports `cleanup`
can undo itself, and Curtain calls it.

The dry run never invokes a host teardown, not even to preview it, so the
teardowns are **named, not inspected**. When the user needs to know exactly what
one deletes, read the seed file and tell them what it says.

A seed is only a candidate when this workspace recorded running it, so cleanup
cannot reach another checkout's data.

## Writing a teardown

Beside the provisioning half, in the same file, so the two cannot drift:

```js
export default async ({ run }) => { run('make provision'); return { slug: 'x' } }

export async function cleanup({ run, tenant }) {
  run(`make unprovision SLUG=${tenant.slug}`)
}
```

A seed with no `cleanup` export simply is not listed. That is honest, not a
warning to escalate: it made data it cannot unmake, and saying nothing false
about it is the right behaviour.

| Code | What to do |
|---|---|
| `CLEANUP_FAILED` | A teardown failed. Its data is still there and its record is kept on purpose, so nothing is silently forgotten. Show `message` |

## What it never touches

Not the runfile, so `curtain down` can still stop what is running. Not any
shared service, database or container: those belong to every checkout, not to
this one. Stopping a server is not deleting a database, and deleting rows is not
deleting the thing that stores them. Removing a worktree or a branch is git
surgery and stays a human decision.
