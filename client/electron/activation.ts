import { createPublicKey, verify } from 'node:crypto'
import fs from 'fs'
import path from 'path'

/**
 * App-side activation.
 *
 * The central point: verifyActivationToken uses NO network. After the first
 * activation the app checks the signature locally on every boot, forever, and
 * that is what separates this lock from a kill switch — a dead connection, a
 * Worker outage or an expired secret can never keep the shop from working.
 *
 * Verification uses only the PUBLIC key, baked into the bundle at build time.
 * The app can check everything and sign nothing.
 */

const TOKEN_FILE = 'activation-token'

export type ActivationState =
  | { readonly state: 'activated' }
  /** Registered, waiting for the licensor to approve it in the admin panel. */
  | { readonly state: 'pending'; readonly code: string }
  /** Refused because it was revoked, or because this is a different machine. */
  | { readonly state: 'refused'; readonly reason: string }
  /** Couldn't reach the server. Distinct from a refusal: retrying is worthwhile. */
  | { readonly state: 'unreachable' }
  /** No machine fingerprint source answered: let it through. */
  | { readonly state: 'unverifiable' }

interface TokenPayload {
  readonly installId: string
  readonly machineHash: string
  readonly issuedAt: string
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Checks the token against this installation and this machine.
 *
 * Order matters: the signature is validated BEFORE any payload field is
 * trusted. Reading installId/machineHash out of an unverified payload and then
 * comparing them would be theatre — whoever edits the file edits both.
 */
export function verifyActivationToken(
  token: string | null,
  installId: string,
  machineHash: string,
  publicKeySpkiBase64: string,
): boolean {
  if (token == null || token === '' || publicKeySpkiBase64 === '') return false
  const [head, signature] = token.split('.')
  if (head == null || signature == null) return false

  let data: Buffer
  try {
    data = decodeBase64Url(head)
    const key = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    })
    // Ed25519: null algorithm, the signature already covers the hash internally.
    if (!verify(null, data, key, decodeBase64Url(signature))) return false
  } catch {
    // Broken base64, an invalid public key, a token from another algorithm:
    // all of that is an invalid token, not an exception to propagate.
    return false
  }

  let payload: TokenPayload
  try {
    payload = JSON.parse(data.toString('utf-8')) as TokenPayload
  } catch {
    return false
  }
  return payload.installId === installId && payload.machineHash === machineHash
}

export function tokenPath(userDataPath: string): string {
  return path.join(userDataPath, TOKEN_FILE)
}

export function readStoredToken(userDataPath: string): string | null {
  try {
    const value = fs.readFileSync(tokenPath(userDataPath), 'utf-8').trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/** Stores the token. A write failure isn't fatal: the app just reactivates next boot. */
export function storeToken(userDataPath: string, token: string): boolean {
  try {
    fs.writeFileSync(tokenPath(userDataPath), token, 'utf-8')
    return true
  } catch {
    return false
  }
}

export interface ActivationEndpoint {
  readonly url: string
  readonly productKey: string
}

type FetchLike = typeof globalThis.fetch

/**
 * Asks the server to activate. Only called when the local token doesn't serve.
 *
 * 202 means "pending", not an error: the owner is still going to approve it in
 * the panel, and the app should show the code and keep retrying. 403 is a final
 * refusal. Anything else, including the 503 from a server with no signing key,
 * becomes `unreachable` — the common case is no internet, and the right move is
 * to retry rather than accuse the shop of anything.
 */
export async function requestActivation(
  endpoint: ActivationEndpoint,
  installId: string,
  machineHash: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<{ readonly result: ActivationState; readonly token?: string }> {
  let response: Response
  try {
    response = await fetchImpl(`${endpoint.url.replace(/\/+$/, '')}/activate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.productKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ installId, machineHash }),
    })
  } catch {
    return { result: { state: 'unreachable' } }
  }

  let body: { token?: unknown; code?: unknown; reason?: unknown } = {}
  try {
    body = (await response.json()) as typeof body
  } catch {
    body = {}
  }

  if (response.status === 200 && typeof body.token === 'string') {
    return { result: { state: 'activated' }, token: body.token }
  }
  if (response.status === 202) {
    return {
      result: { state: 'pending', code: typeof body.code === 'string' ? body.code : installId.slice(0, 8).toUpperCase() },
    }
  }
  if (response.status === 403) {
    return {
      result: { state: 'refused', reason: typeof body.reason === 'string' ? body.reason : 'denied' },
    }
  }
  return { result: { state: 'unreachable' } }
}

export interface EnsureActivatedInput {
  readonly userDataPath: string
  readonly installId: string
  readonly machineHash: string | null
  readonly publicKey: string
  readonly endpoint: ActivationEndpoint | null
  readonly fetchImpl?: FetchLike
}

/**
 * Decides whether the app may open, activating when needed.
 *
 * Two cases let it through without a token, both deliberate:
 *   - null machineHash: no fingerprint source answered (see machineId.ts).
 *     Blocking here would turn an OS quirk into a shop that can't open.
 *   - no endpoint configured in the build: this is a development or a
 *     misconfigured build, and locking the developer out of their own app helps
 *     nobody. The warning goes to the log.
 */
export async function ensureActivated(input: EnsureActivatedInput): Promise<ActivationState> {
  const { userDataPath, installId, machineHash, publicKey, endpoint } = input
  if (machineHash === null) return { state: 'unverifiable' }
  if (endpoint === null || endpoint.url === '' || endpoint.productKey === '' || publicKey === '') {
    return { state: 'unverifiable' }
  }

  if (verifyActivationToken(readStoredToken(userDataPath), installId, machineHash, publicKey)) {
    return { state: 'activated' }
  }

  const { result, token } = await requestActivation(
    endpoint,
    installId,
    machineHash,
    input.fetchImpl ?? globalThis.fetch,
  )
  if (result.state === 'activated' && token != null) {
    // Re-verify what the server sent before storing it. A token that fails local
    // verification must never become a file: on the next boot it would fail
    // again and put the app in an unexplained reactivation loop.
    if (!verifyActivationToken(token, installId, machineHash, publicKey)) {
      return { state: 'refused', reason: 'bad_token' }
    }
    storeToken(userDataPath, token)
  }
  return result
}
