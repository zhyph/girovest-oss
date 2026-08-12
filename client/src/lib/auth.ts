const TOKEN_KEY = 'dress-store-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  // Fire-and-forget: hashing is async (Web Crypto), but every existing
  // caller relies on setToken itself being synchronous (localStorage.setItem
  // is), so this must not become an awaited step in that path -- it would
  // change real timing to chase a purely diagnostic one. See
  // hashTokenForLog's own comment for why this exists at all.
  void hashTokenForLog(token).then((hash) => console.info(`[client-auth] setToken tokenHash=${hash}`))
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// Diagnostic-only fingerprint, same convention as the server's
// server/src/auth/jwt.ts hashTokenForLog (and infra/update-proxy's for relay
// tokens): never the bearer value itself, just enough (SHA-256, truncated to
// 16 hex chars) to tell "is this literally the same token" apart across two
// separate log lines -- here, specifically whether what apiFetch reads from
// localStorage right before a request matches what the server logs as
// rejected for that same request, and whether what setToken just WROTE
// matches what the very next getToken() call READS. Electron's renderer
// console is captured into main.log by client/electron/main.ts's
// attachConsoleLogging, so this reaches the same diagnostics upload the
// server-side hash does.
export async function hashTokenForLog(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
