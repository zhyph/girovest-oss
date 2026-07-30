import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeAllRelayConnections,
  closeRelayConnection,
  openRelayConnectionCount,
  registerRelayConnection,
} from './relayRegistry.js'

function fakeConnection() {
  return { close: vi.fn(), opened: Promise.resolve(true) }
}

const IN_FIFTEEN_MINUTES = () => new Date(Date.now() + 15 * 60 * 1000)
const IN_TWELVE_HOURS = () => new Date(Date.now() + 12 * 60 * 60 * 1000)

beforeEach(() => {
  vi.useFakeTimers()
  closeAllRelayConnections()
})

afterEach(() => {
  closeAllRelayConnections()
  vi.useRealTimers()
})

describe('relay connection registry', () => {
  it('closes a signing connection at its 15-minute expiry', () => {
    const connection = fakeConnection()
    registerRelayConnection('sign-token', connection, IN_FIFTEEN_MINUTES())

    vi.advanceTimersByTime(15 * 60 * 1000 - 1)
    expect(connection.close).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(openRelayConnectionCount()).toBe(0)
  })

  it('closes a 12-hour photo-session connection at its expiry', () => {
    const connection = fakeConnection()
    registerRelayConnection('photo-token', connection, IN_TWELVE_HOURS())

    vi.advanceTimersByTime(12 * 60 * 60 * 1000)

    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(openRelayConnectionCount()).toBe(0)
  })

  it('closes an already-expired connection immediately rather than never', () => {
    const connection = fakeConnection()
    registerRelayConnection('stale-token', connection, new Date(Date.now() - 1000))

    vi.advanceTimersByTime(0)

    expect(connection.close).toHaveBeenCalledTimes(1)
  })

  it('closes and deregisters on demand, and cancels the expiry timer', () => {
    const connection = fakeConnection()
    registerRelayConnection('tok', connection, IN_TWELVE_HOURS())

    closeRelayConnection('tok')
    vi.advanceTimersByTime(12 * 60 * 60 * 1000)

    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(openRelayConnectionCount()).toBe(0)
  })

  it('is a no-op for an unknown token', () => {
    expect(() => closeRelayConnection('never-registered')).not.toThrow()
  })

  // The eager post-signature close (`closeRelayConnectionAfterAck`) is gone:
  // the phone pages' relayed `sign/status` check needs this socket to outlive
  // the submit. Expiry is now the only thing that ends a signing connection on
  // its own, so a signed session's connection must still be open right up to
  // the token's own expiry.
  it('keeps a signing connection open until its expiry regardless of any submission', () => {
    const connection = fakeConnection()
    registerRelayConnection('sign-token', connection, IN_FIFTEEN_MINUTES())

    vi.advanceTimersByTime(15 * 60 * 1000 - 1)
    expect(connection.close).not.toHaveBeenCalled()
    expect(openRelayConnectionCount()).toBe(1)

    vi.advanceTimersByTime(1)
    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(openRelayConnectionCount()).toBe(0)
  })

  it('closes the previous connection when the same token is registered again', () => {
    const first = fakeConnection()
    const second = fakeConnection()

    registerRelayConnection('tok', first, IN_TWELVE_HOURS())
    registerRelayConnection('tok', second, IN_TWELVE_HOURS())

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).not.toHaveBeenCalled()
    expect(openRelayConnectionCount()).toBe(1)
  })

  it('closes every open connection at shutdown', () => {
    const a = fakeConnection()
    const b = fakeConnection()
    registerRelayConnection('a', a, IN_TWELVE_HOURS())
    registerRelayConnection('b', b, IN_TWELVE_HOURS())

    closeAllRelayConnections()

    expect(a.close).toHaveBeenCalledTimes(1)
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(openRelayConnectionCount()).toBe(0)
  })
})
