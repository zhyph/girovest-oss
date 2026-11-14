# Dress Store

A rental management app for a dress shop — track clients, products (dresses),
and allocations (who has what, and when it's due back), with a calendar view
of upcoming checkouts and returns.

Ships two ways from the same codebase:

- **Offline desktop app** (Electron + SQLite) — a client installs it and runs
  it locally with no internet access, no separate database to set up.
- **Hosted website** (same server, Postgres) — accessible from anywhere via a
  URL, for shops that want remote/multi-computer access.

The two modes are independent: no data syncing between an offline install and
the hosted site, by design.

> **Open-source edition.** The hosted licensing and update service that the original
> shop deployment uses is not part of this repository. The desktop client's
> activation, update and remote-signing relay code is included and expects an
> external service configured through environment variables (for example
> `GIROVEST_UPDATE_URL`); without one, those features are inactive.

## Structure

npm workspaces monorepo:

- `server/` — Express + Prisma REST API. See [`server/README.md`](server/README.md)
  for setup, running, tests, switching database provider, and seeding data.
- `client/` — React + TypeScript frontend, built both as a plain web app and
  wrapped in Electron. See [`client/README.md`](client/README.md) for dev,
  build, test, and packaging instructions.

## Quick start (development)

```bash
npm install                          # installs both workspaces
cd server && cp .env.example .env && npm run db:migrate -- --name init
npm run dev --workspace=server       # API on http://localhost:3000
npm run dev --workspace=client       # SPA on http://localhost:5173 (separate terminal)
```

First launch has no shop/login yet — the app walks you through creating one
the first time you visit it (no seed script required for real usage). See
`server/README.md`'s seeding section if you specifically need scripted test
data instead.

## Design docs

- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design specs for each
  major piece of work (whole-app architecture, frontend, Electron packaging).
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — the implementation
  plans built from those specs.
