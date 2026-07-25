import crypto from 'crypto'

const TICKET_TTL_MS = 5 * 60 * 1000

interface TicketRecord {
  staffId: string
  locationId: string
  expiresAt: number
}

const tickets = new Map<string, TicketRecord>()

export function mintSseTicket(staffId: string, locationId: string): { ticket: string; expiresAt: number } {
  const ticket = crypto.randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + TICKET_TTL_MS
  tickets.set(ticket, { staffId, locationId, expiresAt })
  return { ticket, expiresAt }
}

// Not single-use by design: EventSource's native reconnect re-requests the
// exact same URL, so a true single-use ticket would break the first
// automatic reconnect after any network blip. The client instead rotates
// to a fresh ticket shortly before this TTL expires. In-memory only (no
// DB table) — staff count here is small and a server restart already
// drops every open SSE connection anyway, so there's nothing to recover.
export function checkSseTicket(ticket: string): { staffId: string; locationId: string } | null {
  const record = tickets.get(ticket)
  if (!record) return null
  if (record.expiresAt < Date.now()) {
    tickets.delete(ticket)
    return null
  }
  return { staffId: record.staffId, locationId: record.locationId }
}
