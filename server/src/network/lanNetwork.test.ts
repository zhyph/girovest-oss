import { describe, it, expect } from 'vitest'
import { detectLanCandidates } from './lanNetwork.js'

function iface(address: string, opts: { internal?: boolean; family?: 'IPv4' | 'IPv6' } = {}) {
  return [{
    address,
    netmask: '255.255.255.0',
    family: opts.family ?? 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: opts.internal ?? false,
    cidr: `${address}/24`,
  }] as unknown as import('os').NetworkInterfaceInfo[]
}

describe('detectLanCandidates', () => {
  it('returns a private-range IPv4 interface', () => {
    const candidates = detectLanCandidates({ wlan0: iface('192.168.1.42') })
    expect(candidates).toEqual([{ interfaceName: 'wlan0', address: '192.168.1.42' }])
  })

  it('accepts all three RFC1918 ranges', () => {
    const candidates = detectLanCandidates({
      a: iface('10.0.0.5'),
      b: iface('172.20.0.5'),
      c: iface('192.168.0.5'),
    })
    expect(candidates.map((c) => c.address).sort()).toEqual(['10.0.0.5', '172.20.0.5', '192.168.0.5'])
  })

  it('excludes internal (loopback) interfaces', () => {
    const candidates = detectLanCandidates({ lo: iface('127.0.0.1', { internal: true }) })
    expect(candidates).toEqual([])
  })

  it('excludes IPv6 interfaces', () => {
    const candidates = detectLanCandidates({ eth0: iface('fe80::1', { family: 'IPv6' }) })
    expect(candidates).toEqual([])
  })

  it('excludes public (non-RFC1918) IPv4 addresses', () => {
    const candidates = detectLanCandidates({ eth0: iface('8.8.8.8') })
    expect(candidates).toEqual([])
  })

  it('excludes known virtual-adapter interface names', () => {
    const candidates = detectLanCandidates({
      docker0: iface('172.17.0.1'),
      veth1234: iface('172.17.0.2'),
      vmnet8: iface('192.168.100.1'),
      utun3: iface('192.168.99.1'),
    })
    expect(candidates).toEqual([])
  })

  it('returns multiple candidates when more than one qualifies', () => {
    const candidates = detectLanCandidates({ wlan0: iface('192.168.1.42'), eth0: iface('192.168.1.43') })
    expect(candidates).toHaveLength(2)
  })

  it('returns an empty array when nothing qualifies', () => {
    expect(detectLanCandidates({})).toEqual([])
  })
})
