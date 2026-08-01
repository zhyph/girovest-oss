import { prisma } from './client.js'

// Models routed through scopedDb: every query/write against them is
// automatically scoped to the given locationId. Add a model here only if
// its normal access pattern always has a known locationId in hand (i.e. an
// authenticated request, or another already-scoped lookup).
export const LOCATION_SCOPED_MODELS = ['client', 'product'] as const

// Models that carry a locationId column (see MODELS_WITH_LOCATION_ID_COLUMN)
// but are deliberately NOT routed through scopedDb, each with why. These are
// scoped by hand at their own call sites instead.
export const MANUALLY_SCOPED_MODELS: Readonly<Record<string, string>> = {
  staff: 'queried unscoped at login (authRoutes.ts), before any location is known',
  contract: 'already scoped by hand via explicit where: { locationId } clauses in contractService.ts',
  locationContractClause: 'already scoped by hand alongside Contract',
  productPhotoToken: 'looked up by token on unauthenticated paths with no req.staff',
}

// Every model in models.prisma that carries a locationId column, whether or
// not it's routed through scopedDb. Cross-checked against the real schema
// file by a test in this suite (see scopedClient.registry.test.ts) — this
// list is the deny-by-default backstop for Goal 2 ("a new model can't
// reintroduce this bug silently"): a model with a locationId column that
// lands in neither LOCATION_SCOPED_MODELS nor MANUALLY_SCOPED_MODELS throws.
export const MODELS_WITH_LOCATION_ID_COLUMN: ReadonlySet<string> = new Set([
  'staff',
  'product',
  'contract',
  'productPhotoToken',
  'locationContractClause',
  'client',
])

const OPERATIONS_MERGING_WHERE = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
])

function toModelKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}

// Limitations (read before using scopedDb for anything involving relations):
//
// This extension only intercepts top-level delegate calls (e.g.
// `scopedDb(id).client.findMany(...)`). It does NOT intercept nested reads
// or writes that travel through a relation on another model's query:
//
//   - `include`/`select` on a relation (e.g.
//     `scopedDb(A).allocation.findMany({ include: { client: true, product: true } })`)
//     returns the related Client/Product rows completely unscoped — a
//     location-B client or product on a location-A allocation comes back
//     unfiltered.
//   - `connect`/nested `create` on a relation (e.g.
//     `scopedDb(A).allocation.create({ data: { client: { connect: { id: <B's client> } } } })`)
//     succeeds even when the connected row belongs to a different location.
//
// This is inherent to how Prisma's `$allOperations` query extension hooks
// work (it only sees the outer operation, not relation traversal), not a
// bug in this file. Any code that includes or connects a Client/Product
// relation through a non-scoped-model query must verify the related row's
// locationId by hand before doing so. See the design doc
// (docs/superpowers/specs/2026-07-31-location-scoping-design.md, §4) for
// the same caveat documented against contractService.getContract's nested
// include.
export function scopedDb(locationId: string) {
  return prisma.$extends({
    name: 'scopedDb',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const modelKey = toModelKey(model)

          if ((LOCATION_SCOPED_MODELS as readonly string[]).includes(modelKey)) {
            const scopedArgs: any = args
            if (operation === 'create') {
              scopedArgs.data = { ...scopedArgs.data, locationId }
            } else if (operation === 'createMany') {
              scopedArgs.data = Array.isArray(scopedArgs.data)
                ? scopedArgs.data.map((row: Record<string, unknown>) => ({ ...row, locationId }))
                : { ...scopedArgs.data, locationId }
            } else if (OPERATIONS_MERGING_WHERE.has(operation)) {
              scopedArgs.where = { ...scopedArgs.where, locationId }
            } else {
              throw new Error(
                `scopedDb: unhandled operation "${operation}" on scoped model "${model}" — ` +
                  'add explicit handling in scopedClient.ts before using it.',
              )
            }
            return query(scopedArgs)
          }

          if (Object.prototype.hasOwnProperty.call(MANUALLY_SCOPED_MODELS, modelKey)) {
            return query(args)
          }

          if (MODELS_WITH_LOCATION_ID_COLUMN.has(modelKey)) {
            throw new Error(
              `scopedDb: model "${model}" carries a locationId column but is registered in ` +
                'neither LOCATION_SCOPED_MODELS nor MANUALLY_SCOPED_MODELS in scopedClient.ts.',
            )
          }

          return query(args)
        },
      },
    },
  })
}
