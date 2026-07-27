import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'fs'
import os from 'os'

/**
 * Machine fingerprint, used to bind an activation to one computer.
 *
 * The raw value never leaves this file: what travels is its sha256. The server
 * doesn't need to know which machine this is, only to recognise it as the same
 * one as before, and a hash does that without shipping a hardware identifier.
 *
 * FAILS OPEN. When no source answers, resolveMachineHash returns null and the
 * caller lets the app through. Blocking on a read failure would turn an OS
 * quirk (SELinux, a container, an image cloned without a machine-id) into a
 * shop that can't open on a Saturday. The accepted risk is someone deleting the
 * identifier on purpose to escape the lock — and against that someone the lock
 * was never going to hold anyway, since the check runs client-side.
 */

/** Sources in order of preference: stable ones first, derived ones last. */
function readLinuxMachineId(): string | null {
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = fs.readFileSync(file, 'utf-8').trim()
      if (value !== '') return value
    } catch {
      // A missing file is normal on several distributions; try the next one.
    }
  }
  return null
}

function readWindowsMachineGuid(): string | null {
  try {
    // Node has no registry API; `reg query` is the way to read it without a
    // native dependency. execFileSync rather than exec so no shell is involved.
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf-8', windowsHide: true, timeout: 5_000 },
    )
    const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)
    return match ? (match[1] as string) : null
  } catch {
    return null
  }
}

/**
 * Last resort: the MAC of the first physical interface.
 *
 * Less stable than a machine-id (swapping the network card changes it), but
 * better than giving up: without it, deleting /etc/machine-id would be enough
 * to escape the lock. Virtual interfaces are excluded because docker0/veth
 * change on every reboot and identical ones exist across different machines.
 */
function readPrimaryMac(): string | null {
  const virtual = /^(docker|veth|br-|virbr|vmnet|vboxnet|tun|tap|wg|tailscale|zt|lo)/i
  const candidates: string[] = []
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue
    for (const info of infos ?? []) {
      if (info.internal) continue
      if (info.mac && info.mac !== '00:00:00:00:00:00') candidates.push(info.mac)
    }
  }
  // Sorted so the result doesn't depend on the system's enumeration order,
  // which varies between boots when there is more than one interface.
  candidates.sort()
  return candidates[0] ?? null
}

export interface MachineSource {
  readonly source: 'machine-id' | 'machine-guid' | 'mac'
  readonly raw: string
}

/** First available source, labelled (useful for logs and support). */
export function detectMachineSource(platform: NodeJS.Platform = process.platform): MachineSource | null {
  if (platform === 'win32') {
    const guid = readWindowsMachineGuid()
    if (guid !== null) return { source: 'machine-guid', raw: guid }
  } else {
    const id = readLinuxMachineId()
    if (id !== null) return { source: 'machine-id', raw: id }
  }
  const mac = readPrimaryMac()
  return mac === null ? null : { source: 'mac', raw: mac }
}

/** sha256 hex of the raw identifier, or null when no source answered. */
export function resolveMachineHash(source: MachineSource | null = detectMachineSource()): string | null {
  if (source === null) return null
  return hashMachineValue(source.source, source.raw)
}

/**
 * The source name is part of the hash on purpose: if the same machine starts
 * answering from a different source (machine-id deleted, falling back to MAC),
 * the hash changes and activation is redone. Colliding the two would hide the
 * switch instead.
 */
export function hashMachineValue(source: MachineSource['source'], raw: string): string {
  return createHash('sha256').update(`${source}:${raw.trim().toLowerCase()}`).digest('hex')
}
