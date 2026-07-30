import { describe, expect, it, vi, beforeEach } from 'vitest'
import { dispatchRelayMessage } from './relayClient.js'
import { closeAllRelayConnections, openRelayConnectionCount, registerRelayConnection } from './relayRegistry.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

vi.mock('../services/signingService.js', () => ({
  submitSignature: vi.fn().mockResolvedValue(undefined),
  checkTokenValidity: vi.fn(),
}))
vi.mock('../services/productPhotoTokenService.js', () => ({
  submitPhotos: vi.fn().mockResolvedValue({ photos: ['/x.jpg'] }),
  createProductFromPhotoToken: vi.fn(),
  checkTokenValidity: vi.fn(),
}))
vi.mock('../services/productService.js', () => ({
  listProductsForLocation: vi.fn(),
}))
// Stateful stand-in for the RelayIdempotencyKey table: `create` enforces the
// unique index and `findUnique` sees prior writes, so the duplicate-detection
// tests exercise the real check-and-record semantics instead of a mock that
// forgets every row.
const idempotencyRows = vi.hoisted(() => new Map<string, { key: string; sessionToken: string }>())
vi.mock('../db/client.js', () => ({
  prisma: {
    relayIdempotencyKey: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => idempotencyRows.get(where.key) ?? null),
      create: vi.fn(async ({ data }: { data: { key: string; sessionToken: string } }) => {
        if (idempotencyRows.has(data.key)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        }
        idempotencyRows.set(data.key, data)
        return data
      }),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
        idempotencyRows.delete(where.key)
      }),
    },
    productPhotoToken: { findUnique: vi.fn() },
  },
}))

