import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O que estes testes protegem, e por que nao e obvio.
 *
 * As tres garantias do updater foram verificadas originalmente lendo o fonte do
 * electron-updater e dando grep no bundle gerado, nao por assercao. Isso quebra
 * em silencio num bump de major da lib, e o sintoma em producao seria o pior
 * possivel: um app que simplesmente para de atualizar, sem erro visivel.
 *
 * O mock de `addAuthHeader` abaixo replica de proposito a semantica REAL da lib
 * (`this.requestHeaders = Object.assign({}, this.requestHeaders, {...})`, um
 * substitui mesclando, nao um adiciona). Sem essa fidelidade o teste de headers
 * nao provaria nada.
 *
 * Verificado por mutacao: remover o spread em updater.ts faz o teste "mantem os
 * DOIS headers" falhar. Inverter a ordem das duas chamadas NAO faz, porque o
 * merge preserva o que ja estava la -- a ordem nao e o risco, o spread e.
 */

const isPackaged = { value: true }
const showMessageBox = vi.fn(async () => ({ response: 1 }))

let autoUpdater: {
  logger: unknown
  requestHeaders: Record<string, string> | null
  setFeedURL: ReturnType<typeof vi.fn>
  addAuthHeader: (token: string) => void
  on: ReturnType<typeof vi.fn>
  checkForUpdates: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

const log = { transports: { file: { level: '' } }, warn: vi.fn(), info: vi.fn() }

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged.value
    },
  },
  dialog: { showMessageBox },
}))
vi.mock('electron-log', () => ({ default: log }))
// Getter, nao valor: o factory do vi.mock e avaliado antes do beforeEach que
// cria a instancia, entao capturar `autoUpdater` por valor entregaria undefined
// ao modulo sob teste. O getter resolve no momento em que updater.ts
// desestrutura o import dinamico, que e o que queremos.
vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      return autoUpdater
    },
  },
}))

function makeAutoUpdater() {
  const updater = {
    logger: null as unknown,
    requestHeaders: null as Record<string, string> | null,
    setFeedURL: vi.fn(),
    addAuthHeader(token: string) {
      // Semantica real da lib: substitui o objeto por uma copia mesclada.
      updater.requestHeaders = Object.assign({}, updater.requestHeaders, {
        authorization: token,
      })
    },
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  }
  return updater
}

async function setup(url: string, key: string) {
  vi.stubGlobal('GIROVEST_UPDATE_URL', url)
  vi.stubGlobal('GIROVEST_UPDATE_KEY', key)
  const { setupAutoUpdater } = await import('./updater.ts')
  await setupAutoUpdater('b2a4f6c8-1111-4222-8333-444455556666')
}

beforeEach(() => {
  vi.resetModules()
  autoUpdater = makeAutoUpdater()
  isPackaged.value = true
  log.warn.mockClear()
  // setInterval real deixaria um timer de 4h pendurado depois de cada teste.
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('setupAutoUpdater', () => {
  it('nao faz nada quando o app nao esta empacotado', async () => {
    isPackaged.value = false
    await setup('https://proxy.exemplo', 'chave')
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('desiste com aviso quando o build nao trouxe URL e chave', async () => {
    // Sem isto, um build sem os secrets cairia no app-update.yml empacotado, que
    // aponta para um repositorio privado: 404 eterno com cara de "sem
    // atualizacoes disponiveis".
    await setup('', '')
    expect(log.warn).toHaveBeenCalledOnce()
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('desiste quando so a chave falta', async () => {
    await setup('https://proxy.exemplo', '')
    expect(log.warn).toHaveBeenCalledOnce()
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled()
  })

  it('aponta para o proxy como provider generico', async () => {
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'generic', url: 'https://proxy.exemplo' }),
    )
  })

  it('desliga o range multiplo, que o provider generico liga sozinho', async () => {
    // O provider github desligava; trocar para generic reativa. Se o Worker nao
    // implementar multiplas faixas por requisicao, o download diferencial quebra.
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ useMultipleRangeRequest: false }),
    )
  })

  it('mantem os DOIS headers depois da configuracao', async () => {
    // A regressao que este teste pega: atribuir requestHeaders sem espalhar o
    // valor atual apaga o authorization que addAuthHeader colocou, e o app passa
    // a tomar 403 em toda checagem.
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.requestHeaders).toEqual({
      authorization: 'Bearer chave-de-produto',
      'X-Girovest-Install': 'b2a4f6c8-1111-4222-8333-444455556666',
    })
  })

  it('registra o handler de error antes de checar', async () => {
    // autoUpdater e um EventEmitter: um 'error' sem listener e excecao nao
    // tratada, ou seja, dialogo de crash numa loja sem internet.
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('engole a rejeicao de checkForUpdates', async () => {
    // checkForUpdates emite 'error' E rejeita a promise; o handler ja logou, e
    // uma rejeicao nao tratada derruba o processo main no Node 24.
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    await expect(setup('https://proxy.exemplo', 'chave-de-produto')).resolves.toBeUndefined()
  })
})
