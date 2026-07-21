# Electron Offline-App Packaging — Design

## Problem

The Electron wrapper built in the frontend plan (`client/electron/`) proves
the architecture works — `electron:dev` launches the app and it spawns the
backend — but it can't be handed to a client. Three things stop it from
being a real distributable:

- `main.ts` spawns `node dist/server.js`, assuming the machine running it
  has Node.js installed. A client's Windows or Linux machine won't.
- There is no packaging step at all. `electron:build` (`electron-vite
  build`) only produces `client/out/` — main/preload/renderer bundles, not
  an installer or runnable standalone app.
- There is no way to create the first `Location`/`Staff` row without
  running a script by hand (`server/seed-staff.ts`) — fine for us, not for
  a non-technical client's first launch.

This spec covers making the offline app fully self-contained and shippable
as a Windows and Linux installer, requiring nothing but double-clicking an
installer on the client's machine.

## Goals

- A client can install and run the app on Windows or Linux with zero
  prerequisites — no Node, no npm, no manual DB setup.
- First launch walks them through creating their shop's first login, not a
  script.
- Data persists in a proper per-user location and survives app updates.
- Builds are produced by CI (GitHub Actions), one native runner per target
  platform — no cross-compilation.

## Non-goals (v1)

- macOS support (Gatekeeper/notarization is real added cost and friction;
  revisit later if a Mac client shows up).
- Auto-updates (`electron-updater` / update feed). Distribution is manual:
  a new installer per release.
- Code signing. Windows SmartScreen's "more info → run anyway" click-through
  is accepted for v1; Linux has no equivalent friction.
- ARM builds — GitHub's hosted runners are x64; that covers the vast
  majority of desktop/laptop targets.
- Multi-location/multi-tenant support beyond what already exists (each
  install is one shop, one local DB — unchanged from today's model).
- Anything about the *hosted web* deployment mode (centralized Postgres,
  remote access) — that's a separate spec, deliberately out of scope here.

## Architecture

### Self-contained server execution

`main.ts` currently does:

```ts
serverProcess = spawn('node', ['dist/server.js'], { cwd: serverCwd, env: {...} })
```

This changes to run the server on Electron's own bundled Node/V8 instead of
a system install:

```ts
spawn(process.execPath, ['dist/server.js'], {
  cwd: serverCwd,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DB_PROVIDER: 'sqlite',
    DATABASE_URL,
    JWT_SECRET,
    HOST: '127.0.0.1',
    PORT: '3000',
  },
})
```

`process.execPath` inside the Electron main process is the Electron binary
itself; `ELECTRON_RUN_AS_NODE=1` tells it to behave as a plain Node process
for that invocation. No extra runtime needs to be bundled.

The one real consequence: `bcrypt` and `better-sqlite3` (native modules)
must be compiled against Electron's Node ABI, not the system Node ABI they
get today from a normal `npm install`. `electron-builder` rebuilds native
dependencies against the target Electron version automatically as part of
its packaging step — this isn't something we hand-roll, but it is
something the packaging config must point at correctly (see below), and
it's the reason each CI runner must be native to its target platform
rather than cross-compiling.

### Path resolution: dev vs packaged

`resolveServerCwd(appRoot)` (today: `path.resolve(appRoot, '..', 'server')`)
only works in the dev layout where `client/` and `server/` are sibling
workspace folders. In a packaged app there is no `server/` sibling — the
server's compiled output ships as `extraResources` instead (see Packaging
below). `main.ts` branches:

```ts
const serverCwd = app.isPackaged
  ? path.join(process.resourcesPath, 'server')
  : resolveServerCwd(app.getAppPath())
```

`resolveServerCwd` itself is unchanged and keeps its existing unit test;
the packaged-path branch gets a new one.

### Secret generation

`server/src/auth/jwt.ts` throws if `JWT_SECRET` is unset — true today in
dev (via `.env`) but nothing supplies it for a packaged app. On startup,
`main.ts` checks for `<userData>/jwt-secret`; if absent, generates one
(`crypto.randomBytes(32).toString('hex')`) and writes it there, then reads
whatever is on disk (fresh or pre-existing) and passes it as `JWT_SECRET`
to the spawned server. Generating a new one on every launch instead of
persisting would invalidate every staff member's session on every restart
— it must be written once and reused.

