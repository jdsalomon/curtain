// One renderer, so --json is total rather than per-command, and so the text form
// stays consistent enough for a human to skim across phases.
export function emit(values, data, text) {
  if (values.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
  } else if (!values.quiet) {
    process.stdout.write(`${text}\n`)
  }
  return data.exitCode ?? 0
}

const bullet = (s) => `  ${s}`

export function renderResolved(r) {
  const lines = []
  const { workspace: ws } = r
  lines.push(`workspace  ${ws.root}`)
  lines.push(`           ${ws.kind}${ws.branch ? ` on ${ws.branch}` : ''}, id ${ws.id}`)
  lines.push(`config     ${r.configured ? r.sources.join(', ') : 'none'}`)

  if (Object.keys(r.services).length) {
    lines.push('', 'running')
    for (const [name, s] of Object.entries(r.services)) {
      lines.push(bullet(`${name.padEnd(10)} ${s.url}  pid ${s.pid}  via ${s.source}`))
    }
  }
  const envEntries = r.envFiles?.entries ?? []
  if (envEntries.some((e) => e.state !== 'linked' || e.missingKeys.length)) {
    // Only shown when something needs attention: an all-linked, all-satisfied
    // env section is the normal state and would be noise on every resolve.
    lines.push('', 'env')
    for (const e of envEntries) {
      const where = e.state === 'linked' ? 'linked'
        : e.state === 'file' ? 'file, not in the store'
        : e.canonicalExists ? 'missing, values in store'
        : 'missing, no values anywhere'
      const drift = e.missingKeys.length ? `  missing ${e.missingKeys.join(', ')}` : ''
      lines.push(bullet(`${e.app.padEnd(10)} ${e.rel}  ${where}${drift}`))
    }
  }
  if (r.foreign.length) {
    lines.push('', 'other checkouts')
    for (const f of r.foreign) {
      lines.push(bullet(`${String(f.port).padEnd(10)} ${f.owner}  pid ${f.pid}`))
    }
  }
  // Listeners in this workspace that no fingerprint claimed are actionable, so
  // they are named. Everything else on the machine is ambient and gets a count:
  // a full listing of every socket a laptop has open buries the useful rows.
  if (r.unclaimed.length) {
    const ours = r.unclaimed.filter((u) => u.kind === 'mine')
    const ambient = r.unclaimed.length - ours.length
    if (ours.length) {
      lines.push('', 'unattributed in this workspace')
      for (const u of ours) {
        lines.push(bullet(`${String(u.port).padEnd(10)} ${u.command ?? '?'}  pid ${u.pid}`))
      }
    }
    if (ambient) {
      lines.push('', `also listening, not this workspace  ${ambient}`)
      lines.push(bullet('curtain resolve --json lists them'))
    }
  }
  if (r.problems.length) {
    lines.push('', 'problems')
    for (const p of r.problems) {
      // A problem that stands for a set names the set, not its first member.
      const subject = p.app ? ` ${p.app}`
        : p.count > 1 ? ` ${p.count} listeners`
        : p.port ? ` :${p.port}`
        : ''
      lines.push(bullet(`${p.code}${subject}`))
      if (p.fix) lines.push(`    ${p.fix}`)
    }
  }
  return lines.join('\n')
}
