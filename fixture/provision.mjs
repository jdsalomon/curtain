// The project's own provisioning command, the thing Curtain never writes.
//
// Real projects have one of these already: a make target, a migration runner, a
// script that talks to the database. Curtain's job is only to run yours and
// remember what it says, so this stands in for it.
//
//     node provision.mjs 3     put three items in the store
//     node provision.mjs 0     empty it
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const count = Number(process.argv[2] ?? 0)
if (!Number.isInteger(count) || count < 0) {
  console.error('usage: node provision.mjs <count>')
  process.exit(2)
}

const items = Array.from({ length: count }, (_, i) => ({ label: `item ${i + 1}` }))
const store = process.env.FIXTURE_STORE
  ? process.env.FIXTURE_STORE
  : fileURLToPath(new URL('./items.json', import.meta.url))
writeFileSync(store, JSON.stringify(items))
console.log(`provisioned ${count} item(s)`)