### Network binding

`server/src/server.ts` currently calls `app.listen(port)` with no host,
which binds `0.0.0.0` — reachable from any other machine on the same LAN,
and the reason Windows Defender Firewall prompts ("allow this app to
communicate on public/private networks?") on first launch. For a
single-shop offline app this is both an unnecessary exposure (the
bootstrap-only `/api/setup` window and all authenticated endpoints
shouldn't be network-reachable) and a confusing first-run prompt for a
non-technical client.

Fix: `server.ts` reads an optional `HOST` env var (`app.listen(port, host
?? '0.0.0.0', ...)`), defaulting to today's behavior so nothing else that
depends on this server (e.g. a future hosted-web deployment, out of scope
here) breaks. `main.ts` explicitly sets `HOST: '127.0.0.1'` when spawning
the offline app's server process — no firewall prompt, no LAN exposure.

### Data location & first-run migrations

`app.getPath('userData')` keys off `app.name`, which — unless set
explicitly — Electron resolves from the `name` field of the nearest
`package.json` to the app root. That's `client/package.json`, whose `name`
is `dress-store-client`, not `dress-store-app`; nothing in this design so
far pins it. `main.ts` calls `app.setName('dress-store-app')` before any
`app.getPath(...)` call, so the data directory name is a deliberate
product identity, not an accident of which `package.json` Electron happens
to read.

`DATABASE_URL` is computed from that per-user data directory instead of
the current hardcoded relative path:

```ts
app.setName('dress-store-app')
const dbPath = path.join(app.getPath('userData'), 'dev.db')
const DATABASE_URL = `file:${dbPath}`
```

This resolves to `%APPDATA%\dress-store-app\dev.db` on Windows and
`~/.config/dress-store-app/dev.db` on Linux — writable, persists across
app updates, and isn't inside the (often read-only) install directory.

Uninstalling is a separate question from updating: electron-builder's NSIS
target does not delete `userData` on uninstall unless
`deleteAppDataOnUninstall: true` is set explicitly, so by default a
client's shop data (clients, allocations, the DB file above) survives an
uninstall/reinstall too. That default is intentional here — this is real
business data, not disposable cache — so the NSIS config leaves
`deleteAppDataOnUninstall` unset (i.e. `false`) on purpose, not by
oversight.

Before starting the server, `main.ts` runs `prisma migrate deploy` against
this path (the non-interactive, production migration command) using the
bundled `prisma` package, which moves from `server`'s `devDependencies` to
its regular `dependencies` since it's now needed at runtime, not just in
dev. On a brand-new install this creates the schema from nothing; on an
update to a later version it applies whatever new migrations shipped.
Nobody runs `npm run db:migrate` by hand.

### First-run setup

A fresh DB has no `Location`/`Staff` row, so login is impossible until one
exists. New pieces:

- `GET /api/setup/status` — returns whether any `Location` row exists.
- `POST /api/setup` — accepts a shop name and an owner login/password,
  creates the first `Location` + `Staff` (role `owner`) row. Only usable
  when no `Location` exists yet (returns an error otherwise — this is a
  one-time bootstrap endpoint, not a general admin-creation API).
- Client: a new route/screen ("Configurar loja") gates in front of
  `/login` — on load, calls `/api/setup/status`; if empty, shows the setup
  form instead of redirecting to login; on success, redirects to login as
  normal.

This is real feature work, not just packaging config — smallest version
that removes the "run a script" step entirely.

## Packaging

`electron-builder` (over Electron Forge) — its `extraResources` config is
a direct fit for shipping the server's build output as real files outside
the asar archive (asar-packed files aren't independently spawnable by the
OS, which matters since we spawn the server as a separate process rather
than requiring it in-process).

Sketch of the relevant `electron-builder` config (exact placement —
`client/package.json`'s `build` key vs. a standalone `electron-builder.yml`
— decided during implementation):

```jsonc
{
  "extraResources": [
    { "from": "../server/dist", "to": "server/dist" },
    { "from": "../server/node_modules", "to": "server/node_modules" },
    { "from": "../server/prisma", "to": "server/prisma" },
    { "from": "../server/prisma.config.ts", "to": "server/prisma.config.ts" }
  ],
  "win": { "target": "nsis" },
  "linux": { "target": "AppImage" }
}
```

`prisma.config.ts` (server root, not under `prisma/`) must ship alongside
the schema/migrations — it's what picks the SQLite schema and migrations
path at runtime based on `DB_PROVIDER`; there is no `prisma/schema.prisma`
at Prisma's conventional default location, so without this file `prisma
migrate deploy` falls back to Prisma's default lookup and finds nothing.
Missing this breaks first launch before the setup screen ever loads.

Windows gets an NSIS installer (Start Menu entry, uninstaller — the
familiar double-click-to-install experience). Linux gets an AppImage — a
single portable executable, no install step, no signing, runs on most
distros without root.

Only `server`'s production `node_modules` should ship (no `devDependencies`
— `prisma`'s CLI is the one exception already called out above, needed at
runtime). The build step must run something equivalent to `npm ci --omit=dev`
in `server/` before packaging so `extraResources` doesn't ship dev tooling.

## CI/CD pipeline

GitHub Actions matrix, one native runner per target — no cross-compilation,
so native-module rebuilds are never a guessing game:

```yaml
strategy:
  matrix:
    os: [windows-latest, ubuntu-latest]
runs-on: ${{ matrix.os }}
```

Per-runner steps: install workspace deps → build `server` (`tsc`) → prune
`server/node_modules` to production-only → build `client` (`electron-vite
build`) → `electron-builder` for that runner's platform → upload the
resulting installer/AppImage as a build artifact. Triggered manually or on
a tag push (exact trigger decided during implementation) — there's no
auto-update feed to publish to, so "artifact per build" is sufficient for
manual distribution.

## Testing

- `client/electron/main.test.ts` gains cases for the new packaged-path
  branch (`app.isPackaged` true → resources path) and the `DATABASE_URL`
  computation from `app.getPath('userData')` — both pure-function-testable
  without a real Electron runtime, following the existing pattern for
  `resolveServerCwd`.
- New backend tests for `GET /api/setup/status` and `POST /api/setup`
  (empty-DB and already-has-a-location cases), alongside the existing
  `authRoutes.test.ts` suite.
- New frontend tests for the setup screen (renders when status is empty,
  redirects to login when a location already exists, submits and
  redirects on success) — same testing-library patterns already used
  throughout `client/src/features/`.
- No automated test can verify the actual packaged installer runs on a
  clean Windows/Linux machine — that's a manual verification step per
  release (install on a machine with nothing else on it, confirm first-run
  setup → login → core workflow).

## Open risks

- `better-sqlite3`/`bcrypt` prebuilt-binary availability for Electron's
  exact ABI on both target platforms is assumed, not yet verified —
  `electron-builder`'s automatic rebuild step should handle it, but the
  first real CI run is the actual test.
- AppImage's own recommended practice (bundling most system libraries) can
  make it fairly large; acceptable for v1, not optimized.
- Port 3000 already in use (a stale server process from an unclean
  previous shutdown, or an unrelated local app) isn't handled — v1 answer
  is to fail loudly (the spawned process's `error`/exit event surfaces as
  a visible Electron error dialog rather than a silent hang) rather than
  retry on another port or detect/kill a stale process.
- The port number itself is duplicated in two independent, build-time
  locations, not plumbed through one source of truth: `main.ts`'s spawn
  env (`PORT: '3000'`) and `client/src/lib/api.ts`'s `VITE_API_BASE_URL`
  fallback (`http://localhost:3000`, baked into the renderer bundle at
  build time). Changing the port later — e.g. to work around a collision
  — means updating both by hand; v1 accepts this rather than introducing
  a shared config mechanism for a value that isn't expected to change.
