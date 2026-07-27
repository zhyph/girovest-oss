import { app, dialog } from 'electron'

// Injected at build time by electron.vite.config.ts's `define` for the `main`
// target, from the GIROVEST_UPDATE_URL / GIROVEST_UPDATE_KEY environment
// variables (empty string when the build didn't set them). They are literal
// text substitutions, so they only exist in the packaged bundle: under Vitest
// these identifiers are undeclared and a bare reference would throw a
// ReferenceError. Every read below therefore sits after the `isPackaged`
// guard, which returns long before any test reaches it.
declare const GIROVEST_UPDATE_URL: string
declare const GIROVEST_UPDATE_KEY: string

// Shop machines stay open all day; launch-only checks would miss updates.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// In-memory on purpose: the downloaded update persists across restarts via
// electron-updater's own cache, so re-prompting once after a restart is
// correct. What this guards against is the 4h interval re-emitting
// update-downloaded for the same cached download all day. It stores the
// version (not a boolean) so a superseding release published mid-day still
// prompts — which is also why the interval keeps running after a download.
let promptedVersion: string | null = null

export async function setupAutoUpdater(installId: string): Promise<void> {
  // Optional chaining matters: under Vitest `app` is undefined (see the
  // `if (app)` guard comment in main.ts), and a bare `app.isPackaged` here
  // would TypeError if a future test ever calls this. In dev (real Electron,
  // not packaged) isPackaged is false. Either way: return, no updater.
  if (!app?.isPackaged) return

  // Dynamic imports, deliberately after the isPackaged guard: this module is
  // (transitively) imported by main.test.ts under Vitest, where 'electron'
  // is a plain string. electron-updater's `autoUpdater` export is a lazy
  // getter that instantiates a platform updater touching electron.app the
  // moment it's destructured — top-level access would crash the test suite.
  // electron-updater is also CJS: default-import + destructure, not a named
  // ESM import (electron-builder issue #7976).
  const log = (await import('electron-log')).default
  const { autoUpdater } = (await import('electron-updater')).default

  log.transports.file.level = 'info'
  autoUpdater.logger = log

  // Fail loudly and do nothing. Without this, a build that forgot the two
  // environment variables would silently fall back to the app-update.yml
  // baked into the package (GitHub provider, girovest-releases) — a repo that
  // is now private, so every check would 404 and look like "no updates
  // available" forever. Warning-and-returning makes a misconfigured build
  // visible in the log instead of turning into a silently dead update path.
  if (!GIROVEST_UPDATE_URL || !GIROVEST_UPDATE_KEY) {
    log.warn(
      'Auto-update desativado: build sem GIROVEST_UPDATE_URL/GIROVEST_UPDATE_KEY. ' +
        'Nenhum feed configurado (o app-update.yml do pacote foi ignorado de proposito).',
    )
    return
  }

  // The releases repo is private now, so the app never talks to GitHub
  // directly: it points at a Cloudflare Worker that holds the GitHub PAT
  // server-side and proxies latest*.yml plus the installer assets. 'generic'
  // is the provider for "a plain HTTP directory of update files", which is
  // exactly the shape the Worker exposes.
  //
  // useMultipleRangeRequest: false is not optional here, and its absence would
  // fail silently. providerFactory.js:53 defaults it to true for any URL that
  // isn't S3-shaped, which turns on the multi-range differential downloader:
  // it sends one `Range: bytes=0-99, 500-999, ...` with many ranges and then
  // requires the response to be `multipart/byteranges`
  // (multipleRangeDownloader.js:81). The Worker forwards Range verbatim to
  // GitHub's release-asset storage, and that storage does not implement
  // multipart ranges — it answers with a plain 200. NsisUpdater swallows the
  // resulting error, logs "Cannot download differentially, fallback to full
  // download" and re-downloads the whole installer, so the only symptom is
  // every shop pulling ~100 MB on every update forever. With the flag off the
  // updater falls back to one range per request (DifferentialDownloader.js),
  // which is exactly what the storage and the Worker do support. This is the
  // same thing electron-updater itself does for S3/Spaces.
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: GIROVEST_UPDATE_URL,
    useMultipleRangeRequest: false,
  })

  // The spread is load-bearing; the order of these two statements is not.
  // Read from electron-updater 6.8.9's AppUpdater source:
  //   - setFeedURL() never touches requestHeaders (only the constructor does,
  //     and only from its own options object), so it is safe on either side.
  //   - addAuthHeader(token) is not an "add": it does
  //     `this.requestHeaders = Object.assign({}, this.requestHeaders, {...})`,
  //     i.e. it REPLACES the object with a merged copy. Because that copy
  //     preserves whatever was already there, swapping these two statements
  //     keeps both headers -- verified by mutating the order and watching the
  //     test still pass.
  // What does break is assigning requestHeaders WITHOUT spreading the current
  // value: that silently drops the authorization header addAuthHeader put
  // there, and the app starts taking 403s. updater.test.ts asserts on the
  // final object for exactly that reason.
  // Both are read lazily, at check and download time (computeFinalHeaders /
  // computeRequestHeaders), so mutating them after setFeedURL still applies to
  // the very first check.
  //
  // Accepted and deliberate: the key ships inside the asar and can be
  // extracted. This is identification with server-side revocation, not
  // secrecy.
  autoUpdater.addAuthHeader(`Bearer ${GIROVEST_UPDATE_KEY}`)
  autoUpdater.requestHeaders = {
    ...autoUpdater.requestHeaders,
    'X-Girovest-Install': installId,
  }

  // Mandatory: autoUpdater is an EventEmitter, and an 'error' emission with
  // no listener is an uncaught exception — a crash dialog for an offline
  // shop. Log and wait for the next interval instead.
  autoUpdater.on('error', (error) => {
    log.warn('Auto-update error (will retry on next interval):', error)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (promptedVersion === info.version) return
    promptedVersion = info.version
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Atualização pronta',
      message: `A versão ${info.version} foi baixada.`,
      detail:
        'Reinicie agora para aplicar a atualização, ou continue trabalhando — ela será instalada quando você fechar o aplicativo.',
      buttons: ['Reiniciar agora', 'Mais tarde'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })

  // checkForUpdates() both emits 'error' AND rejects its promise on failure;
  // the event handler above already logs, so swallow the rejection.
  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
