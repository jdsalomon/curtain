# Brand

## The name

**Curtain.** Chosen for the communication angle: the browser driver is Playwright, so a
theatre-family name places the tool without a word of explanation.

> **Playwright writes the script. Curtain stages it.**

The metaphor was discovered in the design rather than imposed on it, which is why it holds up: the
design already used **scenes**, **walks**, **takes** and **captions** before the name existed.

| Command | Theatre reading |
|---|---|
| `curtain up` | house lights, the show begins, and the literal idiom |
| `curtain seed` | set dressing |
| `curtain walk` | the blocking rehearsal, recorded |
| `curtain actions` | the props table |
| `curtain down` | strike the set, also the literal idiom |
| `curtain cleanup` | load-out |

Modes map the same way: `test` is the rehearsal, `dev` the tech run, `product` opening night.

**Deliberately avoided:** *Backstage* (Spotify's developer portal) and *Stagehand* (Browserbase's
AI browser automation) are both occupied in this exact space.

## The mark

A rounded tile: crimson curtain panels swept aside over a deep plum ground, revealing a glowing
browser window. It is an illustration rather than an abstract mark, chosen deliberately over
cleaner geometric alternatives because it states what the tool actually does, which is stage a web
app, and because the glow gives it a sense of a reveal that a flat mark could not carry.

The asymmetry is intentional. The panels are not mirrored, so the curtain reads as genuinely pulled
aside rather than as a diagram.

## Palette

Sampled from the final artwork, not specified in advance.

| Token | Hex | Share | Use |
|---|---|---|---|
| `plum-dark` | `#330215` | 39% | the ground and the rounded frame |
| `curtain-red` | `#A61131` | 33% | the curtain panels |
| `stage-amber` | `#E49B4F` | 11% | the browser window and its glow |
| `plum-mid` | `#4D051A` | 4% | fold slabs |

The remaining few percent are glow blends between amber and crimson.

## Files

| File | Size | Use |
|---|---|---|
| `assets/icon-master.png` | 853 | the master, transparent background, tight crop |
| `assets/icon-512.png` | 512 | marketplace listing |
| `assets/icon-256.png` | 256 | README header, general use |
| `assets/icon-128.png` | 128 | plugin list rows |
| `assets/icon-64.png` | 64 | small list rows |
| `assets/icon-32.png` | 32 | favicon scale |

## Why PNG and not SVG

The glow is what makes this mark work, and a soft radial glow is exactly what vectorization handles
worst: it traces into thousands of tiny paths and produces a bloated, ugly SVG. So this ships as a
fixed-size PNG set, which is entirely normal for a plugin icon.

If an SVG is ever needed, generate a flat variant without the glow rather than trying to vectorize
this one.

**Known limitation:** at 32 the fold detail and the browser window are lost and the icon reads as a
warm glow behind red. Still distinct in a list, but a purpose-built 32 variant would be better than
downscaling this one further.

## What the exploration taught

Five rounds, twenty candidates. The wrong turns are worth recording, because the lesson generalizes.

1. **Velvet illustration.** Eight candidates. A curtain revealing a browser window was generated
   first, dismissed too quickly as too busy, then chosen at the end. Also tried: a vertical light
   slit (reads as gift-box ribbon, because the light sits on top of the curtain rather than behind a
   gap), a proscenium arch with a beam (the beam reads as a fountain-pen nib), and a wedge gap (the
   negative space reads as the letter A).
2. **Abstract caret.** A pivot on the theory that the mark should be abstract like Vite or Zed,
   using the gap between panels as a terminal cursor. Six candidates, some genuinely clean, all
   rejected: abstraction bought tidiness at the cost of saying anything about web apps.
3. **Symmetry.** Three symmetric versions of the round 1 favourite. Rejected, because mirroring the
   panels made it look like a diagram.
4. **The shipped mark.** The round 1 favourite with rounded corners and nothing else changed.

**The lesson worth keeping:** the illustrative candidate was dismissed on craft grounds (asymmetry,
busy folds) when the craft problems were fixable and the concept was the valuable part. Judge the
idea and the execution separately.

## How it was made

Image generation and transforms by prompt, background removal by a hosted model, then ImageMagick
and Pillow for the crop and the size set. No hand-written SVG or CSS art.
