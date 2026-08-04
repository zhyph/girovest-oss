import { prisma } from '../db/client.js'

/**
 * Gives a `code` to every piece that predates the column.
 *
 * Runs at server startup, not as a migration, for the same two reasons
 * contractBackfill.ts does (see its own header): the Postgres deployment path
 * ships its migrations separately from prisma/sqlite/migrations, so a backfill
 * written as SQL would only ever cover one provider, and the numbering rule
 * would then exist in three places (two SQL dialects plus productService)
 * instead of one.
 *
 * Idempotent: a second run finds nothing with a null code and returns
 * immediately, so booting twice cannot renumber a catalogue.
 */
async function backfillMissingProductCodes(): Promise<void> {
  // ast-grep-ignore: no-unscoped-location-model — Permanently unscoped: a startup backfill covers every location by definition, and there is no request or locationId in hand at boot.
  const missing = await prisma.product.findMany({
    where: { code: null },
    select: { id: true, locationId: true },
    // Oldest first, so the code order matches the order the shop actually
    // acquired its pieces — the number is a human reference, and a catalogue
    // numbered in arbitrary row order would read as noise.
    orderBy: { createdAt: 'asc' },
  })
  if (missing.length === 0) return

  const byLocation = new Map<string, typeof missing>()
  for (const product of missing) {
    byLocation.set(product.locationId, [...(byLocation.get(product.locationId) ?? []), product])
  }

  for (const [locationId, products] of byLocation) {
    // Same `code: { not: null }` guard as productService.createProduct: on
    // Postgres a DESC ordering puts NULLs first, and this query runs against
    // a table that is by definition full of them.
    // ast-grep-ignore: no-unscoped-location-model — Already filters by where: { locationId }; startup path with no request context.
    const last = await prisma.product.findFirst({
      where: { locationId, code: { not: null } },
      orderBy: { code: 'desc' },
      select: { code: true },
    })
    let nextCode = (last?.code ?? 0) + 1

    for (const product of products) {
      // One update per piece rather than one bulk statement: each row needs
      // its own value, and this runs once in the life of an installation.
      // ast-grep-ignore: no-unscoped-location-model — Targets a single id already read from this location's own batch above.
      await prisma.product.update({ where: { id: product.id }, data: { code: nextCode } })
      nextCode += 1
    }
  }
}

export async function runProductBackfill(): Promise<void> {
  await backfillMissingProductCodes()
}
