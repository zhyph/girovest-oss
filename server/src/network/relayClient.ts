import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { submitSignature, checkTokenValidity as checkSigningTokenValidity } from '../services/signingService.js'
import {
  createProductFromPhotoToken,
  submitPhotos,
  checkTokenValidity as checkPhotoTokenValidity,
} from '../services/productPhotoTokenService.js'
import { listProductsForLocation } from '../services/productService.js'
import { productCreateSchema } from '../lib/productValidation.js'
import { submitPhotosSchema, submitSignatureSchema } from '../lib/signingValidation.js'

export interface RelayMessage {
  requestId: string
  subPath: string
  method: string
  body: unknown
}

export interface RelayAck {
  requestId: string
  status: number
  body: unknown
}

/**
 * Runs `apply` for the idempotency `key`, returning `duplicate` without
 * re-running it when the key has been seen before (relay delivery is
 * at-least-once, and the phone pages reuse one key per logical payload so a
 * manual retry of the same submission is recognizable).
 *
 * The key is recorded only AFTER `apply` completes, so a recorded key always
 * means the write actually happened. Recording it first would open a window
 * (a crash or shutdown between claim and write) where the phone's retry hits
 * the claim and gets a fake `200 ok` with nothing written — a silent loss.
 *
 * Concurrent deliveries of the same key (a slow write pushing the first
 * attempt past the DO's ack timeout while the phone already retries) are
 * serialized through `inFlightByKey`: the duplicate waits for the in-flight
 * attempt and then re-reads the table, inheriting success as a duplicate ack
 * or a failure as a genuinely fresh retry. All relay dispatch happens in this
 * one process, so in-process serialization is complete; the DB unique index
 * remains as a backstop, and losing that race is treated as "already
 * recorded", never surfaced as an error.
 */
const inFlightByKey = new Map<string, Promise<unknown>>()

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

async function runIdempotent<T>(
  sessionToken: string,
  key: string | undefined,
  duplicate: T,
  apply: () => Promise<T>,
): Promise<T> {
  if (!key) return apply()

  const existing = await prisma.relayIdempotencyKey.findUnique({ where: { key } })
  if (existing) return duplicate

  const running = inFlightByKey.get(key)
  if (running) {
    // Outcome is re-derived from the table on the next pass, not from the
    // in-flight promise's value: success leaves a row (duplicate ack),
    // failure leaves nothing (fresh attempt).
    await running.catch(() => {})
    return runIdempotent(sessionToken, key, duplicate, apply)
  }

  const attempt = (async () => {
    try {
      const result = await apply()
      try {
        await prisma.relayIdempotencyKey.create({ data: { key, sessionToken } })
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
      }
      return result
    } finally {
      inFlightByKey.delete(key)
    }
  })()
  inFlightByKey.set(key, attempt)
  return attempt
}

/**
 * Same body shape `errorMiddleware.ts` puts on the wire for the LAN path, so
 * a relayed failure is indistinguishable from a direct one from the phone's
 * point of view. Anything that isn't an `AppError` is an internal detail and
 * is logged locally, never sent.
 */
function ackFromError(requestId: string, error: unknown): RelayAck {
  if (error instanceof AppError) {
    return { requestId, status: error.status, body: { code: error.code, message: error.message } }
  }
  console.error(error)
  return { requestId, status: 500, body: { code: ErrorCodes.INTERNAL_ERROR, message: 'Internal server error' } }
}

/**
 * Applies one relayed phone request in-process, using the exact service
 * functions LAN mode's Express routes call today (`signingApp.ts`), so
 * business logic never forks between the two connectivity modes.
 *
 * Never rejects: every failure (`AppError` from a service function on an
 * ordinary condition like a token that was already used, or anything
 * unexpected) becomes an error ack instead. The Durable Object only clears
 * its pending-request state when an ack arrives, so a thrown error that
 * produced no ack would make the phone wait out the full 10s DO timeout for
 * what the LAN path answers instantly — and, worse, would surface as an
 * unhandled rejection in a child process that has no `unhandledRejection`
 * handler, terminating the whole app.
 */
export async function dispatchRelayMessage(sessionToken: string, message: RelayMessage): Promise<RelayAck> {
  try {
    return await applyRelayMessage(sessionToken, message)
  } catch (error) {
    return ackFromError(message.requestId, error)
  }
}

