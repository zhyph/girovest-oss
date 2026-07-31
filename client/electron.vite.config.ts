import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    // electron-updater/electron-log/adm-zip are excluded from externalization
    // (i.e. bundled into out/main) because the packaged app ships only
    // out/**/* + package.json — no client node_modules to resolve them from
    // at runtime. adm-zip is pure JS (no native bindings), so bundling it is
    // safe the same way the other two already are.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater', 'electron-log', 'adm-zip'] })],
    ssr: { external: ['electron'] },
    // Update-proxy coordinates, baked into the main bundle at build time (CI
    // supplies them; see electron/updater.ts for how they're used and why an
    // unset build must disable auto-update rather than fall back).
    //
    // JSON.stringify is not optional here: `define` substitutes the raw text
    // of the value into the source, so passing the bare string would emit a
    // bare identifier (`GIROVEST_UPDATE_URL` -> `https://...`) and fail to
    // parse. Defaulting to '' rather than leaving the key out matters too —
    // an omitted key leaves the identifier undeclared, which is a runtime
    // ReferenceError instead of the empty-string check updater.ts expects.
    define: {
      GIROVEST_UPDATE_URL: JSON.stringify(process.env.GIROVEST_UPDATE_URL ?? ''),
      GIROVEST_UPDATE_KEY: JSON.stringify(process.env.GIROVEST_UPDATE_KEY ?? ''),
      // Ed25519 public key (SPKI base64) that verifies activation tokens. Only
      // the public half ships: the app verifies, it never signs. Empty disables
      // the activation lock entirely -- see the `unverifiable` branch in
      // electron/activation.ts.
      GIROVEST_ACTIVATION_PUBKEY: JSON.stringify(process.env.GIROVEST_ACTIVATION_PUBKEY ?? ''),
      // Shown on the activation screen so the shop knows who to call. Not a
      // secret; it is a plain contact string.
      GIROVEST_SUPPORT_CONTACT: JSON.stringify(
        process.env.GIROVEST_SUPPORT_CONTACT ?? 'suporte@girovest',
      ),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          archiveCli: resolve(__dirname, 'electron/archiveCli.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    ssr: { external: ['electron'] },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') },
        // Electron's sandboxed preload loader (the default, safer mode —
        // not disabled here) executes preload scripts as plain scripts, not
        // ES modules, so `export`/`import` syntax fails with a SyntaxError.
        // client/package.json's "type": "module" (needed for main.ts) also
        // pushes electron-vite's preload build to ESM output by default;
        // force it back to CommonJS specifically for this one build target.
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
  },
})
