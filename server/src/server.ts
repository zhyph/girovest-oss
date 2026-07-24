import 'dotenv/config'
import type { Server } from 'http'
import { app } from './app.js'
import { signingApp } from './signingApp.js'
import { detectLanCandidates } from './network/lanNetwork.js'
import { runContractBackfill } from './services/contractBackfill.js'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await runContractBackfill()

const servers: Server[] = []

const server = app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`)
})
servers.push(server)

// Node's http.Server fires 'listening' optimistically even when the
// underlying bind will shortly fail (e.g. EADDRINUSE from a leftover
// process still holding the port) — the real failure only surfaces on
// this separate 'error' event. Without a handler here, that event has
// nowhere to go and the process exits silently with no message at all,
// making a stale-process port collision indistinguishable from a clean
// shutdown. Fail loudly and with a nonzero code instead.
server.on('error', (error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})

// signingApp binds to each detected LAN candidate individually (never
// 0.0.0.0 — see the design's security boundary). When the main app itself
// binds to 0.0.0.0 (the standalone/non-Electron default), it already
// occupies every address on this port, so any candidate bind would
// deterministically fail with EADDRINUSE — not a leftover-process problem,
// just an expected consequence of running standalone. Skip those up front
// with one clear line instead of letting each one crash-log a raw Node
// error object, which reads as a hard startup failure even though it
// isn't. Electron always sets HOST=127.0.0.1, so this only affects local/
// standalone runs — remote signing is simply unavailable there.
if (host === '0.0.0.0') {
  console.log(
    'Main app is bound to 0.0.0.0 (every address) — skipping the signing app, since any address it tried would already be taken. Remote signing isn\'t available when running standalone; it works normally under Electron (HOST=127.0.0.1).',
  )
} else {
  for (const candidate of detectLanCandidates()) {
    if (candidate.address === host) {
      console.log(`Skipping signing app on ${candidate.address}:${port} — already the main app's address.`)
      continue
    }
    // A bind failure on one candidate (e.g. the interface disappeared
    // between detection and bind) is logged, not fatal — remote signing on
    // that address just won't work, but the rest of the app (including
    // print, and signing on any other detected candidate) keeps running.
    const signingServer = signingApp
      .listen(port, candidate.address, () => {
        console.log(`Signing app listening on ${candidate.address}:${port}`)
      })
      .on('error', (error) => {
        console.error(`Failed to start signing app on ${candidate.address}:${port}:`, error)
      })
    servers.push(signingServer)
  }
}

// With no handler, Node's default SIGINT/SIGTERM disposition terminates
// the process immediately regardless of open listeners — but `tsx watch`
// (the dev-mode supervisor) doesn't rely on that default: it relays the
// signal to this process and polls for it to report itself exited within
// a short grace period before escalating to SIGKILL, printing "Previous
// process hasn't exited yet. Force killing...". Two listening sockets
// instead of one made this process cross that grace period more often
// than it used to. Closing everything and exiting explicitly here removes
// the guesswork tsx would otherwise have to do.
function shutdown() {
  for (const s of servers) s.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
