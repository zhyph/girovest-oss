import { describe, it, expect, beforeEach } from 'vitest'
import { getLastSeenChangelogVersion, markChangelogSeen } from './changelogSeen.ts'

beforeEach(() => localStorage.clear())

describe('changelogSeen', () => {
  it('reports null before anything has ever been marked seen', () => {
    expect(getLastSeenChangelogVersion()).toBeNull()
  })

  it('round-trips whatever version was marked seen', () => {
    markChangelogSeen('0.12.0')
    expect(getLastSeenChangelogVersion()).toBe('0.12.0')
  })

  it('overwrites the previous value on a later mark', () => {
    markChangelogSeen('0.12.0')
    markChangelogSeen('0.13.0')
    expect(getLastSeenChangelogVersion()).toBe('0.13.0')
  })
})