describe('dispatchRelayMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idempotencyRows.clear()
  })

  it('calls submitSignature for a sign/submit relay message and acks 200', async () => {
    const { submitSignature } = await import('../services/signingService.js')
    const result = await dispatchRelayMessage('tok-1', {
      requestId: 'req-1',
      subPath: 'sign/submit',
      method: 'POST',
      body: { signatureImage: 'data:image/png;base64,AAA=' },
    })
    expect(submitSignature).toHaveBeenCalledWith('tok-1', 'data:image/png;base64,AAA=')
    expect(result).toEqual({ requestId: 'req-1', status: 200, body: { status: 'ok' } })
  })

  it('skips a duplicate idempotency key for sign/submit without re-calling submitSignature', async () => {
    const { prisma } = await import('../db/client.js')
    const { submitSignature } = await import('../services/signingService.js')
    ;(prisma.relayIdempotencyKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: '1' })
    const result = await dispatchRelayMessage('tok-1b', {
      requestId: 'req-1b',
      subPath: 'sign/submit',
      method: 'POST',
      body: { signatureImage: 'data:image/png;base64,AAA=', idempotencyKey: 'dup-sig-1' },
    })
    expect(submitSignature).not.toHaveBeenCalled()
    expect(result).toEqual({ requestId: 'req-1b', status: 200, body: { status: 'ok' } })
  })

  it('calls submitPhotos for a photos/submit relay message and acks 200 with the result', async () => {
    const result = await dispatchRelayMessage('tok-2', {
      requestId: 'req-2',
      subPath: 'photos/submit',
      method: 'POST',
      body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='] },
    })
    expect(result).toEqual({ requestId: 'req-2', status: 200, body: { photos: ['/x.jpg'] } })
  })

  it('skips a duplicate idempotency key without re-calling the service function', async () => {
    const { prisma } = await import('../db/client.js')
    const { submitPhotos } = await import('../services/productPhotoTokenService.js')
    ;(prisma.relayIdempotencyKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: '1' })
    const result = await dispatchRelayMessage('tok-3', {
      requestId: 'req-3',
      subPath: 'photos/submit',
      method: 'POST',
      body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='], idempotencyKey: 'dup-1' },
    })
    expect(submitPhotos).not.toHaveBeenCalled()
    expect(result.status).toBe(200)
  })

  it('resolves the token to a locationId and calls listProductsForLocation for a photos/products GET', async () => {
    const { prisma } = await import('../db/client.js')
    const { listProductsForLocation } = await import('../services/productService.js')
    ;(prisma.productPhotoToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: 'tok-5',
      locationId: 'loc-1',
      expiresAt: new Date(Date.now() + 60_000),
    })
    ;(listProductsForLocation as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'p1', name: 'Dress' }])

    const result = await dispatchRelayMessage('tok-5', {
      requestId: 'req-5',
      subPath: 'photos/products',
      method: 'GET',
      body: { search: 'red' },
    })

    expect(prisma.productPhotoToken.findUnique).toHaveBeenCalledWith({ where: { token: 'tok-5' } })
    expect(listProductsForLocation).toHaveBeenCalledWith('loc-1', { search: 'red' })
    expect(result).toEqual({ requestId: 'req-5', status: 200, body: [{ id: 'p1', name: 'Dress' }] })
  })

  it('returns 404 for a photos/products GET when the token is missing or expired', async () => {
    const { prisma } = await import('../db/client.js')
    const { listProductsForLocation } = await import('../services/productService.js')
    ;(prisma.productPhotoToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await dispatchRelayMessage('tok-6', {
      requestId: 'req-6',
      subPath: 'photos/products',
      method: 'GET',
      body: {},
    })

    expect(listProductsForLocation).not.toHaveBeenCalled()
    expect(result).toEqual({
      requestId: 'req-6',
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Photo token not found or expired' },
    })
  })

  it('returns 404 for a photos/products GET when the token is found but expired', async () => {
    const { prisma } = await import('../db/client.js')
    const { listProductsForLocation } = await import('../services/productService.js')
    ;(prisma.productPhotoToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: 'tok-7',
      locationId: 'loc-1',
      expiresAt: new Date(Date.now() - 60_000),
    })

    const result = await dispatchRelayMessage('tok-7', {
      requestId: 'req-7',
      subPath: 'photos/products',
      method: 'GET',
      body: {},
    })

    expect(listProductsForLocation).not.toHaveBeenCalled()
    expect(result).toEqual({
      requestId: 'req-7',
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Photo token not found or expired' },
    })
  })

  it('answers sign/status with the real signing token status', async () => {
    const { checkTokenValidity } = await import('../services/signingService.js')
    ;(checkTokenValidity as ReturnType<typeof vi.fn>).mockResolvedValueOnce('expired')
    const result = await dispatchRelayMessage('tok-status-1', {
      requestId: 'req-s1',
      subPath: 'sign/status',
      method: 'GET',
      body: {},
    })
    expect(checkTokenValidity).toHaveBeenCalledWith('tok-status-1')
    expect(result).toEqual({ requestId: 'req-s1', status: 200, body: { status: 'expired' } })
  })

  it('answers photos/status with the real photo token status', async () => {
    const { checkTokenValidity } = await import('../services/productPhotoTokenService.js')
    ;(checkTokenValidity as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not_found')
    const result = await dispatchRelayMessage('tok-status-2', {
      requestId: 'req-s2',
      subPath: 'photos/status',
      method: 'GET',
      body: {},
    })
    expect(checkTokenValidity).toHaveBeenCalledWith('tok-status-2')
    expect(result).toEqual({ requestId: 'req-s2', status: 200, body: { status: 'not_found' } })
  })

  it('returns 400 for an unrecognized subPath', async () => {
    const result = await dispatchRelayMessage('tok-4', {
      requestId: 'req-4',
      subPath: 'nonsense',
      method: 'POST',
      body: {},
    })
    expect(result.status).toBe(400)
  })

  // Every service function throws AppError on ordinary conditions (a signing
  // token that was already used, an expired photo token, an invalid photo).
  // Those must come back as acks, not rejections: an unhandled rejection in
  // this child process terminates the whole app, and a missing ack makes the
  // phone wait out the DO's full 10s timeout.
  it('maps an AppError thrown by a service function to an error ack with its status and code', async () => {
    const { submitSignature } = await import('../services/signingService.js')
    ;(submitSignature as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AppError(ErrorCodes.SIGNING_TOKEN_INVALID, 410, 'Signing token already used'),
    )

    const result = await dispatchRelayMessage('tok-8', {
      requestId: 'req-8',
      subPath: 'sign/submit',
      method: 'POST',
      body: { signatureImage: 'data:image/png;base64,AAA=' },
    })

    expect(result).toEqual({
      requestId: 'req-8',
      status: 410,
      body: { code: 'SIGNING_TOKEN_INVALID', message: 'Signing token already used' },
    })
  })

  it('maps a non-AppError thrown by a service function to a generic 500 ack that leaks nothing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { submitPhotos } = await import('../services/productPhotoTokenService.js')
    ;(submitPhotos as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('connect ECONNREFUSED /tmp/db.sock'))

    const result = await dispatchRelayMessage('tok-9', {
      requestId: 'req-9',
      subPath: 'photos/submit',
      method: 'POST',
      body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='] },
    })

    expect(result).toEqual({
      requestId: 'req-9',
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED')
    consoleError.mockRestore()
  })

  // The phone reuses one idempotency key per logical payload, so a claim that
  // exists for a write that never happened would turn the user's retry into a
  // fake `200 ok` with nothing written. The key must therefore only ever be
  // recorded AFTER the write completes.
  it('records no idempotency key when the service call fails, so a retry is a real retry', async () => {
    const { prisma } = await import('../db/client.js')
    const { submitSignature } = await import('../services/signingService.js')
    ;(submitSignature as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AppError(ErrorCodes.INTERNAL_ERROR, 500, 'boom'),
    )

    await dispatchRelayMessage('tok-10', {
      requestId: 'req-10',
      subPath: 'sign/submit',
      method: 'POST',
      body: { signatureImage: 'data:image/png;base64,AAA=', idempotencyKey: 'retry-me' },
    })

    expect(prisma.relayIdempotencyKey.create).not.toHaveBeenCalled()
  })

  it('records the idempotency key only after the write completes, never before', async () => {
    const { prisma } = await import('../db/client.js')
    const { submitPhotos } = await import('../services/productPhotoTokenService.js')
    let finishWrite!: (value: { photos: string[] }) => void
    ;(submitPhotos as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<{ photos: string[] }>((resolve) => (finishWrite = resolve)),
    )

    const dispatch = dispatchRelayMessage('tok-12', {
      requestId: 'req-12',
      subPath: 'photos/submit',
      method: 'POST',
      body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='], idempotencyKey: 'after-only' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The write is still in flight: a crash right now must leave no claim
    // behind, or the phone's retry would fake-succeed with nothing written.
    expect(prisma.relayIdempotencyKey.create).not.toHaveBeenCalled()

    finishWrite({ photos: ['/x.jpg'] })
    const result = await dispatch
    expect(result.status).toBe(200)
    expect(prisma.relayIdempotencyKey.create).toHaveBeenCalledWith({
      data: { key: 'after-only', sessionToken: 'tok-12' },
    })
  })

  it('holds a concurrent duplicate until the first attempt succeeds, then acks it without re-writing', async () => {
    const { submitPhotos } = await import('../services/productPhotoTokenService.js')
    let finishWrite!: (value: { photos: string[] }) => void
    ;(submitPhotos as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<{ photos: string[] }>((resolve) => (finishWrite = resolve)),
    )
    const body = { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='], idempotencyKey: 'in-flight-1' }

    const first = dispatchRelayMessage('tok-13', { requestId: 'req-13a', subPath: 'photos/submit', method: 'POST', body })
    await new Promise((resolve) => setTimeout(resolve, 0))
    let duplicateSettled = false
    const second = dispatchRelayMessage('tok-13', { requestId: 'req-13b', subPath: 'photos/submit', method: 'POST', body }).then(
      (ack) => {
        duplicateSettled = true
        return ack
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The duplicate must not be acked success while the only real attempt is
    // still writing — that ack would be a promise nobody has kept yet.
    expect(duplicateSettled).toBe(false)

    finishWrite({ photos: ['/x.jpg'] })
    const [firstAck, secondAck] = await Promise.all([first, second])
    expect(firstAck.status).toBe(200)
    expect(secondAck.status).toBe(200)
    expect(submitPhotos).toHaveBeenCalledTimes(1)
  })

  it('lets a concurrent duplicate become a real retry when the first attempt fails', async () => {
    const { submitPhotos } = await import('../services/productPhotoTokenService.js')
    let failWrite!: (error: Error) => void
    ;(submitPhotos as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<{ photos: string[] }>((_resolve, reject) => (failWrite = reject)),
    )
    const body = { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='], idempotencyKey: 'in-flight-2' }

    const first = dispatchRelayMessage('tok-14', { requestId: 'req-14a', subPath: 'photos/submit', method: 'POST', body })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = dispatchRelayMessage('tok-14', { requestId: 'req-14b', subPath: 'photos/submit', method: 'POST', body })
    await new Promise((resolve) => setTimeout(resolve, 0))

    failWrite(new AppError(ErrorCodes.INTERNAL_ERROR, 500, 'boom'))
    const [firstAck, secondAck] = await Promise.all([first, second])
    expect(firstAck.status).toBe(500)
    // The second delivery re-runs the write (the default mock succeeds), so
    // the retry the phone already sent does the work instead of inheriting
    // the first attempt's failure.
    expect(secondAck.status).toBe(200)
    expect(submitPhotos).toHaveBeenCalledTimes(2)
  })

  it('treats a unique-constraint violation on recording the key as already-recorded, not an error', async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.relayIdempotencyKey.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    )

    const result = await dispatchRelayMessage('tok-15', {
      requestId: 'req-15',
      subPath: 'photos/submit',
      method: 'POST',
      body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='], idempotencyKey: 'raced' },
    })

    expect(result.status).toBe(200)
  })

  // LAN only ever exposes these as POST routes; the Worker forwards any
  // method and synthesizes a body from query params for GET, so without this
  // gate a signature could be submitted by a URL — which link prefetchers and
  // chat preview bots will happily follow.
  describe('method gating on state-changing subPaths', () => {
    it('rejects a GET sign/submit without calling submitSignature', async () => {
      const { submitSignature } = await import('../services/signingService.js')
      const { prisma } = await import('../db/client.js')

      const result = await dispatchRelayMessage('tok-m1', {
        requestId: 'req-m1',
        subPath: 'sign/submit',
        method: 'GET',
        body: { signatureImage: 'data:image/png;base64,AAA=', idempotencyKey: 'via-url' },
      })

      expect(submitSignature).not.toHaveBeenCalled()
      expect(prisma.relayIdempotencyKey.create).not.toHaveBeenCalled()
      expect(result.status).toBe(400)
    })

    it('rejects a GET photos/submit without calling submitPhotos', async () => {
      const { submitPhotos } = await import('../services/productPhotoTokenService.js')

      const result = await dispatchRelayMessage('tok-m2', {
        requestId: 'req-m2',
        subPath: 'photos/submit',
        method: 'GET',
        body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='] },
      })

      expect(submitPhotos).not.toHaveBeenCalled()
      expect(result.status).toBe(400)
    })
  })

  // Under the relay these three routes are internet-reachable for the token's
  // whole TTL, so they must apply the exact schemas signingApp.ts applies on
  // the LAN path — not a subset, and never nothing.
  describe('payload validation, shared with the LAN path', () => {
    it('rejects a sign/submit body with no signatureImage without calling submitSignature', async () => {
      const { submitSignature } = await import('../services/signingService.js')

      const result = await dispatchRelayMessage('tok-v1', {
        requestId: 'req-v1',
        subPath: 'sign/submit',
        method: 'POST',
        body: {},
      })

      expect(submitSignature).not.toHaveBeenCalled()
      expect(result).toEqual({
        requestId: 'req-v1',
        status: 400,
        body: { code: 'VALIDATION_ERROR', message: 'Invalid signature payload' },
      })
    })

    it('rejects a non-PNG signature data URL (e.g. an SVG carrying a script)', async () => {
      const { submitSignature } = await import('../services/signingService.js')

      const result = await dispatchRelayMessage('tok-v2', {
        requestId: 'req-v2',
        subPath: 'sign/submit',
        method: 'POST',
        body: { signatureImage: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=' },
      })

      expect(submitSignature).not.toHaveBeenCalled()
      expect(result.status).toBe(400)
    })

    it('rejects a photos/products POST with a malformed product payload without creating anything', async () => {
      const { createProductFromPhotoToken } = await import('../services/productPhotoTokenService.js')

      const result = await dispatchRelayMessage('tok-v3', {
        requestId: 'req-v3',
        subPath: 'photos/products',
        method: 'POST',
        body: { name: '', rentalPrice: -5 },
      })

      expect(createProductFromPhotoToken).not.toHaveBeenCalled()
      expect(result).toEqual({
        requestId: 'req-v3',
        status: 400,
        body: { code: 'VALIDATION_ERROR', message: 'Invalid product payload' },
      })
    })

    it('rejects a photos/submit body with an empty photos array without calling submitPhotos', async () => {
      const { submitPhotos } = await import('../services/productPhotoTokenService.js')

      const result = await dispatchRelayMessage('tok-v4', {
        requestId: 'req-v4',
        subPath: 'photos/submit',
        method: 'POST',
        body: { productId: 'p1', photos: [] },
      })

      expect(submitPhotos).not.toHaveBeenCalled()
      expect(result).toEqual({
        requestId: 'req-v4',
        status: 400,
        body: { code: 'VALIDATION_ERROR', message: 'Invalid photo payload' },
      })
    })

    it('rejects a photos/submit body with a single photo over the per-photo size cap', async () => {
      const { submitPhotos } = await import('../services/productPhotoTokenService.js')

      const result = await dispatchRelayMessage('tok-v8', {
        requestId: 'req-v8',
        subPath: 'photos/submit',
        method: 'POST',
        body: { productId: 'p1', photos: ['data:image/jpeg;base64,' + 'A'.repeat(2_000_001)] },
      })

      expect(submitPhotos).not.toHaveBeenCalled()
      expect(result.status).toBe(400)
    })

    it('rejects an idempotencyKey longer than any client-minted UUID could be', async () => {
      const { submitPhotos } = await import('../services/productPhotoTokenService.js')

      const result = await dispatchRelayMessage('tok-v9', {
        requestId: 'req-v9',
        subPath: 'photos/submit',
        method: 'POST',
        body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='], idempotencyKey: 'k'.repeat(200) },
      })

      expect(submitPhotos).not.toHaveBeenCalled()
      expect(result.status).toBe(400)
    })

    it('rejects a photos/submit body with more than ten photos', async () => {
      const { submitPhotos } = await import('../services/productPhotoTokenService.js')

      const result = await dispatchRelayMessage('tok-v5', {
        requestId: 'req-v5',
        subPath: 'photos/submit',
        method: 'POST',
        body: { productId: 'p1', photos: Array.from({ length: 11 }, () => 'data:image/jpeg;base64,AAA=') },
      })

      expect(submitPhotos).not.toHaveBeenCalled()
      expect(result.status).toBe(400)
    })

    it('does not claim an idempotency key for a payload it rejects', async () => {
      const { prisma } = await import('../db/client.js')

      await dispatchRelayMessage('tok-v6', {
        requestId: 'req-v6',
        subPath: 'sign/submit',
        method: 'POST',
        body: { idempotencyKey: 'never-claimed' },
      })

      expect(prisma.relayIdempotencyKey.create).not.toHaveBeenCalled()
    })

    it('still passes a valid product payload through to createProductFromPhotoToken', async () => {
      const { createProductFromPhotoToken } = await import('../services/productPhotoTokenService.js')
      ;(createProductFromPhotoToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'p9', name: 'Vestido' })
      const validProduct = {
        name: 'Vestido',
        category: 'Festa',
        size: 'M',
        color: 'Azul',
        rentalPrice: 250,
        depositAmount: 100,
      }

      const result = await dispatchRelayMessage('tok-v7', {
        requestId: 'req-v7',
        subPath: 'photos/products',
        method: 'POST',
        body: { ...validProduct, idempotencyKey: 'ignored-here' },
      })

      expect(createProductFromPhotoToken).toHaveBeenCalledWith('tok-v7', validProduct)
      expect(result).toEqual({ requestId: 'req-v7', status: 201, body: { id: 'p9', name: 'Vestido' } })
    })
  })

  // Used to close the connection right after a successful submit. It must not:
  // the phone pages' `sign/status` check is relayed over this same socket, so
  // a closed connection makes the Worker fall back to rendering an
  // already-signed link as a live signature pad. The registry's own expiry
  // timer (the token's 15 min) is what ends it now.
  it('leaves the relay connection open after a signature is submitted', async () => {
    const connection = { close: vi.fn(), opened: Promise.resolve(true) }
    registerRelayConnection('tok-close', connection, new Date(Date.now() + 15 * 60 * 1000))

    const result = await dispatchRelayMessage('tok-close', {
      requestId: 'req-close',
      subPath: 'sign/submit',
      method: 'POST',
      body: { signatureImage: 'data:image/png;base64,AAA=' },
    })
    // A macrotask is exactly how long the old eager close waited, so this is
    // the window in which the removed behavior would show up.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.status).toBe(200)
    expect(connection.close).not.toHaveBeenCalled()
    expect(openRelayConnectionCount()).toBe(1)
    closeAllRelayConnections()
  })

  // The two halves of the case the removal was for. In production the Worker
  // relays `sign/status` over the very socket the submit arrived on, so the
  // connection surviving (asserted here) is the precondition; dispatch itself
  // is in-process and would answer either way, so the count assertion is what
  // actually distinguishes the fixed behavior from the old one.
  it('still reports a spent token as used, with its connection surviving the submit', async () => {
    const { checkTokenValidity } = await import('../services/signingService.js')
    const connection = { close: vi.fn(), opened: Promise.resolve(true) }
    registerRelayConnection('tok-status-after-sign', connection, new Date(Date.now() + 15 * 60 * 1000))

    await dispatchRelayMessage('tok-status-after-sign', {
      requestId: 'req-sign',
      subPath: 'sign/submit',
      method: 'POST',
      body: { signatureImage: 'data:image/png;base64,AAA=' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(openRelayConnectionCount()).toBe(1)

    // A reopened link: the token is now spent, and the phone page must be told
    // so instead of getting the default 'valid' fallback.
    ;(checkTokenValidity as ReturnType<typeof vi.fn>).mockResolvedValueOnce('used')
    const status = await dispatchRelayMessage('tok-status-after-sign', {
      requestId: 'req-status',
      subPath: 'sign/status',
      method: 'GET',
      body: {},
    })

    expect(status).toEqual({ requestId: 'req-status', status: 200, body: { status: 'used' } })
    closeAllRelayConnections()
  })

  it('leaves the relay connection open for a photo submission (the session is reusable for 12h)', async () => {
    const connection = { close: vi.fn(), opened: Promise.resolve(true) }
    registerRelayConnection('tok-keep-open', connection, new Date(Date.now() + 12 * 60 * 60 * 1000))

    await dispatchRelayMessage('tok-keep-open', {
      requestId: 'req-keep-open',
      subPath: 'photos/submit',
      method: 'POST',
      body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(connection.close).not.toHaveBeenCalled()
    expect(openRelayConnectionCount()).toBe(1)
    closeAllRelayConnections()
  })

  it('keeps the idempotency claim when the service call succeeds', async () => {
    const { prisma } = await import('../db/client.js')

    await dispatchRelayMessage('tok-11', {
      requestId: 'req-11',
      subPath: 'sign/submit',
      method: 'POST',
      body: { signatureImage: 'data:image/png;base64,AAA=', idempotencyKey: 'keep-me' },
    })

    expect(prisma.relayIdempotencyKey.create).toHaveBeenCalledWith({
      data: { key: 'keep-me', sessionToken: 'tok-11' },
    })
    expect(prisma.relayIdempotencyKey.deleteMany).not.toHaveBeenCalled()
  })
})
