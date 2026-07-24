import os from 'os'

export interface LanCandidate {
  interfaceName: string
  address: string
}

// Interface-name patterns for adapters that are technically RFC1918 but
// aren't the shop's actual Wi-Fi/Ethernet LAN — Docker/virtualization
// bridges and VPN tunnel interfaces. A QR code pointed at one of these
// would produce an address the signing phone can never reach.
const VIRTUAL_ADAPTER_PATTERNS = [
  /docker/i,
  /veth/i,
  /vmnet/i,
  /vboxnet/i,
  /^utun/i,
  /^tun/i,
  /^tap/i,
  /wireguard/i,
  /^wg/i,
  /tailscale/i,
  /zerotier/i,
]

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export function detectLanCandidates(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LanCandidate[] {
  const candidates: LanCandidate[] = []
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) continue
    if (VIRTUAL_ADAPTER_PATTERNS.some((pattern) => pattern.test(name))) continue
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (!isPrivateIPv4(info.address)) continue
      candidates.push({ interfaceName: name, address: info.address })
    }
  }
  return candidates
}
