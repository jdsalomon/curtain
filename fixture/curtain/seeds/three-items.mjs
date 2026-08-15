// A seed that returns facts. Whatever it hands back becomes `tenant` in a walk,
// which is how a walk avoids hardcoding anything the seed invented: a slug, a
// login, a row id. Here it is only a count, but the shape is the point.
//
// Adding another state is a new file next to this one, never an edit to this
// one, so a new case cannot break a working one.
export const meta = { description: 'three items already in the list' }

export default async function threeItems({ run, log }) {
  const out = run('node provision.mjs 3')
  log(out.trim())
  return { count: 3, first: 'item 1' }
}
