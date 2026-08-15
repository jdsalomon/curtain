// A dependency-free two-role app, so the harness has something real to resolve.
// Roles: admin (login form + items), guest (items), quiet (announces nothing).
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROLE = process.argv[2] ?? 'admin'
if (!['admin', 'guest', 'quiet', 'vip'].includes(ROLE)) {
  console.error(`usage: node app.mjs <admin|guest|quiet|vip>`)
  process.exit(2)
}

// The vip role needs configuration to boot, the way real apps do. Started via
// `node --env-file=.env.local`, it is the surface the env machinery tests
// against: no file, no server.
if (ROLE === 'vip' && !process.env.VIP_CODE) {
  console.error('vip: VIP_CODE is not set; start me with --env-file=.env.local')
  process.exit(1)
}

// Items live in a file, not in memory, because real data outlives the process
// that serves it: that is what makes it seedable before the app is even up.
//
// FIXTURE_STORE points it elsewhere, the way a real app takes a database URL.
// The tests use it so concurrent runs cannot share one file: `node --test` runs
// test files in parallel, and a shared mutable store made them clobber each
// other in a way that only appeared in the full suite.
const STORE = process.env.FIXTURE_STORE
  ? process.env.FIXTURE_STORE
  : fileURLToPath(new URL('./items.json', import.meta.url))
const readItems = () => {
  try { return JSON.parse(readFileSync(STORE, 'utf8')) } catch { return [] }
}
const writeItems = (items) => writeFileSync(STORE, JSON.stringify(items))

// The fixture is what the README's recording shows, so it is dressed like a real
// product rather than a test harness. Two rules shape the palette:
//   - Nothing here may be crimson. The synthetic cursor is #A61131, and a stage
//     the same colour as the pointer is a stage with no visible pointer.
//   - Shadows are tinted plum, never black, so depth reads as warmth on paper.
// Everything is inline and dependency-free, which is the other half of the point.
const STYLE = `
*,*::before,*::after{box-sizing:border-box}
:root{--ink:#2A1018;--muted:#8A7076;--line:#EEE2E5;--paper:#FFFDFD;
  --warm:#E49B4F;--mint:#2F8F5B;
  --lift:0 1px 2px rgba(51,2,21,.05),0 14px 40px -12px rgba(51,2,21,.16)}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
  padding:2rem 1.25rem;color:var(--ink);-webkit-font-smoothing:antialiased;
  font:400 16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  background:radial-gradient(120% 80% at 50% -10%,#FFF3E4 0,transparent 60%),
    radial-gradient(90% 60% at 100% 100%,#FBE9EE 0,transparent 55%),#FDF8F6}
main{width:100%;max-width:26rem}
.badge{display:inline-flex;align-items:center;gap:.5rem;font-size:.6875rem;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.badge::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:var(--warm)}
h1{margin:.65rem 0 1.5rem;font-size:2rem;line-height:1.1;letter-spacing:-.02em;font-weight:700}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:16px;
  padding:1.5rem;box-shadow:var(--lift)}
label{display:flex;flex-direction:column;gap:.4rem;margin-bottom:1rem;
  font-size:.8125rem;font-weight:600;color:var(--muted)}
input{font:inherit;color:var(--ink);padding:.7rem .85rem;background:#fff;
  border:1px solid var(--line);border-radius:10px;transition:border-color .15s,box-shadow .15s}
input:focus{outline:0;border-color:var(--warm);box-shadow:0 0 0 3px rgba(228,155,79,.22)}
button{font:inherit;font-weight:600;width:100%;padding:.75rem 1rem;border:0;border-radius:10px;
  background:var(--ink);color:#fff;cursor:pointer;transition:transform .12s ease,filter .15s}
button:hover{filter:brightness(1.25)}
button:active{transform:translateY(1px)}
.card{padding:1.35rem;margin-bottom:1rem;background:#fff;border:1px solid var(--line);
  border-radius:12px;font-size:1.5rem;font-weight:700;letter-spacing:-.01em;
  transition:background .45s ease,border-color .45s ease,color .45s ease}
.card.saved{background:#EAF7F0;border-color:#BFE6D2;color:var(--mint)}
.hint{margin:1rem 0 0;font-size:.8125rem;color:var(--muted)}`

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${title}</title><style>${STYLE}</style><main>${body}</main>`

const LOGIN = page('Sign in', `
  <p class="badge">curtain fixture</p>
  <h1>Sign in</h1>
  <div class="panel">
    <form method="post" action="/login">
      <label>Email <input type="email" name="email" required></label>
      <label>Password <input type="password" name="password" required></label>
      <button type="submit">Sign in</button>
    </form>
  </div>`)

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (code, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type })
    res.end(body)
  }

  if (url.pathname === '/login') {
    if (req.method === 'POST') {
      res.writeHead(302, { location: '/', 'set-cookie': 'fixture-session=1; Path=/' })
      return res.end()
    }
    return send(200, LOGIN)
  }

  if (url.pathname === '/items') {
    if (req.method === 'GET') return send(200, JSON.stringify(readItems()), 'application/json')
    if (req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = Buffer.concat(chunks).toString() || '{}'
      const items = readItems()
      items.push(JSON.parse(body))
      writeItems(items)
      return send(201, JSON.stringify(items.at(-1)), 'application/json')
    }
    if (req.method === 'DELETE') {
      writeItems([])
      res.writeHead(204)
      return res.end()
    }
    return send(405, 'method not allowed', 'text/plain')
  }

  if (url.pathname === '/') {
    return send(200, page(ROLE, `
      <p class="badge">curtain fixture</p>
      <h1>${ROLE}</h1>
      <div class="panel">
        <div class="card" id="card">${readItems().length} item(s)</div>
        <button id="add">Add an item</button>
        <p class="hint">Writes to this server, and turns green once it lands.</p>
      </div>
      <script>
        document.getElementById('add').onclick = async () => {
          await fetch('/items', { method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'from the page' }) })
          const card = document.getElementById('card')
          const n = (await (await fetch('/items')).json()).length
          card.textContent = n + ' item(s)'
          card.classList.add('saved')
        }
      </script>`))
  }

  send(404, 'not found', 'text/plain')
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  if (ROLE !== 'quiet') {
    // The announcement is the contract: `up` captures the port from this line.
    console.log(`  Local:   http://localhost:${port}`)
    console.log('curtain-fixture ready')
  }
})
