# The Curtain fixture

Two tiny apps with no dependencies, so you can see what Curtain does before
pointing it at anything you care about.

    cd fixture
    curtain up

Two servers start on ports the OS picked, and Curtain tells you which. Run it
again and nothing restarts:

    curtain up        # "admin already running on ..., reused"

Now start a second copy from somewhere else and watch Curtain refuse to adopt it:

    node rogue.mjs &
    curtain doctor    # reports it as foreign, and names whose it is

Then put it all back:

    curtain down

## The three awkward cases, on purpose

| File | What it does | Why it exists |
|---|---|---|
| `app.mjs admin` | login form and an items list | the happy path, and the fingerprint target |
| `app.mjs guest` | items list only | a second app, so `up` has a gap to fill |
| `app.mjs quiet` | listens, announces no URL | forces port discovery to have a fallback |
| `rogue.mjs` | the same app from another git root | `foreign`, so it must not be adopted or killed |
| `deaf.mjs` | accepts connections, never answers | `NOT_ANSWERING`: an open port is not an app |
