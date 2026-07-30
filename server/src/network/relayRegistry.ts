import type { RelayConnection } from './relayClient.js'

interface RegistryEntry {
  connection: RelayConnection
  expiryTimer: ReturnType<typeof setTimeout>
}

/**
 * Every relay connection this process has opened, keyed by its session token.
 *
 * Without it nothing ever called `RelayConnection.close()`: each signing token
 * (15 min) and each photo-session token (12h, and a fresh one every time the
 * photo-session modal is opened or "Gerar novo código" is pressed) left a
 * permanently-reconnecting socket behind for the life of the process, on top of
 * one per unexpired token reopened at every boot by `resumeRelayConnections`.
 * A connection is closed when its token expires or when the process shuts
 * down — never earlier. Submitting a signature deliberately does NOT close
 * the connection: the relayed `sign/status` check the phone pages make runs
 * over this same socket, so closing it on success would make an already-signed
 * link render as a working signature pad again. A signed session's socket
 * therefore lives out its token's full TTL, exactly like an unsigned one (and
 * like a photo session's, which was never closed early either).
 *
 * In-memory only, deliberately: a connection cannot outlive the process that
 * owns the socket, and boot-time resume already rebuilds the set from the DB.
 */
const connections = new Map<string, RegistryEntry>()

/** Node's setTimeout ceiling; a longer delay silently fires immediately. */
const MAX_EXPIRY_DELAY_MS = 2_147_483_647

/** Same guarded `unref` as relayClient.ts — a test's fake handle may lack it. */
function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
  const maybe = handle as unknown as { unref?: () => void }
  if (typeof maybe.unref === 'function') maybe.unref()
}

/**
 * Takes ownership of `connection` and closes it no later than `expiresAt`,
 * after which the token it serves is worthless to the phone anyway.
 */
export function registerRelayConnection(token: string, connection: RelayConnection, expiresAt: Date): void {
  // Re-registering the same token (boot resume racing a freshly issued token,
  // say) must not orphan the previous socket.
  closeRelayConnection(token)

  const delay = Math.min(Math.max(expiresAt.getTime() - Date.now(), 0), MAX_EXPIRY_DELAY_MS)
  const expiryTimer = setTimeout(() => closeRelayConnection(token), delay)
  unrefTimer(expiryTimer)
  connections.set(token, { connection, expiryTimer })
}

/** Closes and deregisters this token's connection; a no-op if there is none. */
export function closeRelayConnection(token: string): void {
  const entry = connections.get(token)
  if (!entry) return
  connections.delete(token)
  clearTimeout(entry.expiryTimer)
  entry.connection.close()
}

/** Closes every open connection. Called from the server's graceful shutdown. */
export function closeAllRelayConnections(): void {
  for (const token of [...connections.keys()]) closeRelayConnection(token)
}

/** Test/diagnostic helper: how many connections are currently held open. */
export function openRelayConnectionCount(): number {
  return connections.size
}