async function applyRelayMessage(sessionToken: string, message: RelayMessage): Promise<RelayAck> {
  const { requestId, subPath, body } = message

  // The two state-changing subPaths are POST-only, exactly like their LAN
  // routes: the Worker forwards any method and synthesizes a body from query
  // params for GET, so without this gate a signature could be submitted by
  // merely fetching a URL — something link prefetchers and chat preview bots
  // do uninvited.
  if (subPath === 'sign/submit' && message.method === 'POST') {
    // Validated with the very same schema object signingApp.ts's LAN route
    // uses, before anything is claimed or written: under the relay this route
    // is internet-reachable, and an unvalidated `POST {}` here would reach
    // `submitSignature` with `signatureImage: undefined`, which Prisma reads
    // as "leave unchanged" — flipping the contract to signed with a null
    // signature and consuming the token.
    const parsed = submitSignatureSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid signature payload')
    }
    // The connection is deliberately NOT closed here. It used to be (a signing
    // token is single-use, so the session looked over), but `sign/status` is
    // relayed over this very socket: with the socket gone, the Worker gets
    // `shop_not_connected` and falls back to rendering the page as 'valid', so
    // a customer reopening an already-signed link got a working signature pad
    // again instead of the "already signed" copy. The connection now lives
    // until its token's own expiry (15 min, via the registry's expiryTimer),
    // exactly like a photo session's.
    return runIdempotent<RelayAck>(sessionToken, parsed.data.idempotencyKey, { requestId, status: 200, body: { status: 'ok' } }, async () => {
      await submitSignature(sessionToken, parsed.data.signatureImage)
      return { requestId, status: 200, body: { status: 'ok' } }
    })
  }

  if (subPath === 'photos/products' && message.method === 'GET') {
    // `listProductsForLocation` takes a locationId, not the phone's photo
    // token — signingApp.ts's own GET /product-photos/:token/products route
    // resolves the token to its ProductPhotoToken row first to get
    // `locationId` before calling it. `sessionToken` here is that same phone
    // token (RelaySession is keyed `getByName(token)` on it, and the Worker
    // never inspects it itself), so this mirrors that same resolution step
    // rather than passing the raw token through as if it were a locationId.
    const photoToken = await prisma.productPhotoToken.findUnique({ where: { token: sessionToken } })
    if (!photoToken || photoToken.expiresAt.getTime() < Date.now()) {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found or expired')
    }
    const payload = body as { search?: string } | undefined
    const products = await listProductsForLocation(photoToken.locationId, { search: payload?.search })
    return { requestId, status: 200, body: products }
  }

  if (subPath === 'photos/products' && message.method === 'POST') {
    // Task 3's phone-page template already sends idempotencyKey on this POST
    // (extending the same lost-ack-retry rationale to product creation), but
    // it is deliberately NOT checked here yet: a claim only records that a key
    // was seen, it doesn't cache the original response, so a "duplicate, skip"
    // branch here would return an empty/null body instead of the created
    // product — breaking the phone page's success handler (which reads
    // `product.name` immediately after this call) worse than the rare
    // double-create it would prevent. Left as forward-compatible dead weight:
    // the field arrives but is ignored until a response-caching mechanism is
    // worth building for this specific path.
    const parsed = productCreateSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
    }
    const product = await createProductFromPhotoToken(sessionToken, parsed.data)
    return { requestId, status: 201, body: product }
  }

  if (subPath === 'photos/submit' && message.method === 'POST') {
    const parsed = submitPhotosSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
    }
    return runIdempotent<RelayAck>(sessionToken, parsed.data.idempotencyKey, { requestId, status: 200, body: { status: 'ok' } }, async () => {
      const result = await submitPhotos(sessionToken, parsed.data.productId, parsed.data.photos)
      return { requestId, status: 200, body: result }
    })
  }

  // Non-mutating status checks the relay-served phone pages call before
  // rendering, so a phone that hits an expired/used/unknown token sees the
  // real message instead of a fully working page that only fails on submit
  // (parity with LAN's GET /sign/:token and /product-photos/:token routes,
  // which call these same functions before rendering).
  if (subPath === 'sign/status' && message.method === 'GET') {
    const status = await checkSigningTokenValidity(sessionToken)
    return { requestId, status: 200, body: { status } }
  }

  if (subPath === 'photos/status' && message.method === 'GET') {
    const status = await checkPhotoTokenValidity(sessionToken)
    return { requestId, status: 200, body: { status } }
  }

  throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Unrecognized relay path')
}

export interface RelayCredentials {
  url: string
  productKey: string
  installId: string
}

export interface RelayConnection {
  close(): void
  /**
   * Resolves `true` once a handshake succeeds, `false` if the first attempt
   * fails (wrong product key, revoked install, no internet at all) or nothing
   * has opened within `RELAY_CONNECT_TIMEOUT_MS`. Never rejects — a caller that
   * ignores it (boot-time resume) must not risk an unhandled rejection, and
   * reconnects continue in the background either way.
   */
  readonly opened: Promise<boolean>
}

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000

/**
 * How long a token-issuing route waits for the shop side to actually be
 * connected before telling the desktop there is no connection. Deliberately
 * much shorter than the DO's 10s per-request ack timeout: this is only the
 * initial handshake, and staff are watching a spinner.
 */
export const RELAY_CONNECT_TIMEOUT_MS = 4000

/**
 * Node's timers keep the event loop alive; a relay connection's own timers
 * must never be the reason the process stays up. Guarded because a test's fake
 * timer handle may not implement `unref`.
 */
