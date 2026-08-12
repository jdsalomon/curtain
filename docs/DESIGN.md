# Design

Why Curtain is built the way it is, including the decisions that were wrong first.

An opinionated tool has to show its reasoning, or the opinions read as arbitrary. This document is
the reasoning. [ROADMAP.md](../ROADMAP.md) is what gets built and when.

## The problem

Every repo that grows past one developer and one branch re-derives the same handful of facts, in
prose, in several places, and the copies drift. Measured on one developer machine, one project, one
afternoon:

- **Three implementations of "find the dev server"**, in three different documents, disagreeing.
  One scanned a fixed port. One rolled its own free-port loop over four candidates. Two hundred
  recorded walks hardcoded nine distinct ports between them.
- **Five dev servers live across four checkouts** of the same repository at that moment, and no way
  to tell which was which.
- **Twenty-one committed browser tests** pinned to a port nothing was listening on. They did not
  fail. They ran against whatever answered.
- **488 lines of instructions** describing shell invocations that should have been one function, all
  of it re-read and reinterpreted on every invocation.
- **260 MB of recordings** nothing ever deleted, and ten abandoned test datasets in the local
  database. A prune command existed and was never called.
- **Two browser engines and no rule** about which to use.

The dangerous part is that none of this crashes. The tests go green against the wrong server and the
bug surfaces later, somewhere unrelated, as a confusing application bug.

**The conclusion that shaped everything else:** these facts must be *discovered every time by tested
code*, never written down where they can go stale. A stored port is a lie waiting to happen.

## What was already good

Curtain is an extraction, not an invention, and three things from the original were worth keeping:

- **A recording that doubles as an assertion.** If a locator is missing the run throws, so a clean
  video is a passing test. One artifact, two jobs.
- **A synthetic cursor**, because a screen recording captures no operating-system pointer.
- **Per-workspace data isolation**, which is the only thing that makes parallel work possible.

## Architecture

Global engine, per-project facts, per-project artifacts. Nothing about your project is ever stored
inside the plugin.

A second boundary matters as much: **nothing under `lib/` knows which agent harness is calling it.**
The engine is a zero-dependency Node CLI plus an MCP server, because that is the most portable shape
on offer, a command anything can run and a protocol several harnesses already speak. Harness-specific
packaging is a thin outer layer, currently a Claude Code plugin manifest, and it is the only part that
would need writing again for a second harness.

```
the plugin (installed once, global)
  .claude-plugin/plugin.json  # the only harness-specific file
  .mcp.json                  the browser driver, shipped
  skills/                    prose and judgment, ~40 lines each
  bin/curtain                # the deterministic surface
  lib/                       tested modules
  fixture/                   a real app, with no dependencies

any repo you point it at
  curtain.json               COMMITTED: the project's facts
  curtain.local.json         gitignored: optional per-machine overrides
  curtain/                   COMMITTED source, isolated per branch by git
  .curtain/                  GITIGNORED state, machine-local, disposable
    services.json            what `up` started
    logs/                    what each app printed
    artifacts/               versioned recordings
```

**The dot is the mnemonic: dotted is disposable.** The split is not cosmetic. Committed source cannot
live in an ignored directory, and if the action cache were ignored, every new worktree would start
empty and nothing would ever compound. Keeping it committed also means git supplies the
parallel-work isolation for free: a worktree on one branch physically cannot alter another branch's
checked-out entries.

Every phase has the same shape:

```
skill (prose, judgment)
  -> curtain <command>      (deterministic, tested)
       -> resolve()         (pure, no side effects)
       -> act, then record what happened
```

## The resolver contract

One function, and the only hard rule in the codebase: **it never starts, kills, seeds or writes.**

That purity is what makes it callable from every phase and testable with no app running. It is also
where the unit tests concentrate, because it is where the interesting logic lives.

It answers four questions:

**Where am I?** The git root, whether this is a main checkout or a worktree, a stable short id
derived from the absolute root path, and the branch.

Worktree detection compares the git directory against the common git directory. It deliberately does
not look at the path, because a worktree is usually created *inside* the checkout it came from, and
every path-prefix heuristic gets that exact case wrong.

**What did this project tell me?** `curtain.json`, found by walking up from the working directory to
the repository root, deep-merged with a gitignored local override. Arrays replace rather than
concatenate on merge, so an override can shrink a list. Absent config is a reported state, not an
error: every skill routes to setup rather than guessing.

**What is running?** The runfile first, a port scan as fallback, and **never trusted without
verification**. Verification is two checks, because either alone lies: the process must exist, and
the URL must answer. Any HTTP status counts as answering. Requiring 200 would call a healthy app
dead because its root route redirects.

A listener is classified by resolving its working directory to *that directory's own git root* and
comparing roots exactly. Three outcomes: mine, another checkout's (named, so you know whose), or
unattributable. An unattributable listener is reported and never adopted.

