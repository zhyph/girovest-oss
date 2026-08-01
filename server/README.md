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

## Location scoping

`Client` and `Product` rows belong to a `Location`. Any query or write
against either model must go through `scopedDb(locationId)`
(`src/db/scopedClient.ts`) instead of the bare `prisma` client — it
auto-injects `locationId` into `where`/`data` and throws on any operation
it doesn't explicitly handle, rather than silently running unscoped.
`Allocation`/`Calendar` have no `locationId` column of their own and are
scoped by hand instead, via an explicit `where: { product: { locationId } }`
join (see `allocationService.ts`/`calendarService.ts`) — `scopedDb` can't
reach through a relation, only top-level calls on the model itself.

Run `npm run lint:location-scoping` (an `ast-grep` check, see
`rules/no-unscoped-location-model.yml`) before committing any change that
touches `clientService.ts`/`productService.ts` or adds a new Prisma query
against either model — it fails the build on a bare `prisma.client`/
`prisma.product` call (or `tx.client`/`tx.product` inside a transaction)
outside the few permanently-exempt, individually-commented call sites.

If you add a `locationId` column to a new model, register it in
`scopedClient.ts`'s `LOCATION_SCOPED_MODELS` (routed through `scopedDb`) or
`MANUALLY_SCOPED_MODELS` (scoped by hand elsewhere, with a one-line reason)
— `scopedClient.registry.test.ts` parses `prisma/models.prisma` and fails
if a `locationId`-bearing model isn't registered in exactly one of the two.

Full design rationale: `docs/superpowers/specs/2026-07-31-location-scoping-design.md`.

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
npx tsx seed-e2e-contract-print.ts
```

Seeds two fixed-ID contracts on top of `seed-e2e.ts`'s Location/Staff, used by
`client/e2e/contract-print.spec.ts`: `e2e-print-short-contract` (one item, 3
installments — the original reported print bug) and
`e2e-print-stress-contract` (15 items, 8 installments — a print worst case).
Requires `seed-e2e.ts` to have been run first.

```bash
npx tsx seed-e2e-calendar-load.ts
```

Seeds 300 fixed-ID `Allocation` rows (`e2e-calendar-load-allocation-1..300`), all
on the same day (tomorrow, relative to when the script runs), used by
`client/e2e/calendar-load.spec.ts` to test Agenda/Month view behavior at
volume. Requires `seed-e2e.ts` to have been run first.

```bash
npx tsx seed-e2e-list-layout.ts
```

Seeds 40 fixed-ID products (`e2e-list-layout-product-1..40`), 40 fixed-ID
clients (`e2e-list-layout-client-1..40`), 20 fixed-ID contracts
(`e2e-list-layout-contract-1..20`, one allocation each), and one product with
3 real photo files attached (`e2e-list-layout-photo-product`). Used by
`client/e2e/list-layout.spec.ts` to prove the sticky-header/scrollable-list
layout fix: enough rows to overflow the viewport without it, and enough
photos on one product to test `ProductDrawer`'s footer-overflow fix. Requires
`seed-e2e.ts` **and** `seed-e2e-calendar-load.ts` to have been run first —
`list-layout.spec.ts`'s dashboard-route assertion targets a product
(`Vestido Carga E2E`) that only exists via that seed's data, so skipping it
causes a hard element-not-found failure, not just a thinner test.

```bash
npx tsx seed-stress-scale.ts <photo-pool-dir>
```

One-off performance-investigation seed, not part of the regular e2e suite:
1500 fixed-ID products (`stress-product-1..1500`, each with 1-3 real photo
files copied from the given pool directory — not placeholders, since image
count/size was itself a suspected bottleneck), 300 fixed-ID clients
(`stress-client-1..300`), and 320 fixed-ID contracts + allocations all on one
"busy day" (`stress-contract-1..320`, event date 2027-06-15, checkout window
2027-06-12..2027-06-19), each tied to a distinct product/client so the
Calendar's day view genuinely exercises 300+ distinct authenticated photo
fetches rather than reusing one product's photo. `<photo-pool-dir>` must
contain real `pool-1.jpg`..`pool-N.jpg` files (e.g. downloaded once via
`curl -sL -o pool-$i.jpg "https://picsum.photos/seed/dress-$i/800/1000"`);
the script cycles through the pool and copies each assignment to a fresh
per-product filename, so file count and total photo storage scale exactly
as they would with distinct real per-product photos. Requires `seed-e2e.ts`
to have been run first.

```bash
npx tsx seed-staff.ts <login> <password> <name> <role: owner|staff> <locationId>
```

Adds an additional `Staff` row to an *existing* `Location`.
