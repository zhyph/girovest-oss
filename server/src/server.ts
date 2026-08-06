import 'dotenv/config'
import type { Server } from 'http'
import { app } from './app.js'
import { signingApp } from './signingApp.js'
import { detectLanCandidates } from './network/lanNetwork.js'
import { runContractBackfill } from './services/contractBackfill.js'
import { runProductBackfill } from './services/productBackfill.js'
import { runPaymentBackfill } from './services/paymentBackfill.js'
import { relayCredentialsFromEnv, resumeRelayConnections } from './network/relayResume.js'
import { closeAllRelayConnections } from './network/relayRegistry.js'
import { pruneExpiredIdempotencyKeys } from './network/relayIdempotencyPrune.js'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await runContractBackfill()
await runProductBackfill()
await runPaymentBackfill()

// Relay mode's WebSocket-per-session doesn't survive a process restart on
// its own (unlike LAN mode, which is stateless) — reopen one for every
// photo session that hasn't expired yet so a shift-long session survives a
// crash/update/restart. A no-op until Task 8 forwards the relay env vars
// into this process and/or the install is actually configured for relay.
await resumeRelayConnections(await relayCredentialsFromEnv())

// Fire-and-forget on purpose: bounding this table is housekeeping, and a DB
// hiccup here must never hold up (or fail) boot. Both outcomes are still
// reported — a silently swallowed failure would let the table grow forever
// with nothing anywhere to say why.
pruneExpiredIdempotencyKeys()
  .then((count) => {
    if (count > 0) console.log(`Pruned ${count} expired relay idempotency key(s)`)
  })
  .catch((error) => console.warn('Failed to prune relay idempotency keys:', error))

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

function closeServer(target: Server): Promise<void> {
  return new Promise((resolve) => target.close(() => resolve()))
}

// Actually waits for in-flight requests/connections to finish before
// exiting — closing a server stops it accepting new connections but
// doesn't itself terminate the process, and calling process.exit()
// immediately after (without waiting for the close callback) would drop
// whatever was still in flight, which defeats the point of a "graceful"
// shutdown. Bounded by SHUTDOWN_TIMEOUT_MS so a stuck connection can't
// hang the process forever.
const SHUTDOWN_TIMEOUT_MS = 5_000

async function shutdown() {
  // Relay sockets are outbound and not owned by any http.Server, so closing
  // the servers below would leave them open on the way out.
  closeAllRelayConnections()
  await Promise.race([
    Promise.all(servers.map(closeServer)),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ])
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
