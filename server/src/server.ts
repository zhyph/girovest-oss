import 'dotenv/config'
import { app } from './app.js'
import { signingApp } from './signingApp.js'
import { detectLanCandidates } from './network/lanNetwork.js'
import { runContractBackfill } from './services/contractBackfill.js'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await runContractBackfill()

const server = app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`)
})

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
// 0.0.0.0 — see the design's security boundary). A bind failure on one
// candidate (e.g. the interface disappeared between detection and bind)
// is logged, not fatal — remote signing on that address just won't work,
// but the rest of the app (including print, and signing on any other
// detected candidate) keeps running.
for (const candidate of detectLanCandidates()) {
  signingApp
    .listen(port, candidate.address, () => {
      console.log(`Signing app listening on ${candidate.address}:${port}`)
    })
    .on('error', (error) => {
      console.error(`Failed to start signing app on ${candidate.address}:${port}:`, error)
    })
}
