// The smallest useful seed: run the project's own provisioning command.
// Curtain never learns what "empty" means; it only knows this file is named it.
export const meta = { description: 'no items, for proving an empty state' }

export default async ({ run }) => { run('node provision.mjs 0') }
