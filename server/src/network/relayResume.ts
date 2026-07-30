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
    select: { token: true, expiresAt: true },
  })
  return liveTokens.map((row) => {
    const connection = openRelayConnection(row.token, credentials)
    // Resumed sockets go into the same registry as freshly issued ones, so
    // each one closes at its own expiry and all of them close at shutdown.
    registerRelayConnection(row.token, connection, row.expiresAt)
    return connection
  })
}

/**
 * Relay credentials only make sense once this install is actually configured
 * for relay mode (vs. LAN, the default) and Task 8's env wiring has forwarded
 * all three values into this process. Until Task 8 lands, GIROVEST_UPDATE_URL/
 * _KEY/_INSTALL_ID simply aren't present here, so this deliberately returns
 * null and boot-time resume is a no-op rather than opening connections with
 * partial credentials.
 */
export async function relayCredentialsFromEnv(): Promise<RelayCredentials | null> {
  const url = process.env.GIROVEST_UPDATE_URL
  const productKey = process.env.GIROVEST_UPDATE_KEY
  const installId = process.env.GIROVEST_INSTALL_ID
  if (!url || !productKey || !installId) return null

  // Single-location per install, matching resolveLocationId's existing
  // assumption elsewhere in the codebase.
  const location = await prisma.location.findFirst()
  if (location?.connectivityMode !== 'relay') return null

  return { url, productKey, installId }
}
