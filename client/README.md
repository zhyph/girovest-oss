# Dress Store Client

React + TypeScript + Vite frontend, built both as a plain web app (hosted
website mode) and wrapped in Electron (offline desktop mode). Tailwind CSS v4,
TanStack Query, react-hook-form + zod, react-i18next (pt-BR), react-router.

## UI components

Uses [shadcn/ui](https://ui.shadcn.com) (config in `components.json`) on top of
the hand-rolled primitives in `src/components/ui/`. The `@/*` import alias maps
to `src/` (see `tsconfig.json` + `vite.config.ts`). shadcn's semantic tokens
(`--primary`, `--border`, `--ring`, ...) are defined in `src/index.css` and
mapped onto the warm-boutique brand palette, so generated components inherit the
existing visual identity rather than the default stone neutrals.

The [React Bits](https://reactbits.dev) animation registry is registered as
`@react-bits` in `components.json`. Add components from either registry with the
shadcn CLI, run from this `client/` workspace so it finds `components.json`:

```bash
npx shadcn@latest add @shadcn/dialog
npx shadcn@latest add @react-bits/FadeContent-TS-TW   # variant suffix: TS-TW = TypeScript + Tailwind
```

Note: the shadcn MCP server resolves `components.json` from its working
directory. In this monorepo it must run with `-c client` (or be launched from
`client/`) — from the repo root it only sees the built-in `@shadcn` registry,
not `@react-bits`.

## Setup

```bash
npm install
```

Talks to the API at `http://localhost:3000` by default — set
`VITE_API_BASE_URL` to point elsewhere. The `server/` workspace needs to be
running (see `../server/README.md`) for anything beyond the login screen to
work.

## Running (web)

```bash
npm run dev           # dev server at http://localhost:5173
npm run build          # tsc -b && vite build -> dist/
npm test               # vitest run
npm run test:watch
npm run test:e2e       # Playwright, against a real running server (see e2e/happy-path.spec.ts)
```

## Running (Electron, offline desktop app)

```bash
npm run electron:dev    # launches the real Electron app; it spawns server/ itself
```

`main.ts` runs the server on Electron's own bundled Node (no system Node
required), auto-migrates the SQLite database into the OS's per-user data
directory, generates and persists its own JWT secret, and binds `127.0.0.1`
only. First launch shows a one-time "Configurar loja" screen to create the
shop's first login — no seed script needed.

### Building an installer

```bash
cd ../server && npm run build
cd ../client
npm run electron:build            # bundles main/preload/renderer via electron-vite
npm run package -- --linux        # or --win (NSIS on Linux needs Wine)
```

`npm run package`'s own `prepackage` hook runs two things automatically first:
- `bundle-server` — esbuild-bundles `server/dist/server.js` into a single
  file, so the packaged app isn't exposed to npm workspace hoisting silently
  dropping a dependency (a real bug this ran into once — see git history on
  `client/electron-builder.yml`).
- `rebuild-server-natives` — rebuilds `bcrypt`/`better-sqlite3` (the only two
  packages that can't be bundled) against Electron's own Node ABI, which
  differs from whatever standalone Node built them originally.

Output lands in `client/release/` (a `.AppImage` on Linux, `.exe`/NSIS
installer on Windows). If Electron's own binary is missing after `npm
install` (a recurring quirk in some environments), run
`node node_modules/electron/install.js` once.

**Known gap:** Windows packaging has never been verified end-to-end on a real
Windows machine — only Linux, locally. The GitHub Actions workflow
(`.github/workflows/electron-build.yml`) builds both platforms in CI, one
native runner each, but hasn't actually been triggered (no git remote
configured in this repo yet).

### Releases

Pushing a tag matching `v*` (e.g. `v1.0.0`) triggers CI to build both
platforms and attach the installers to a **draft** GitHub Release (not
published automatically — review it and hit "Publish" on GitHub yourself). A
manual run of the workflow (`workflow_dispatch`) just builds and uploads to
that Actions run directly, without touching the Releases page.

No extra secrets are needed for this — `GITHUB_TOKEN` is provided
automatically by GitHub Actions. The one thing that **is** required:
`client/package.json`'s `repository` field must point at the real repo.
electron-builder can't auto-detect it from `.git/config` here (this is an
npm workspaces monorepo — `client/` is a subdirectory, not the repo root,
and electron-builder's detection doesn't walk up to find `.git/` the way git
itself does — confirmed by testing it directly, not assumed). It's currently
a placeholder (`placeholder-owner/placeholder-repo`) — update it once the
real repo exists.

## i18n

All user-facing strings go through `react-i18next` (`t('namespace:key')`),
pt-BR only for now — never hardcode Portuguese text directly in JSX. Locale
files live in `src/locales/pt-BR/`, one JSON file per feature namespace,
registered in `src/i18n.ts`.
