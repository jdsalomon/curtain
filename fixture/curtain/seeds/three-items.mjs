// A seed that returns facts, and knows how to undo itself.
//
// Whatever it hands back becomes `tenant` in a walk, which is how a walk avoids
// hardcoding anything the seed invented: a slug, a login, a row id.
//
// The `cleanup` export is what `curtain cleanup` calls. It lives beside the
// provisioning half deliberately: the script that made the data is the script
// that unmakes it, so the two cannot drift apart.
export const meta = { description: 'three items already in the list' }

export default async function threeItems({ run, log }) {
  log(run('node provision.mjs 3').trim())
  return { count: 3, first: 'item 1' }
}

export async function cleanup({ run, log }) {
  run('node provision.mjs 0')
  log('items removed')
}
