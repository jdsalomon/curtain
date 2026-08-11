// A dependency-free two-role app, so the harness has something real to resolve.
// Roles: admin (login form + items), guest (items), quiet (announces nothing).
import { createServer } from 'node:http'

const ROLE = process.argv[2] ?? 'admin'
if (!['admin', 'guest', 'quiet'].includes(ROLE)) {
  console.error(`usage: node app.mjs <admin|guest|quiet>`)
  process.exit(2)
}

let items = []

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font:16px system-ui;margin:3rem;max-width:40rem}` +
  `.card{padding:1rem;border:1px solid #ddd;border-radius:8px;transition:background .4s}` +
  `.card.saved{background:#e8f5e9}</style>${body}`

const LOGIN = page('Sign in', `
  <h1>Sign in</h1>
  <form method="post" action="/login">
    <label>Email <input type="email" name="email" required></label>
    <label>Password <input type="password" name="password" required></label>
    <button type="submit">Sign in</button>
  </form>`)

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
    if (req.method === 'GET') return send(200, JSON.stringify(items), 'application/json')
    if (req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = Buffer.concat(chunks).toString() || '{}'
      items.push(JSON.parse(body))
      return send(201, JSON.stringify(items.at(-1)), 'application/json')
    }
    if (req.method === 'DELETE') {
      items = []
      res.writeHead(204)
      return res.end()
    }
    return send(405, 'method not allowed', 'text/plain')
  }

  if (url.pathname === '/') {
    return send(200, page(ROLE, `
      <h1>${ROLE}</h1>
      <div class="card" id="card">${items.length} item(s)</div>
      <button id="add">Add an item</button>
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
