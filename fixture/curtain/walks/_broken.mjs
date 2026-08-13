// A walk that cannot pass, so the failure path can be seen rather than trusted.
// Underscored, so `curtain walk` never advertises it while `curtain walk _broken`
// still runs it: scratch probes should be runnable without being on the menu.
export const meta = { target: 'admin', viewport: 'phone' }

export default async function broken({ page, url, click }) {
  await page.goto(url('/'))
  await click(page.getByRole('button', { name: 'A button that does not exist' }))
}

export async function cleanup({ request, url, log }) {
  await request.delete(url('/items'))
  log('cleanup ran even though the walk threw')
}
