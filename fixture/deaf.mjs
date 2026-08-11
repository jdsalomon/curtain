// Listens, accepts, and never answers. The point is that "a port is open" and
// "the app is up" are different claims, and only the second one matters.
import { createServer } from 'node:net'

const server = createServer((socket) => {
  // Hold the connection open and send nothing at all.
  socket.on('error', () => {})
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`  Local:   http://localhost:${port}`)
  console.log('curtain-fixture ready')
})
