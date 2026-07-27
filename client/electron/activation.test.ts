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

/** Reproduz o que o Worker faz em mintActivationToken. */
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
  it('aceita token assinado para esta instalacao e esta maquina', () => {
    expect(verifyActivationToken(mint(INSTALL, MACHINE), INSTALL, MACHINE, PUBLIC_SPKI)).toBe(true)
  })

  it('recusa token de outra maquina', () => {
    // O caso do userData copiado junto com o executavel.
    expect(verifyActivationToken(mint(INSTALL, OUTRA_MAQUINA), INSTALL, MACHINE, PUBLIC_SPKI)).toBe(
      false,
    )
  })

  it('recusa token de outra instalacao', () => {
    const outro = 'c3b5d7e9-2222-4333-8444-555566667777'
    expect(verifyActivationToken(mint(outro, MACHINE), INSTALL, MACHINE, PUBLIC_SPKI)).toBe(false)
  })

  it('recusa payload adulterado, mesmo mantendo a assinatura original', () => {
    // Editar o payload e a tentativa obvia de quem abre o arquivo. A assinatura
    // e verificada ANTES de qualquer campo ser lido, entao nao adianta.
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

  it('recusa assinatura de outra chave', () => {
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

  it('recusa lixo sem estourar excecao', () => {
    for (const token of [null, '', 'sem-ponto', 'a.b', '###.###', `${'x'.repeat(50)}.y`]) {
      expect(verifyActivationToken(token, INSTALL, MACHINE, PUBLIC_SPKI), String(token)).toBe(false)
    }
  })

  it('recusa quando o build nao trouxe chave publica', () => {
    expect(verifyActivationToken(mint(INSTALL, MACHINE), INSTALL, MACHINE, '')).toBe(false)
  })
})

describe('armazenamento do token', () => {
  it('grava e le de volta', () => {
    const token = mint(INSTALL, MACHINE)
    expect(storeToken(dir, token)).toBe(true)
    expect(readStoredToken(dir)).toBe(token)
    expect(fs.existsSync(tokenPath(dir))).toBe(true)
  })

  it('devolve null quando nao existe ou esta vazio', () => {
    expect(readStoredToken(dir)).toBeNull()
    fs.writeFileSync(tokenPath(dir), '   ')
    expect(readStoredToken(dir)).toBeNull()
  })

  it('nao estoura quando o diretorio nao existe', () => {
    expect(storeToken(path.join(dir, 'nao', 'existe'), 'x')).toBe(false)
  })
})

describe('requestActivation', () => {
  const endpoint = { url: 'https://proxy.exemplo/', productKey: 'chave' }

  function fakeFetch(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  }

  it('devolve o token em 200', async () => {
    const token = mint(INSTALL, MACHINE)
    const result = await requestActivation(endpoint, INSTALL, MACHINE, fakeFetch(200, { token }))
    expect(result).toEqual({ result: { state: 'activated' }, token })
  })

  it('202 e pendente, com o codigo curto para conferencia', async () => {
    const result = await requestActivation(
      endpoint,
      INSTALL,
      MACHINE,
      fakeFetch(202, { status: 'pending', code: 'B2A4F6C8' }),
    )
    expect(result.result).toEqual({ state: 'pending', code: 'B2A4F6C8' })
  })

  it('403 e recusa definitiva, com motivo', async () => {
    const result = await requestActivation(
      endpoint,
      INSTALL,
      MACHINE,
      fakeFetch(403, { reason: 'machine_mismatch' }),
    )
    expect(result.result).toEqual({ state: 'refused', reason: 'machine_mismatch' })
  })

  it('503 vira unreachable, nao recusa', async () => {
    // Servidor sem chave de assinatura e problema do dono, nao da lojista: o app
    // tenta de novo em vez de mostrar "acesso negado".
    const result = await requestActivation(endpoint, INSTALL, MACHINE, fakeFetch(503, {}))
    expect(result.result).toEqual({ state: 'unreachable' })
  })

  it('falha de rede vira unreachable', async () => {
    const boom = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const result = await requestActivation(endpoint, INSTALL, MACHINE, boom)
    expect(result.result).toEqual({ state: 'unreachable' })
  })

  it('nao duplica a barra ao montar a URL', async () => {
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

  it('deixa passar quando nenhuma fonte de maquina respondeu', async () => {
    // Falha para o lado seguro: peculiaridade de SO nao pode virar loja parada.
    const rede = vi.fn() as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, machineHash: null, fetchImpl: rede })
    expect(state).toEqual({ state: 'unverifiable' })
    expect(rede).not.toHaveBeenCalled()
  })

  it('deixa passar quando o build nao configurou ativacao', async () => {
    const state = await ensureActivated({ ...base, userDataPath: dir, endpoint: null })
    expect(state).toEqual({ state: 'unverifiable' })
  })

  it('token local valido dispensa a rede por completo', async () => {
    // A propriedade que sustenta o desenho inteiro: depois de ativado, offline
    // para sempre.
    storeToken(dir, mint(INSTALL, MACHINE))
    const rede = vi.fn() as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'activated' })
    expect(rede).not.toHaveBeenCalled()
  })

  it('ativa e grava quando o servidor libera', async () => {
    const token = mint(INSTALL, MACHINE)
    const rede = vi.fn(async () => new Response(JSON.stringify({ token }), { status: 200 })) as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'activated' })
    expect(readStoredToken(dir)).toBe(token)
  })

  it('nao grava token que nao passa na verificacao local', async () => {
    // Token para outra maquina gravado no disco entraria em ciclo de reativacao
    // sem explicacao a cada boot.
    const rede = vi.fn(
      async () => new Response(JSON.stringify({ token: mint(INSTALL, OUTRA_MAQUINA) }), { status: 200 }),
    ) as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'refused', reason: 'bad_token' })
    expect(readStoredToken(dir)).toBeNull()
  })

  it('token local invalido dispara nova tentativa', async () => {
    storeToken(dir, mint(INSTALL, OUTRA_MAQUINA))
    const rede = vi.fn(
      async () => new Response(JSON.stringify({ status: 'pending', code: 'B2A4F6C8' }), { status: 202 }),
    ) as unknown as typeof fetch
    const state = await ensureActivated({ ...base, userDataPath: dir, fetchImpl: rede })
    expect(state).toEqual({ state: 'pending', code: 'B2A4F6C8' })
    expect(rede).toHaveBeenCalledOnce()
  })
})
