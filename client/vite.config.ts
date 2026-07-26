import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // This `build` block only applies to the hosted web build (`vite build`).
  // The packaged Electron app's renderer is built from
  // electron.vite.config.ts's separate `renderer` config, which does not
  // read this file — any renderer build tuning added here needs a matching
  // change there too, or it silently won't ship in the desktop app. (Low
  // stakes for manualChunks specifically: the packaged app loads over
  // file://, where HTTP caching — the whole point of vendor chunking — is
  // moot. Route-level code splitting from app/lazyPages.ts still applies to
  // both, since that comes from source, not this config.)
  build: {
    rollupOptions: {
      output: {
        // Keep the framework/runtime libraries — which change far less often
        // than app code — in their own chunk, separate from the per-route
        // chunks. Browsers can then cache this chunk across app releases
        // instead of redownloading it every time any route's code changes.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/](@tanstack[\\/]react-query|i18next|react-i18next)[\\/]/.test(id)) return 'vendor-data'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**', 'release/**'],
  },
})
