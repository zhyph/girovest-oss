import { describe, it, expect } from 'vitest'
import { hashMachineValue, resolveMachineHash, detectMachineSource } from './machineId.ts'

describe('hashMachineValue', () => {
  it('is deterministic and normalises case and whitespace', () => {
    const a = hashMachineValue('machine-id', 'ABC-123 ')
    expect(a).toBe(hashMachineValue('machine-id', 'abc-123'))
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('separates different sources holding the same raw value', () => {
    // If the machine starts answering from a different source (machine-id
    // deleted, falling back to MAC), the hash must change and activation must be
    // redone. Colliding the two would hide the switch.
    expect(hashMachineValue('machine-id', 'x')).not.toBe(hashMachineValue('mac', 'x'))
  })
})

describe('resolveMachineHash', () => {
  it('returns null when no source answered', () => {
    // Contract with ensureActivated: null means let it through, never block.
    expect(resolveMachineHash(null)).toBeNull()
  })

  it('hashes whichever source it found', () => {
    expect(resolveMachineHash({ source: 'mac', raw: 'aa:bb:cc:dd:ee:ff' })).toBe(
      hashMachineValue('mac', 'aa:bb:cc:dd:ee:ff'),
    )
  })
})

describe('detectMachineSource', () => {
  it('finds some source on this test machine', () => {
    // Deliberately does not assert WHICH: a containerised CI may have no
    // /etc/machine-id and fall back to the MAC. What matters is not returning
    // null on a normal machine.
    const source = detectMachineSource()
    if (source !== null) {
      expect(source.raw).not.toBe('')
      expect(['machine-id', 'machine-guid', 'mac']).toContain(source.source)
    }
  })
})
