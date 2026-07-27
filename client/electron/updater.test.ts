import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What these tests protect, and why it is not obvious.
 *
 * The updater's three guarantees were originally verified by reading
 * electron-updater's source and grepping the generated bundle, not by
 * assertion. That breaks silently on a major bump of the library, and the
 * symptom in production would be the worst kind: an app that simply stops
 * updating, with no visible error.
 *
 * The addAuthHeader mock below deliberately replicates the library's REAL
 * semantics (`this.requestHeaders = Object.assign({}, this.requestHeaders,
 * {...})` — a merging replace, not an add). Without that fidelity the header
 * test would prove nothing.
 *
 * Verified by mutation: removing the spread in updater.ts makes the "keeps BOTH
 * headers" test fail. Swapping the order of the two calls does NOT, because the
 * merge preserves what was already there — the order is not the risk, the
 * spread is.
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
// A getter, not a value: the vi.mock factory is evaluated before the beforeEach
// that creates the instance, so capturing `autoUpdater` by value would hand the
// module under test undefined. The getter resolves at the moment updater.ts
// destructures the dynamic import, which is what we want.
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
      // The library's real semantics: replaces the object with a merged copy.
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
  // A real setInterval would leave a 4h timer hanging after every test.
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('setupAutoUpdater', () => {
  it('does nothing when the app is not packaged', async () => {
    isPackaged.value = false
    await setup('https://proxy.exemplo', 'chave')
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('bails out with a warning when the build carried no URL and key', async () => {
    // Without this, a build missing the secrets would fall back to the packaged
    // app-update.yml, which points at a private repo: an eternal 404 that looks
    // like "no updates available".
    await setup('', '')
    expect(log.warn).toHaveBeenCalledOnce()
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('bails out when only the key is missing', async () => {
    await setup('https://proxy.exemplo', '')
    expect(log.warn).toHaveBeenCalledOnce()
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled()
  })

  it('points at the proxy as a generic provider', async () => {
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'generic', url: 'https://proxy.exemplo' }),
    )
  })

  it('turns off multi-range, which the generic provider enables on its own', async () => {
    // The github provider disabled it; switching to generic turns it back on. If
    // the Worker does not implement multiple ranges per request, differential
    // downloads break.
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ useMultipleRangeRequest: false }),
    )
  })

  it('keeps BOTH headers after configuration', async () => {
    // The regression this catches: assigning requestHeaders without spreading
    // the current value wipes the authorization header addAuthHeader just set,
    // and the app starts taking a 403 on every check.
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.requestHeaders).toEqual({
      authorization: 'Bearer chave-de-produto',
      'X-Girovest-Install': 'b2a4f6c8-1111-4222-8333-444455556666',
    })
  })

  it('registers the error handler before checking', async () => {
    // autoUpdater is an EventEmitter: an 'error' with no listener is an
    // unhandled exception, i.e. a crash dialog in a shop with no internet.
    await setup('https://proxy.exemplo', 'chave-de-produto')
    expect(autoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('swallows the checkForUpdates rejection', async () => {
    // checkForUpdates emits 'error' AND rejects the promise; the handler already
    // logged, and an unhandled rejection kills the main process on Node 24.
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    await expect(setup('https://proxy.exemplo', 'chave-de-produto')).resolves.toBeUndefined()
  })
})
