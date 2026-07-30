import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openRelayConnection, RELAY_CONNECT_TIMEOUT_MS } from './relayClient.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

vi.mock('../services/signingService.js', () => ({
  submitSignature: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/productPhotoTokenService.js', () => ({
  submitPhotos: vi.fn().mockResolvedValue({ photos: ['/x.jpg'] }),
  createProductFromPhotoToken: vi.fn(),
}))
vi.mock('../services/productService.js', () => ({
  listProductsForLocation: vi.fn(),
}))
vi.mock('../db/client.js', () => ({
  prisma: {
    relayIdempotencyKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    productPhotoToken: { findUnique: vi.fn() },
  },
}))

/**
 * Minimal stand-in for Node's global WebSocket: records the listeners
 * `openRelayConnection` attaches (so a test can assert they were detached
 * again), lets a test fire events by hand, and never touches the network.
 */
class FakeSocket {
  static instances: FakeSocket[] = []

  readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  readonly sent: string[] = []
  closeCalls = 0

  constructor(
    readonly url: string,
    readonly init?: unknown,
  ) {
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(handler)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(handler)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls += 1
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }

  emit(type: string, event?: unknown): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event)
  }
}

const credentials = { url: 'https://relay.example', productKey: 'key', installId: 'install-1' }

/** Lets queued promise callbacks (the async message handler) run to completion. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('openRelayConnection message handling', () => {
  it('acks an AppError from a service function instead of rejecting', async () => {
    const { submitSignature } = await import('../services/signingService.js')
    ;(submitSignature as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AppError(ErrorCodes.SIGNING_TOKEN_INVALID, 410, 'Signing token already used'),
    )
    openRelayConnection('tok-a', credentials)
    const socket = FakeSocket.instances[0]

    socket.emit('message', {
      data: JSON.stringify({
        requestId: 'r1',
        subPath: 'sign/submit',
        method: 'POST',
        body: { signatureImage: 'data:image/png;base64,AAA=' },
      }),
    })
    await flushMicrotasks()

    expect(JSON.parse(socket.sent[0])).toEqual({
      requestId: 'r1',
      status: 410,
      body: { code: 'SIGNING_TOKEN_INVALID', message: 'Signing token already used' },
    })
  })

  it('acks a 500 when a service function throws a plain Error', async () => {
    const { submitPhotos } = await import('../services/productPhotoTokenService.js')
    ;(submitPhotos as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db exploded'))
    openRelayConnection('tok-b', credentials)
    const socket = FakeSocket.instances[0]

    socket.emit('message', {
      data: JSON.stringify({
        requestId: 'r2',
        subPath: 'photos/submit',
        method: 'POST',
        body: { productId: 'p1', photos: ['data:image/jpeg;base64,AAA='] },
      }),
    })
    await flushMicrotasks()

    expect(JSON.parse(socket.sent[0])).toEqual({
      requestId: 'r2',
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })

  it('sends the ack on the socket the message arrived on', async () => {
    openRelayConnection('tok-d', credentials)
    const socket = FakeSocket.instances[0]

    socket.emit('message', {
      data: JSON.stringify({
        requestId: 'r3',
        subPath: 'sign/submit',
        method: 'POST',
        body: { signatureImage: 'data:image/png;base64,AAA=' },
      }),
    })
    await flushMicrotasks()

    expect(JSON.parse(socket.sent[0])).toEqual({ requestId: 'r3', status: 200, body: { status: 'ok' } })
  })

  it('handles a malformed JSON frame without throwing and without acking', async () => {
    openRelayConnection('tok-c', credentials)
    const socket = FakeSocket.instances[0]

    expect(() => socket.emit('message', { data: '{not json' })).not.toThrow()
    await flushMicrotasks()

    expect(socket.sent).toEqual([])
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('openRelayConnection reconnect behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('schedules exactly one reconnect for a failed attempt that fires error and then close', () => {
    openRelayConnection('tok-r1', credentials)
    const first = FakeSocket.instances[0]

    // Per the WebSocket spec a failed connection attempt fires `error` and
    // THEN `close` — the two together used to schedule two reconnects.
    first.emit('error')
    first.emit('close')
    vi.advanceTimersByTime(60_000)

    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('detaches the old socket, so events from a superseded socket schedule nothing', () => {
    openRelayConnection('tok-r2', credentials)
    const first = FakeSocket.instances[0]

    first.emit('close')
    expect(first.listenerCount('close')).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(2)

    // The DO closes the previous socket whenever a new one connects for the
    // same session, so a stale `close` on socket #1 arrives routinely.
    first.emit('error')
    first.emit('close')
    vi.advanceTimersByTime(60_000)

    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('keeps one reconnect per failure across several consecutive failures', () => {
    openRelayConnection('tok-r3', credentials)

    for (let i = 0; i < 4; i += 1) {
      const current = FakeSocket.instances[FakeSocket.instances.length - 1]
      current.emit('error')
      current.emit('close')
      vi.advanceTimersByTime(60_000)
      expect(FakeSocket.instances).toHaveLength(i + 2)
    }
  })

  it('backs off exponentially rather than retrying immediately (a 429 on /connect is just another failure)', () => {
    openRelayConnection('tok-r4', credentials)

    FakeSocket.instances[0].emit('close')
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2)

    FakeSocket.instances[1].emit('close')
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('closes the current socket and stops reconnecting once close() is called', () => {
    const connection = openRelayConnection('tok-r5', credentials)
    FakeSocket.instances[0].emit('close')
    vi.advanceTimersByTime(60_000)
    const current = FakeSocket.instances[1]

    connection.close()

    expect(current.closeCalls).toBe(1)
    expect(current.listenerCount('close')).toBe(0)
    current.emit('close')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('cancels a pending reconnect when close() is called before it fires', () => {
    const connection = openRelayConnection('tok-r6', credentials)
    FakeSocket.instances[0].emit('close')

    connection.close()
    vi.advanceTimersByTime(60_000)

    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('resets the backoff after a successful open', () => {
    openRelayConnection('tok-r7', credentials)
    FakeSocket.instances[0].emit('close')
    vi.advanceTimersByTime(1000)
    FakeSocket.instances[1].emit('open')

    FakeSocket.instances[1].emit('close')
    vi.advanceTimersByTime(1000)

    expect(FakeSocket.instances).toHaveLength(3)
  })
})

describe('openRelayConnection handshake reporting', () => {
  it('resolves opened=true once the socket opens', async () => {
    const connection = openRelayConnection('tok-o1', credentials)

    FakeSocket.instances[0].emit('open')

    await expect(connection.opened).resolves.toBe(true)
  })

  it('resolves opened=false when the first attempt fails, without rejecting', async () => {
    const connection = openRelayConnection('tok-o2', credentials)

    FakeSocket.instances[0].emit('error')
    FakeSocket.instances[0].emit('close')

    await expect(connection.opened).resolves.toBe(false)
  })

  it('resolves opened=false when nothing happens within the handshake timeout', async () => {
    vi.useFakeTimers()
    const connection = openRelayConnection('tok-o3', credentials)

    await vi.advanceTimersByTimeAsync(RELAY_CONNECT_TIMEOUT_MS)

    await expect(connection.opened).resolves.toBe(false)
  })

  it('resolves opened=false when close() happens before the handshake', async () => {
    const connection = openRelayConnection('tok-o4', credentials)

    connection.close()

    await expect(connection.opened).resolves.toBe(false)
  })

  it('keeps opened=true after a later drop (reconnects are silent)', async () => {
    const connection = openRelayConnection('tok-o5', credentials)
    FakeSocket.instances[0].emit('open')

    FakeSocket.instances[0].emit('close')

    await expect(connection.opened).resolves.toBe(true)
  })
})