function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
  const maybe = handle as unknown as { unref?: () => void }
  if (typeof maybe.unref === 'function') maybe.unref()
}

/**
 * Opens an authenticated outbound WebSocket to this session's RelaySession
 * instance and keeps it open, reconnecting with exponential backoff on any
 * drop, until `close()` is called (session claimed/expired) or the process
 * exits. Node's native `WebSocket` client (Node >=24, already this project's
 * floor) needs no extra dependency. Its constructor's second parameter
 * accepts a `headers` field per `undici-types`' `WebSocketInit` (bundled
 * with `@types/node`, verified against the installed v26.1.1 typings) — a
 * Node-specific extension over the browser WHATWG constructor, but a
 * supported, typed one here, so no query-string fallback is needed.
 *
 * Reconnect discipline (this is where a naive version melts down): a failed
 * connection attempt fires `error` AND THEN `close`, the Durable Object closes
 * the previous socket whenever a new one is accepted for the same session, and
 * a rate-limited connect (the Worker's limiter covers `/connect` too) looks
 * like just another failed attempt. So every socket gets its own listeners,
 * they are detached the moment that socket goes down or is superseded, and at
 * most ONE reconnect timer exists per connection at a time. Without all three,
 * one drop schedules two reconnects, each of which schedules two more.
 */
export function openRelayConnection(token: string, credentials: RelayCredentials): RelayConnection {
  let closed = false
  let socket: WebSocket | null = null
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let detachCurrentSocket: () => void = () => {}

  let resolveOpened: ((ok: boolean) => void) | null = null
  const opened = new Promise<boolean>((resolve) => {
    resolveOpened = resolve
  })

  function settleOpened(ok: boolean): void {
    if (!resolveOpened) return
    const resolve = resolveOpened
    resolveOpened = null
    clearTimeout(openTimer)
    resolve(ok)
  }

  const openTimer = setTimeout(() => settleOpened(false), RELAY_CONNECT_TIMEOUT_MS)
  unrefTimer(openTimer)

  function connect(): void {
    reconnectTimer = null
    if (closed) return
    const wsUrl = credentials.url.replace(/^http/, 'ws') + `/relay/${token}/connect`
    const ws = new WebSocket(wsUrl, {
      headers: {
        authorization: `Bearer ${credentials.productKey}`,
        'x-girovest-install': credentials.installId,
      },
    })
    socket = ws

    function onOpen(): void {
      attempt = 0
      settleOpened(true)
    }

    function onMessage(event: MessageEvent): void {
      void (async () => {
        let requestId: string | undefined
        try {
          const parsed = JSON.parse(event.data as string) as RelayMessage
          requestId = parsed.requestId
          const ack = await dispatchRelayMessage(token, parsed)
          ws.send(JSON.stringify(ack))
        } catch (error) {
          // `dispatchRelayMessage` maps every business failure to an ack, so
          // reaching here means the frame itself was unusable (malformed
          // JSON) or the socket died mid-send. Neither may escape as an
          // unhandled rejection: this runs in the spawned server child
          // process, which registers no `unhandledRejection` handler, so
          // Node's default would terminate it and Electron would show a
          // crash dialog over a single bad frame.
          console.error('Relay message handling failed:', error)
          if (requestId !== undefined) {
            try {
              ws.send(JSON.stringify(ackFromError(requestId, error)))
            } catch {
              // Socket already gone — the DO will time the request out.
            }
          }
        }
      })()
    }

    // One handler for both `error` and `close`, and it can only ever act once
    // per socket: a failed connection attempt fires both, and a socket the DO
    // has already superseded may fire either long after a newer one replaced
    // it here.
    function onDown(): void {
      if (socket !== ws) return
      detach()
      socket = null
      // Only meaningful for a connection that never opened in the first place;
      // a later drop finds `opened` already settled and reconnects silently.
      settleOpened(false)
      scheduleReconnect()
    }

    function detach(): void {
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('message', onMessage as (event: Event) => void)
      ws.removeEventListener('close', onDown)
      ws.removeEventListener('error', onDown)
    }

    detachCurrentSocket = detach
    ws.addEventListener('open', onOpen)
    ws.addEventListener('message', onMessage as (event: Event) => void)
    ws.addEventListener('close', onDown)
    ws.addEventListener('error', onDown)
  }

  function scheduleReconnect(): void {
    // Single-flight: `reconnectTimer` is the whole guard. It is cleared by
    // `connect()` itself, so a pending one always means "a reconnect is
    // already coming".
    if (closed || reconnectTimer) return
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS)
    attempt += 1
    reconnectTimer = setTimeout(connect, delay)
    unrefTimer(reconnectTimer)
  }

  connect()

  return {
    opened,
    close(): void {
      closed = true
      settleOpened(false)
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      const current = socket
      socket = null
      detachCurrentSocket()
      detachCurrentSocket = () => {}
      current?.close()
    },
  }
}
