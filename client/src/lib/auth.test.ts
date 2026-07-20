import { describe, it, expect, beforeEach } from 'vitest'
import { getToken, setToken, clearToken } from './auth.ts'

describe('auth token storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('stores and retrieves a token', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
  })

  it('clears a stored token', () => {
    setToken('abc123')
    clearToken()
    expect(getToken()).toBeNull()
  })
})
