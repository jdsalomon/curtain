// A screencast records the page, not the screen, so it captures no mouse pointer.
// Without this a recording shows menus opening and forms filling for no visible
// reason, which reads as a glitchy montage rather than someone using the product.
//
// So we draw our own pointer, move it in step with the real one, and ripple where
// a click lands. The synthetic cursor is the difference between a video that
// explains itself and one that needs narration.

export const DEFAULT_ACCENT = '#A61131'

/**
 * Runs in the page on every navigation. Must be self-contained: it is serialized
 * and evaluated in the browser, so it can close over nothing but its argument.
 */
export function installCursor(accent) {
  const install = () => {
    if (document.getElementById('__curtain_cursor')) return
    const c = document.createElement('div')
    c.id = '__curtain_cursor'
    c.style.cssText = [
      'position:fixed', 'left:-40px', 'top:-40px', 'width:22px', 'height:22px',
      'margin:-11px 0 0 -11px', 'z-index:2147483647', 'pointer-events:none',
      'border-radius:50%', `background:${accent}59`, `border:2px solid ${accent}`,
      // A light ring outside the accent ring, so the pointer survives a dark
      // button as well as a white page. Curtain records apps whose palette it
      // cannot know, and an accent-only cursor disappears against a surface of
      // the same weight. On light backgrounds the ring is simply invisible.
      'box-shadow:0 0 0 1.5px rgba(255,255,255,.92),0 2px 10px rgba(0,0,0,.35)',
      'transition:left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1)',
    ].join(';')
    const dot = document.createElement('div')
    dot.style.cssText = 'position:absolute;left:50%;top:50%;width:5px;height:5px;'
      + `margin:-2.5px 0 0 -2.5px;border-radius:50%;background:${accent}`
    c.appendChild(dot)
    document.documentElement.appendChild(c)
  }
  // The script runs before the document exists on a cold navigation, so install
  // twice and let the id check make the second call a no-op.
  if (document.body) install()
  document.addEventListener('DOMContentLoaded', install)

  window.__curtainCursorTo = (x, y) => {
    const c = document.getElementById('__curtain_cursor')
    if (c) {
      c.style.left = `${x}px`
      c.style.top = `${y}px`
    }
  }
  window.__curtainRipple = (x, y) => {
    const r = document.createElement('div')
    r.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:14px;height:14px;`
      + `margin:-7px 0 0 -7px;border-radius:50%;border:2px solid ${accent};`
      + 'box-shadow:0 0 0 1.5px rgba(255,255,255,.6);'
      + 'z-index:2147483646;pointer-events:none;opacity:.9;'
      + 'transition:transform .5s ease,opacity .5s ease'
    document.documentElement.appendChild(r)
    requestAnimationFrame(() => {
      r.style.transform = 'scale(3.2)'
      r.style.opacity = '0'
    })
    setTimeout(() => r.remove(), 600)
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Move both pointers together. The drawn one eases via CSS; the real one steps,
 *  so hover states fire along the way exactly as they would for a person. */
export async function moveCursor(page, x, y, { settle = 520 } = {}) {
  await page.evaluate(([x, y]) => window.__curtainCursorTo?.(x, y), [x, y])
  await page.mouse.move(x, y, { steps: 6 })
  await sleep(settle)
}

/** Where the pointer should aim for a locator, after bringing it into view. */
async function aim(page, locator, what) {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await sleep(220)
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${what}: element has no bounding box (hidden or detached)`)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

/** Glide, ripple, then really click. A missing element throws, which is what makes
 *  a completed recording a passing test rather than a happy accident. */
export async function clickThing(page, locator, { settle = 700 } = {}) {
  const { x, y } = await aim(page, locator, 'click')
  await moveCursor(page, x, y)
  await page.evaluate(([x, y]) => window.__curtainRipple?.(x, y), [x, y])
  await sleep(160)
  await locator.click()
  await sleep(settle)
}

/** Glide and ripple without activating: for the things a demo must point at but
 *  must not press, like a mailto link or an external href. */
export async function pointAt(page, locator, { settle = 1100 } = {}) {
  const { x, y } = await aim(page, locator, 'point')
  await moveCursor(page, x, y)
  await page.evaluate(([x, y]) => window.__curtainRipple?.(x, y), [x, y])
  await sleep(settle)
}

/** Click into a field and type key by key. `fill()` would be faster and would look
 *  like the text teleported in, which is the one thing a demo must not look like. */
export async function typeInto(page, locator, text, { delay = 55, settle = 350 } = {}) {
  const { x, y } = await aim(page, locator, 'type')
  await moveCursor(page, x, y)
  await locator.click()
  await locator.pressSequentially(String(text), { delay })
  await sleep(settle)
}
