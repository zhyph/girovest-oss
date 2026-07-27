import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  ensureActivated,
  readStoredToken,
  requestActivation,
  storeToken,
  tokenPath,
  verifyActivationToken,
} from './activation.ts'

const INSTALL = 'b2a4f6c8-1111-4222-8333-444455556666'
const MACHINE = 'a'.repeat(64)
const OUTRA_MAQUINA = 'b'.repeat(64)

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PUBLIC_SPKI = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

/** Reproduces what the Worker does in mintActivationToken. */
function mint(installId: string, machineHash: string, issuedAt = '2026-07-27'): string {
  const canonical = JSON.stringify({ installId, machineHash, issuedAt })
  const data = Buffer.from(canonical, 'utf-8')
  const signature = sign(null, data, privateKey)
  const b64url = (buf: Buffer) =>
    buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url(data)}.${b64url(signature)}`
}

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovest-activation-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('verifyActivationToken', () => {
  it('accepts a token signed for this installation and this machine', () => {
    expect(verifyActivationToken(mint(INSTALL, MACHINE), INSTALL, MACHINE, PUBLIC_SPKI)).toBe(true)
  })

  it('rejects a token for another machine', () => {
    // The case of userData copied alongside the executable.
    expect(verifyActivationToken(mint(INSTALL, OUTRA_MAQUINA), INSTALL, MACHINE, PUBLIC_SPKI)).toBe(
      false,
    )
  })

  it('rejects a token for another installation', () => {
    const outro = 'c3b5d7e9-2222-4333-8444-555566667777'
    expect(verifyActivationToken(mint(outro, MACHINE), INSTALL, MACHINE, PUBLIC_SPKI)).toBe(false)
  })

  it('rejects a tampered payload even when the original signature is kept', () => {
    // Editing the payload is the obvious move for whoever opens the file. The
    // signature is verified BEFORE any field is read, so it gets them nowhere.
    const token = mint(INSTALL, OUTRA_MAQUINA)
    const [, sig] = token.split('.')
    const forjado = Buffer.from(
      JSON.stringify({ installId: INSTALL, machineHash: MACHINE, issuedAt: '2026-07-27' }),
      'utf-8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(verifyActivationToken(`${forjado}.${sig}`, INSTALL, MACHINE, PUBLIC_SPKI)).toBe(false)
  })

  it('rejects a signature from a different key', () => {
    const outra = generateKeyPairSync('ed25519')
    const canonical = JSON.stringify({
      installId: INSTALL,
      machineHash: MACHINE,
      issuedAt: '2026-07-27',
    })
    const data = Buffer.from(canonical, 'utf-8')
    const b64url = (buf: Buffer) =>
      buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const token = `${b64url(data)}.${b64url(sign(null, data, outra.privateKey))}`
    expect(verifyActivationToken(token, INSTALL, MACHINE, PUBLIC_SPKI)).toBe(false)
  })

  it('rejects garbage without throwing', () => {
    for (const token of [null, '', 'sem-ponto', 'a.b', '###.###', `${'x'.repeat(50)}.y`]) {
      expect(verifyActivationToken(token, INSTALL, MACHINE, PUBLIC_SPKI), String(token)).toBe(false)
    }
  })

  it('rejects when the build carried no public key', () => {
    expect(verifyActivationToken(mint(INSTALL, MACHINE), INSTALL, MACHINE, '')).toBe(false)
  })
})

describe('token storage', () => {
  it('writes and reads back', () => {
    const token = mint(INSTALL, MACHINE)
    expect(storeToken(dir, token)).toBe(true)
    expect(readStoredToken(dir)).toBe(token)
    expect(fs.existsSync(tokenPath(dir))).toBe(true)
  })

  it('returns null when absent or empty', () => {
    expect(readStoredToken(dir)).toBeNull()
    fs.writeFileSync(tokenPath(dir), '   ')
    expect(readStoredToken(dir)).toBeNull()
  })

  it('does not throw when the directory does not exist', () => {
    expect(storeToken(path.join(dir, 'nao', 'existe'), 'x')).toBe(false)
  })
})

describe('requestActivation', () => {
  const endpoint = { url: 'https://proxy.exemplo/', productKey: 'chave' }

  function fakeFetch(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  }

  it('returns the token on 200', async () => {
    const token = mint(INSTALL, MACHINE)
    const result = await requestActivation(endpoint, INSTALL, MACHINE, fakeFetch(200, { token }))
    expect(result).toEqual({ result: { state: 'activated' }, token })
  })

  it('202 is pending, carrying the short code for visual matching', async () => {
    const result = await requestActivation(
      endpoint,
      INSTALL,
      MACHINE,
      fakeFetch(202, { status: 'pending', code: 'B2A4F6C8' }),
    )
    expect(result.result).toEqual({ state: 'pending', code: 'B2A4F6C8' })
  })

  it('403 is a final refusal, with a reason', async () => {
    const result = await requestActivation(
      endpoint,
      INSTALL,
      MACHINE,
      fakeFetch(403, { reason: 'machine_mismatch' }),
    )
    expect(result.result).toEqual({ state: 'refused', reason: 'machine_mismatch' })
  })

  it('503 becomes unreachable, not a refusal', async () => {
    // A server with no signing key is the owner's problem, not the shop's: the
    // app retries instead of showing "access denied".
    const result = await requestActivation(endpoint, INSTALL, MACHINE, fakeFetch(503, {}))
    expect(result.result).toEqual({ state: 'unreachable' })
  })

  it('a network failure becomes unreachable', async () => {
    const boom = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const result = await requestActivation(endpoint, INSTALL, MACHINE, boom)
    expect(result.result).toEqual({ state: 'unreachable' })
  })

  it('does not double the slash when building the URL', async () => {
    const spy = fakeFetch(200, { token: mint(INSTALL, MACHINE) })
    await requestActivation(endpoint, INSTALL, MACHINE, spy)
    expect((spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toBe(
      'https://proxy.exemplo/activate',
    )
  })
})

describe('ensureActivated', () => {
  const endpoint = { url: 'https://proxy.exemplo', productKey: 'chave' }
  const base = { userDataPath: '', installId: INSTALL, machineHash: MACHINE, publicKey: PUBLIC_SPKI, endpoint }

  it('lets the app through when no machine source answered', async () => {
    // Fails open: an OS quirk must not become a shop that cannot open.
    const rede = vi.fn() as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, machineHash: null, fetchImpl: rede })
    expect(state).toEqual({ state: 'unverifiable' })
    expect(rede).not.toHaveBeenCalled()
  })

  it('lets the app through when the build configured no activation', async () => {
    const state = await ensureActivated({ ...base, userDataPath: dir, endpoint: null })
    expect(state).toEqual({ state: 'unverifiable' })
  })

  it('a valid local token skips the network entirely', async () => {
    // The property the whole design rests on: once activated, offline forever.
    storeToken(dir, mint(INSTALL, MACHINE))
    const rede = vi.fn() as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'activated' })
    expect(rede).not.toHaveBeenCalled()
  })

  it('activates and stores when the server releases it', async () => {
    const token = mint(INSTALL, MACHINE)
    const rede = vi.fn(async () => new Response(JSON.stringify({ token }), { status: 200 })) as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'activated' })
    expect(readStoredToken(dir)).toBe(token)
  })

  it('does not store a token that fails local verification', async () => {
    // A token for another machine written to disk would put the app in an
    // unexplained reactivation loop on every boot.
    const rede = vi.fn(
      async () => new Response(JSON.stringify({ token: mint(INSTALL, OUTRA_MAQUINA) }), { status: 200 }),
    ) as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'refused', reason: 'bad_token' })
    expect(readStoredToken(dir)).toBeNull()
  })

  it('an invalid local token triggers a fresh attempt', async () => {
    storeToken(dir, mint(INSTALL, OUTRA_MAQUINA))
    const rede = vi.fn(
      async () => new Response(JSON.stringify({ status: 'pending', code: 'B2A4F6C8' }), { status: 202 }),
    ) as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'pending', code: 'B2A4F6C8' })
    expect(rede).toHaveBeenCalledOnce()
  })
})
