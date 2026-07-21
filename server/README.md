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
there's no automatic seed. Manual testing (curl, or the client's E2E test)
needs at least one `Location` and one `Staff` row to log in against. Seed
them with:

```bash
npx tsx seed-e2e.ts
```

This creates a `Location` and a `Staff` row (login `e2e-staff`, password
`e2e-password12`) via the same Prisma client the server uses, matching
`client/e2e/happy-path.spec.ts`'s precondition. It's a one-off script, not
part of the app — safe to re-run against a fresh `dev.db`, but will fail
with a unique-constraint error if the login already exists.
