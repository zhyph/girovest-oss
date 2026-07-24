# Dress Store Server

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate -- --name init   # only needed once, or when the schema changes
```

`npm install` automatically generates the Prisma client (via the `prepare`
script). If you ever see an error about a missing `generated/prisma`
module, run `npm run db:generate` manually.

## Running

```bash
npm run dev     # start the API with hot reload
npm test        # run the full test suite (uses .env.test, SQLite)
npm run test:postgres   # run the full suite against a throwaway Postgres container (requires Docker)
```

### `HOST` binding and remote signing

`npm run dev` binds to `HOST=127.0.0.1` by default (loopback only), matching
how the packaged Electron app always runs the server — this is also what
lets the QR-code remote-signing feature work locally, since it needs a real
LAN address free to bind to (loopback-only leaves the whole LAN free; see
`server/src/server.ts` for the binding logic).

**Hosted-website deployments must NOT inherit this default.** That mode
(see the root [`README.md`](../README.md)) needs the server reachable from
outside the host machine, which requires binding to all interfaces:

```bash
HOST=0.0.0.0 npm run start   # or omit HOST entirely — 0.0.0.0 is the
                              # fallback in src/server.ts for any run that
                              # doesn't go through `npm run dev`'s override
```

If you ever see `Failed to start signing app on <ip>:<port>: ... EADDRINUSE`
while running `npm run dev`, something set `HOST=0.0.0.0` for that run (or
another process already holds the port) — the main API still starts fine
either way, only the signing app's bind is affected.

### `npm run dev` prints an error when you stop it with Ctrl-C — this is expected

Stopping `npm run dev` (Ctrl-C) reliably prints something like:

```
[tsx] Previous process hasn't exited yet. Force killing...
npm error Lifecycle script `dev` failed with error:
npm error code 130
```

This is harmless and unrelated to anything in this codebase — it's a known,
currently-unresolved interaction between `npm`'s own signal handling (changed
in npm v10.3.0) and `tsx watch`'s dev-mode process supervisor:
[tsx#586](https://github.com/privatenumber/tsx/issues/586). Any process layer
between your shell and `tsx watch` — even bare `npm run dev` with no other
wrapper involved — causes `npm` and the watched child to each receive the
Ctrl-C signal independently; `tsx watch` sees that as an already-in-progress
shutdown and force-kills rather than exiting cleanly. Confirmed (2026-07-24)
that it happens with or without this project's own `HOST`/`cross-env`
plumbing, and that invoking the `tsx` binary with no wrapper at all
(`./node_modules/.bin/tsx watch src/server.ts`) does not show it — but that's
not a viable replacement for `npm run dev` as the documented entry point.
Nothing is left running, no data is at risk, and the server did shut down;
it's just a noisier shutdown message than it needs to be.

## Switching database provider

Set `DB_PROVIDER=sqlite` (default) or `DB_PROVIDER=postgresql` in your env
file, matching `DATABASE_URL` to the provider. The Prisma client is
generated per-provider by `npm run db:schema` (called automatically by
`db:generate`/`db:migrate`).

If `npm run test:postgres` is interrupted (e.g. Ctrl-C) before it finishes
tearing down, the shared generated client may be left in `postgresql`
mode — run `npm run db:generate` (with no `DB_PROVIDER` set, or explicitly
`DB_PROVIDER=sqlite`) to restore it before running `npm test` again.

## Database tools

```bash
npm run db:tools
```

An interactive menu (arrow keys + Enter) for common local tasks: seed an
E2E test account, create a staff login, seed a batch of sample
clients/products/allocations for manual testing, list what currently
exists, or wipe everything (asks for a typed confirmation first). This is
the easiest way to get test data without writing SQL by hand.

For real usage (including the packaged Electron app), the client's own
first-run "Configurar loja" screen creates the first `Location` + owner
`Staff` row through the UI — none of this is needed for that.

### Scripting / automation

The two scripts below back some of the menu's own actions and are also
callable directly, non-interactively:

```bash
npx tsx seed-e2e.ts
```

Creates a `Location` and a `Staff` row (login `e2e-staff`, password
`e2e-password12`) matching `client/e2e/happy-path.spec.ts`'s precondition.
Safe to re-run against a fresh `dev.db`, but fails with a unique-constraint
error if the login already exists.

```bash
npx tsx seed-staff.ts <login> <password> <name> <role: owner|staff> <locationId>
```

Adds an additional `Staff` row to an *existing* `Location`.
