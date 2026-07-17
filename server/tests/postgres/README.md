# Postgres parity tests

The hosted build runs on PostgreSQL while local development and the
Electron build run on SQLite. Since Prisma's driver-adapter model means
the two providers are wired up independently (see `src/db/client.ts` and
`prisma/models.prisma`), the full test suite — especially the occupancy/
availability tests in `src/domain/occupancy.test.ts` and
`src/services/allocationService.test.ts` — must also pass against a real
Postgres instance before the hosted build ships. The "identical behavior
across builds" claim in the design doc is only as true as this actually
being run.

Run it with:

    npm run test:postgres

This spins up a throwaway Postgres container (Docker required), pushes
the schema, runs the entire Vitest suite against it, and tears the
container down afterwards. Run this manually before any hosted release;
wiring it into CI is a natural follow-up once CI exists for this
project.
