import { prisma } from '../db/client.js'
import { openRelayConnection, type RelayConnection, type RelayCredentials } from './relayClient.js'
import { registerRelayConnection } from './relayRegistry.js'

/**
 * Unlike the LAN model (stateless — an always-running local server just
 * answers whichever token comes in), relay mode's WebSocket per session does
 * not survive a process restart on its own. On boot, every still-unexpired
 * photo session token needs its relay connection reopened, or a photo taken
 * while the app happened to be closed has nowhere to land. Signing tokens
 * are NOT resumed here — their 15-minute TTL makes "regenerate the QR" an
 * acceptable fallback, deliberately, per the design spec.
 */
export async function resumeRelayConnections(credentials: RelayCredentials | null): Promise<RelayConnection[]> {
  if (!credentials) return []
  const liveTokens = await prisma.productPhotoToken.findMany({
    where: { expiresAt: { gt: new Date() } },
    select: { token: true, expiresAt: true, location: { select: { connectivityMode: true } } },
  })
  // Each token's own location decides whether it gets resumed — a token
  // issued at a LAN-mode location has no business getting a relay socket
  // just because some other location on this install happens to be in relay
  // mode.
  return liveTokens
    .filter((row) => row.location.connectivityMode === 'relay')
    .map((row) => {
      const connection = openRelayConnection(row.token, credentials)
      // Resumed sockets go into the same registry as freshly issued ones, so
      // each one closes at its own expiry and all of them close at shutdown.
      registerRelayConnection(row.token, connection, row.expiresAt)
      return connection
    })
}

/**
 * Install-wide, location-independent: url/productKey/installId come only
 * from env, with no Prisma or location lookup at all. The boot-time caller
 * (server.ts) has no request context to derive a location from, and the two
 * request-context callers (routes/products.ts, routes/contracts.ts) already
 * resolve their own location and check its connectivityMode === 'relay'
 * before ever calling this — so gating on a location here would be redundant
 * at best and, for boot-time resume, wrong (that caller has many locations to
 * consider, not one).
 */
export async function relayCredentialsFromEnv(): Promise<RelayCredentials | null> {
  const url = process.env.GIROVEST_UPDATE_URL
  const productKey = process.env.GIROVEST_UPDATE_KEY
  const installId = process.env.GIROVEST_INSTALL_ID
  if (!url || !productKey || !installId) return null
  return { url, productKey, installId }
}
