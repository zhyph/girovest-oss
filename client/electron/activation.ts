import { createPublicKey, verify } from 'node:crypto'
import fs from 'fs'
import path from 'path'

/**
 * Ativacao do lado do app.
 *
 * O ponto central: `verifyActivationToken` NAO usa rede. Depois da primeira
 * ativacao o app confere a assinatura localmente em todo boot, para sempre, e e
 * isso que separa esta trava de um kill switch — internet caida, Worker fora do
 * ar ou secret expirado nunca impedem a loja de trabalhar.
 *
 * A verificacao usa so a chave PUBLICA, embutida no bundle em tempo de build. O
 * app consegue conferir tudo e nao consegue assinar nada.
 */

const TOKEN_FILE = 'activation-token'

export type ActivationState =
  | { readonly state: 'activated' }
  /** Registrada, esperando o LICENCIANTE aprovar no painel. */
  | { readonly state: 'pending'; readonly code: string }
  /** Recusada por revogacao ou por ser outra maquina. */
  | { readonly state: 'refused'; readonly reason: string }
  /** Nao deu para falar com o servidor. Difere de recusa: aqui vale tentar de novo. */
  | { readonly state: 'unreachable' }
  /** Nenhuma fonte de identificacao de maquina respondeu: deixa passar. */
  | { readonly state: 'unverifiable' }

interface TokenPayload {
  readonly installId: string
  readonly machineHash: string
  readonly issuedAt: string
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Confere o token contra esta instalacao e esta maquina.
 *
 * A ordem importa: valida a assinatura ANTES de confiar em qualquer campo do
 * payload. Ler installId/machineHash de um payload nao verificado e depois
 * compara-los seria teatro — quem edita o arquivo edita os dois.
 */
export function verifyActivationToken(
  token: string | null,
  installId: string,
  machineHash: string,
  publicKeySpkiBase64: string,
): boolean {
  if (token == null || token === '' || publicKeySpkiBase64 === '') return false
  const [head, signature] = token.split('.')
  if (head == null || signature == null) return false

  let data: Buffer
  try {
    data = decodeBase64Url(head)
    const key = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    })
    // Ed25519: algoritmo null, a assinatura ja cobre o hash internamente.
    if (!verify(null, data, key, decodeBase64Url(signature))) return false
  } catch {
    // Base64 quebrado, chave publica invalida, token de outro algoritmo: tudo
    // isso e token invalido, nao excecao a propagar.
    return false
  }

  let payload: TokenPayload
  try {
    payload = JSON.parse(data.toString('utf-8')) as TokenPayload
  } catch {
    return false
  }
  return payload.installId === installId && payload.machineHash === machineHash
}

export function tokenPath(userDataPath: string): string {
  return path.join(userDataPath, TOKEN_FILE)
}

export function readStoredToken(userDataPath: string): string | null {
  try {
    const value = fs.readFileSync(tokenPath(userDataPath), 'utf-8').trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/** Grava o token. Falha de escrita nao e fatal: o app so vai reativar no proximo boot. */
export function storeToken(userDataPath: string, token: string): boolean {
  try {
    fs.writeFileSync(tokenPath(userDataPath), token, 'utf-8')
    return true
  } catch {
    return false
  }
}

export interface ActivationEndpoint {
  readonly url: string
  readonly productKey: string
}

type FetchLike = typeof globalThis.fetch

/**
 * Pede ativacao ao servidor. So e chamada quando o token local nao serve.
 *
 * 202 e "pendente", nao erro: o dono ainda vai aprovar no painel, e o app deve
 * mostrar o codigo e continuar tentando. 403 e recusa definitiva. Qualquer
 * outra coisa, incluindo o 503 de servidor sem chave de assinatura, vira
 * `unreachable`, porque o comum e falta de internet e a acao certa e tentar
 * de novo, nao acusar a lojista de nada.
 */
export async function requestActivation(
  endpoint: ActivationEndpoint,
  installId: string,
  machineHash: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<{ readonly result: ActivationState; readonly token?: string }> {
  let response: Response
  try {
    response = await fetchImpl(`${endpoint.url.replace(/\/+$/, '')}/activate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.productKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ installId, machineHash }),
    })
  } catch {
    return { result: { state: 'unreachable' } }
  }

  let body: { token?: unknown; code?: unknown; reason?: unknown } = {}
  try {
    body = (await response.json()) as typeof body
  } catch {
    body = {}
  }

  if (response.status === 200 && typeof body.token === 'string') {
    return { result: { state: 'activated' }, token: body.token }
  }
  if (response.status === 202) {
    return {
      result: { state: 'pending', code: typeof body.code === 'string' ? body.code : installId.slice(0, 8).toUpperCase() },
    }
  }
  if (response.status === 403) {
    return {
      result: { state: 'refused', reason: typeof body.reason === 'string' ? body.reason : 'denied' },
    }
  }
  return { result: { state: 'unreachable' } }
}

export interface EnsureActivatedInput {
  readonly userDataPath: string
  readonly installId: string
  readonly machineHash: string | null
  readonly publicKey: string
  readonly endpoint: ActivationEndpoint | null
  readonly fetchImpl?: FetchLike
}

/**
 * Decide se o app pode abrir, e ativa quando preciso.
 *
 * Dois casos deixam passar sem token, os dois deliberados:
 *   - `machineHash` nulo: nenhuma fonte de identificacao respondeu (ver
 *     machineId.ts). Bloquear aqui seria transformar peculiaridade de SO em
 *     loja parada.
 *   - endpoint nao configurado no build: e um build de desenvolvimento ou mal
 *     configurado, e travar o proprio desenvolvedor fora do app nao ajuda
 *     ninguem. O aviso fica no log.
 */
export async function ensureActivated(input: EnsureActivatedInput): Promise<ActivationState> {
  const { userDataPath, installId, machineHash, publicKey, endpoint } = input
  if (machineHash === null) return { state: 'unverifiable' }
  if (endpoint === null || endpoint.url === '' || endpoint.productKey === '' || publicKey === '') {
    return { state: 'unverifiable' }
  }

  if (verifyActivationToken(readStoredToken(userDataPath), installId, machineHash, publicKey)) {
    return { state: 'activated' }
  }

  const { result, token } = await requestActivation(
    endpoint,
    installId,
    machineHash,
    input.fetchImpl ?? globalThis.fetch,
  )
  if (result.state === 'activated' && token != null) {
    // Reverifica o que o servidor mandou antes de gravar. Token que nao passa na
    // verificacao local nunca deve virar arquivo: no boot seguinte ele falharia
    // de novo e o app entraria em ciclo de reativacao sem explicacao.
    if (!verifyActivationToken(token, installId, machineHash, publicKey)) {
      return { state: 'refused', reason: 'bad_token' }
    }
    storeToken(userDataPath, token)
  }
  return result
}
