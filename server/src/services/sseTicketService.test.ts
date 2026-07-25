import { describe, it, expect, vi, afterEach } from 'vitest'
import { mintSseTicket, checkSseTicket } from './sseTicketService.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sseTicketService', () => {
  it('mints a ticket that checks out to the same staff and location', () => {
    const { ticket, expiresAt } = mintSseTicket('staff-1', 'location-1')
    expect(ticket).toHaveLength(43) // base64url(32 random bytes)
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(checkSseTicket(ticket)).toEqual({ staffId: 'staff-1', locationId: 'location-1' })
  })

  it('is not single-use — checking twice within the TTL both succeed', () => {
    const { ticket } = mintSseTicket('staff-1', 'location-1')
    expect(checkSseTicket(ticket)).not.toBeNull()
    expect(checkSseTicket(ticket)).not.toBeNull()
  })

  it('returns null for an unknown ticket', () => {
    expect(checkSseTicket('not-a-real-ticket')).toBeNull()
  })

  it('returns null once the ticket has expired', () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000_000)
    const { ticket } = mintSseTicket('staff-1', 'location-1')
    nowSpy.mockReturnValue(1_000_000 + 6 * 60 * 1000) // 6 minutes later, TTL is 5
    expect(checkSseTicket(ticket)).toBeNull()
  })
})