**Which app is it?** Identity comes from **who started the process**: the loopback URL the app
announced when Curtain launched it, with the process group's own listener as fallback for apps that
print nothing.

This matters more than it sounds, and it is why classification and attribution are two separate
steps. Two apps in one repository share a git root, so no amount of path inspection can tell them
apart: on a real machine, two dev servers on adjacent ports resolved to the same root, differing only
by a subdirectory that a monorepo task runner is free not to set. Only provenance can name the app.

Being in my own git root is **not enough to attribute an app**. It says whose repo the process
belongs to, not which app it is. A fingerprint has to confirm that, and a listener from an
unresolvable root is never adopted even if it matches, because a leftover server from a deleted
checkout will still serve a matching login page.

## Problems, not throws

Anything a phase might survive is a value with a stable code, not an exception:

```json
{ "code": "PORT_TAKEN", "app": "admin", "port": 3000,
  "owner": "worktrees/feature-x",
  "fix": "3000 belongs to worktrees/feature-x; free it or configure a different port" }
```

Codes are stable strings and skills branch on the code, never on the wording. Every problem carries
a `fix` line, because a diagnosis without a next action just moves the work.

Codes are constructed through a single factory that rejects an unknown code at the call site, so a
typo is a test failure rather than a branch that silently never matches.

**Exactly one thing throws:** a config file that exists and is not valid JSON. The file is a lie and
there is no safe interpretation, so every phase should stop. Notably `down` reads the runfile
directly and never resolves at all, which means a broken config can never trap a running server.

Blocking is a separate question from failing. `NOT_RUNNING` is not blocking, because a command whose
whole job is starting servers cannot treat "not started" as a failure.

## Decisions

Settled during design and recorded so they are not relitigated.

| # | Decision | Why |
|---|---|---|
| 1 | Ship as a plugin, installed once, working across projects | A plugin can ship its own engine config, so installing the tool installs the engine |
| 2 | Opinionated, no bring-your-own-tools | No adapter layer. One engine, one loop. A tool that supports everything documents nothing |
| 3 | One browser driver, shipped and owned | Removes a framework dependency the original had, and removes the "which one is this using" question entirely |
| 4 | Delegate browser mechanics upstream, own the loop | Selectors, tracing, storage state and request mocking are maintained by people who do only that |
| 5 | Detect first, ask only about the gaps | A detected fact cannot rot. An answered question can |
| 6 | Fat CLI, thin skills | Mechanics in tested code, judgment in prose. Fewer turns, less context, fewer retries |
| 7 | No `test` subcommand, ever | What is worth testing is judgment. The recorded walk covers the scripted half |
| 8 | Two cleanup classes | A crashed run must not leave data behind; a recording must never vanish before it is watched |
| 9 | Cleanup is a first-class command, and `doctor` reports debt while deleting nothing | Explicit cleanup went uninvoked because the debt was invisible, not because the command was missing |
| 10 | Production-aware, not read-only by construction | Blanket blocking of non-GET requests breaks server actions, so it fails confusingly instead of protecting anything |
| 11 | Config is per-repo and committed; ports are never stored | A worktree inherits it for free, and `git clone` followed by one command works for a teammate |
| 12 | Artifacts versioned locally, collapsed only on request | Iterating on a demo must not destroy the take you were about to watch |
| 13 | Build standalone first, migrate the original second | The portability claim gets tested before anything depends on it daily |
| 14 | The fixture is a product surface, not a test detail | It is the tutorial and the integration target at once, so they cannot drift |
| 15 | No global config file | Nothing needs one. Code defaults suffice |
| 16 | Scenes are a shape of the walk file, not a second command | Demo and test stop being two pipelines, and coverage becomes checkable instead of claimed |
| 17 | The action store is a cache, not a versioned library | Keyed, disposable, freely overwritten, regenerable. No semver, no pinning |
| 18 | Cache isolation comes from git | A branch cannot alter another branch's entries, and merged entries still compound |
| 19 | The cache index is derived and gitignored | A machine-maintained index committed across parallel branches conflicts on every merge |
| 20 | Layout correctness is geometry, not judgment | Occlusion, clipping, contrast, tap targets, overflow and layout shift are computable from the DOM, with no model and no network. Viewport is a first-class axis, since nearly every layout bug is viewport-conditional |
| 21 | A grounding model is a third locating strategy, not an engine | It fills cache misses and never runs at replay; it is used only where no structural locator can exist; and test mode refuses it outright. Which strategy runs is Curtain's rule, never a user flag, so decision 2 survives |

## Two cleanup classes

Split by one question: **could a human still want this?**

**Ephemeral, removed automatically.** Data a run committed, reversed by a teardown the host writes
and Curtain guarantees runs even when the run throws. Encode intermediates, once the final file has
landed. Runfile entries whose process is gone, dropped on read so the runfile self-heals. An
authentication blob that no longer authenticates, because a stale one is worse than none.

