import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyPasswordResetTicket } from './passwordResetTickets.js'

const INSTALL = 'b2a4f6c8-1111-4222-8333-444455556666'
const OTHER_INSTALL = 'c3b5f7d9-2222-4333-9444-555566667777'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PUBLIC_SPKI = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Reproduces what the Worker's mintPasswordResetToken does. */
function mint(
  installId: string,
  login: string,
  purpose = 'password_reset',
  issuedAt = new Date().toISOString(),
  key = privateKey,
): string {
  const canonical = JSON.stringify({ installId, login, purpose, issuedAt })
  const data = Buffer.from(canonical, 'utf-8')
  const signature = sign(null, data, key)
  return `${b64url(data)}.${b64url(signature)}`
}

describe('verifyPasswordResetTicket', () => {
  it('accepts a well-formed, freshly-issued ticket', () => {
    const token = mint(INSTALL, 'ana')
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(true)
  })

  // Staff.login is case-SENSITIVE unique (no COLLATE NOCASE) and the lookup
  // that applies the new password is exact -- a case-insensitive match here
  // would let a ticket approved for "Ana" reset a DIFFERENT account, "ana".
  it('is case-SENSITIVE on login, matching Staff.login lookup exactly', () => {
    const token = mint(INSTALL, 'Ana')
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
    expect(verifyPasswordResetTicket(token, INSTALL, 'Ana', PUBLIC_SPKI)).toBe(true)
  })

  it('trims surrounding whitespace on the presented login but not the ticket payload', () => {
    const token = mint(INSTALL, 'ana')
    expect(verifyPasswordResetTicket(token, INSTALL, '  ana  ', PUBLIC_SPKI)).toBe(true)
  })

  it('rejects a token minted for a different installId', () => {
    const token = mint(OTHER_INSTALL, 'ana')
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
  })

  it('rejects a token minted for a different login', () => {
    const token = mint(INSTALL, 'bruno')
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
  })

  // The exact scenario this ticket type exists to prevent: activation.ts
  // signs with the SAME key, and purpose is the only thing that keeps the
  // two token types from being interchangeable.
  it('rejects a token minted for a different purpose (e.g. activation), even though the key is the same', () => {
    const token = mint(INSTALL, 'ana', 'activation')
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
  })

  it('rejects a token whose signature comes from a different key', () => {
    const other = generateKeyPairSync('ed25519')
    const token = mint(INSTALL, 'ana', 'password_reset', new Date().toISOString(), other.privateKey)
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
  })

  it('rejects a ticket older than the freshness window', () => {
    const stale = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString()
    const token = mint(INSTALL, 'ana', 'password_reset', stale)
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
  })

  it('accepts a ticket just inside the freshness window', () => {
    const fresh = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString()
    const token = mint(INSTALL, 'ana', 'password_reset', fresh)
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', PUBLIC_SPKI)).toBe(true)
  })

  it('rejects null, empty, and malformed tokens without throwing', () => {
    expect(verifyPasswordResetTicket(null, INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
    expect(verifyPasswordResetTicket('', INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
    expect(verifyPasswordResetTicket('not-a-real-token', INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
    expect(verifyPasswordResetTicket('a.b.c', INSTALL, 'ana', PUBLIC_SPKI)).toBe(false)
  })

  it('rejects when no public key is configured', () => {
    const token = mint(INSTALL, 'ana')
    expect(verifyPasswordResetTicket(token, INSTALL, 'ana', '')).toBe(false)
  })
})
