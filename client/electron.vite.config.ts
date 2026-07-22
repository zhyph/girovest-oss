import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    // electron-updater/electron-log are excluded from externalization (i.e.
    // bundled into out/main) because the packaged app ships only out/**/* +
    // package.json — no client node_modules to resolve them from at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater', 'electron-log'] })],
    ssr: { external: ['electron'] },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') },
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
