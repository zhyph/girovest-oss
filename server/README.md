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

## Switching database provider

Set `DB_PROVIDER=sqlite` (default) or `DB_PROVIDER=postgresql` in your env
file, matching `DATABASE_URL` to the provider. The Prisma client is
generated per-provider by `npm run db:schema` (called automatically by
`db:generate`/`db:migrate`).

If `npm run test:postgres` is interrupted (e.g. Ctrl-C) before it finishes
tearing down, the shared generated client may be left in `postgresql`
mode — run `npm run db:generate` (with no `DB_PROVIDER` set, or explicitly
`DB_PROVIDER=sqlite`) to restore it before running `npm test` again.

## Seeding test data

The dev database (`server/dev.db`, from `npm run db:migrate`) starts empty —
there's no automatic seed. For real usage (including the packaged Electron
app), the client's own first-run "Configurar loja" screen creates the first
`Location` + owner `Staff` row through the UI — no script needed. The two
scripts below exist for manual/automated testing only:

```bash
npx tsx seed-e2e.ts
```

Creates a `Location` and a `Staff` row (login `e2e-staff`, password
`e2e-password12`) via the same Prisma client the server uses, matching
`client/e2e/happy-path.spec.ts`'s precondition. Safe to re-run against a
fresh `dev.db`, but fails with a unique-constraint error if the login
already exists.

```bash
npx tsx seed-staff.ts <login> <password> <name> <role: owner|staff> <locationId>
```

Adds an additional `Staff` row to an *existing* `Location` (there's no UI
for this yet — the in-app setup screen only bootstraps the first shop and
its first owner login).
