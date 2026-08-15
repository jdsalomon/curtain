---
name: down
description: Use when finished with the dev services, or when the user asks to stop the app. Stops only what this workspace started and leaves other checkouts alone.
---

# Take the stack down

Run `curtain down` (or `curtain down guest` for one app).

It stops only what this workspace's runfile claims, verified live, so a server
belonging to another worktree or another checkout is never touched. It signals
the whole process group, so the shell, the task runner and the server all stop
together.

## Reading the result

`stopped` is what it took down. `gone` was already dead and its claim is now
cleared. `failed` means a process would not die even after SIGKILL: say so
plainly with the pid, because that needs a human.

## After stopping

`down` removes nothing from disk, on purpose. Run `curtain cleanup` to show what
has piled up (recordings, logs, seeded data) with sizes, and surface that list.
It deletes nothing; the user decides. `curtain doctor` additionally reports a
`debt` section when this workspace has listeners of its own that no app claims.

Never clean up on the user's behalf: what lingers is exactly the kind of thing
someone was about to use.