Curtain cannot know how to reverse your data, so the host owns the reversal and Curtain owns the
guarantee that it ran.

**Potentially useful, never removed automatically.** Recordings and screenshots, every version.
Isolated data this workspace provisioned, which is durable and expensive to rebuild. Walk files,
which are code. Anything at all outside the state directory, where the tool has no business.

Most durable to least: the isolated dataset survives everything; data a run created inside it is
reversed every run; encode intermediates are waste the moment the output exists.

`doctor` reports all of it and deletes none of it, naming the flag that would address each item.
Making the debt legible is the entire mitigation for cleanup being opt-in.

## Production awareness

Four parts, none of which is "block everything and hope".

**Declare.** A walk exports its intent: read, or write.

**Enforce.** A write against production refuses unless explicitly allowed, and the refusal names the
target host. A preview target warns and proceeds. Local is unrestricted. An unrecognized remote host
classifies as production, so the default fails safe. A host that merely *contains* the production
host is not the production host.

**Observe.** Against any non-local target, the run records every non-GET request the page issues and
reports them at the end. A walk that declared read and then wrote is caught after the fact. This is
the part that learns: Curtain tells you what a run actually touched instead of trusting its
declaration.

**Egress.** From v1.2, a run may *send* a screenshot to a grounding endpoint, and against a
production target that is production data leaving the building. So egress is a fourth part rather
than a footnote to the third, gated separately and refused by default for any non-local endpoint.

## Decisions we reversed

A design document that shows only the winning branch is not credible.

**Cleanup was going to be automatic on start.** Sweep the state directory whenever a run begins.
This was wrong in a way that took a while to see: it makes the tool unpredictable in exactly the
moment you least want surprises, and the thing most likely to be swept is the recording you were
about to watch. It became explicit, with the two classes above, and `doctor` making the debt visible
so that opt-in cleanup actually gets invoked.

**Production safety was going to be read-only by construction.** Block every non-GET request at the
network layer and the problem disappears. It does not: server actions and framework navigations use
POST for ordinary reads, so blanket blocking breaks the app in a way that looks like an application
bug and protects nothing. Declare, enforce, observe is more work and is honest.

**The action store was going to be a versioned library** with semver and pinning, so an old walk
could keep an old verb. That machinery buys almost nothing: a verb whose surface no longer exists
should be overwritten, not preserved. Making it a cache, keyed and disposable and regenerable,
deleted an entire subsystem. Isolation then came free from git, because the cache is committed.

## Testing philosophy

The unit tests concentrate on the resolver, because it is pure and it is where the logic is. Fakes
prove the branching; the real tools prove the flags exist and mean what we think, which is why the
integration suite shells out to real `git` and a real port scan, and why CI runs both macOS and
Linux. Reading a process's working directory is genuinely different code on the two platforms.

Three tests carry more weight than the rest:

- **A worktree created inside its parent checkout classifies as another checkout's.** This is the
  measured bug, stated as an assertion.
- **A server survives the process that started it exiting.** The only test that would catch a
  refactor back to piped output, where the read end closes when the CLI exits and the server dies
  minutes later on its next write, looking exactly like an application bug.
- **Every command named in a document exists.** The cheap guard against the failure that motivated
  the whole project: prose describing mechanics that are no longer there.

**Deliberately not tested:** the browser engine's own behaviour, which upstream tests better than we
could; and video encoding output, beyond the file existing and being non-trivial in size. Asserting
on the contents of an mp4 is a non-goal, permanently.

## How to disagree with this

The extension points are real, and so are the refusals.

**Where you are meant to extend:** the actions, which are yours and live in your repo. The walks,
same. Your provisioning and teardown commands, which Curtain calls and never replaces, because it
cannot know what your data means. Your start commands, your ready markers, your fingerprints.

**Where you are deliberately not:** the browser driver. There is no adapter layer and there will not
be one, because supporting two drivers means documenting neither well and testing neither
thoroughly. The loop itself, which is the opinion the tool exists to have. And the directory
contract, because committed-versus-ignored is load-bearing rather than stylistic.

**Worth separating from both:** the agent harness. Refusing a second browser driver is a real
opinion, and it is not the same as refusing a second harness. The CLI is portable by construction, so
a second harness costs a packaging layer rather than an abstraction, and that is a cost worth paying
once there is a second real case to fit.

If the loop is wrong for you, forking is a better answer than a plugin API. That is a real position,
not a dismissal: a tool with a plugin API for its core loop has no core loop.

## Open questions

- Whether the mutating-request patterns should have a sensible default rather than being entirely
  host-declared.
- Where a grounding endpoint should be hosted, and whether a local model is fast enough to be the
  default rather than a remote one.
- Where still-image baselines should live. They are large, they are binary, and they are per
  viewport, which makes committing them uncomfortable and not committing them useless.
