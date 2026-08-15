// Sign in, add an item, watch the card turn green.
//
// Note what is not here: a port, a base URL, an env var, a Playwright import, or a
// path into the plugin. `target: 'admin'` is the whole address, and Curtain turns
// it into wherever this workspace's admin app is listening right now.
//
// Every locator is a contract (a role, a label) rather than a CSS path, so this
// keeps working through a restyle. The one exception is `.card.saved`, which is
// the assertion: the class the app adds only after the server confirmed the write.

export const meta = {
  target: 'admin',
  viewport: 'phone',
  // The walk used to assume the list happened to be empty. Now it says so, and
  // Curtain guarantees it before recording.
  seed: 'empty',
}

export default async function addAnItem({ page, url, click, type, sleep, log }) {
  log('signing in')
  await page.goto(url('/login'))
  await type(page.getByLabel('Email'), 'ada@example.com')
  await type(page.getByLabel('Password'), 'hunter2')
  await click(page.getByRole('button', { name: 'Sign in' }))

  log('adding an item')
  await click(page.getByRole('button', { name: 'Add an item' }))

  // The payoff, and the assertion. `.saved` is added only after the POST resolved,
  // so if the write silently failed this throws and there is no mp4 to mistake for
  // a passing run.
  await page.locator('.card.saved').waitFor({ timeout: 5000 })
  await page.getByText('1 item(s)').waitFor({ timeout: 5000 })

  log('holding on the payoff')
  await sleep(1400)      // let the 400ms green transition finish on camera
}

/** Runs even when the walk throws, while the page and request context are alive. */
export async function cleanup({ request, url, log }) {
  await request.delete(url('/items'))
  log('reversed: items list emptied')
}
