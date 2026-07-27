import { describe, it, expect } from 'vitest'
import {
  SESSION_TTL_SECONDS,
  shouldRenewToken,
  signStaffToken,
  verifyStaffToken,
} from './jwt.js'

describe('signStaffToken', () => {
  it('mints a token whose lifetime is SESSION_TTL_SECONDS', () => {
    const token = signStaffToken({ staffId: 'staff-1', role: 'owner' })
    const payload = verifyStaffToken(token)

    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS)
  })
})

describe('verifyStaffToken', () => {
  it('exposes iat and exp alongside staffId and role', () => {
    const token = signStaffToken({ staffId: 'staff-1', role: 'staff' })
    const payload = verifyStaffToken(token)

    expect(payload.staffId).toBe('staff-1')
    expect(payload.role).toBe('staff')
    expect(typeof payload.iat).toBe('number')
    expect(typeof payload.exp).toBe('number')
  })
})

describe('shouldRenewToken', () => {
  const iat = 1_700_000_000
  const exp = iat + SESSION_TTL_SECONDS
  const halfLife = iat + SESSION_TTL_SECONDS / 2

  it('is false one hour into a twelve hour token', () => {
    expect(shouldRenewToken({ iat, exp }, (iat + 3600) * 1000)).toBe(false)
  })

  it('is false exactly at the half-life', () => {
    expect(shouldRenewToken({ iat, exp }, halfLife * 1000)).toBe(false)
  })

  it('is true one second past the half-life', () => {
    expect(shouldRenewToken({ iat, exp }, (halfLife + 1) * 1000)).toBe(true)
  })

  it('is true one minute before expiry', () => {
    expect(shouldRenewToken({ iat, exp }, (exp - 60) * 1000)).toBe(true)
  })
})
