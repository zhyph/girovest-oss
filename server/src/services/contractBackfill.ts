import { prisma } from '../db/client.js'
import { DEFAULT_CONTRACT_CLAUSES } from '../constants/defaultContractClauses.js'

async function backfillOrphanAllocations(): Promise<void> {
  const orphans = await prisma.allocation.findMany({
    where: { contractId: null },
    include: { product: true },
    orderBy: { createdAt: 'asc' },
  })
  if (orphans.length === 0) return

  const orphansByLocation = new Map<string, typeof orphans>()
  for (const orphan of orphans) {
    const list = orphansByLocation.get(orphan.product.locationId) ?? []
    list.push(orphan)
    orphansByLocation.set(orphan.product.locationId, list)
  }

  for (const [locationId, locationOrphans] of orphansByLocation) {
    const lastContract = await prisma.contract.findFirst({
      where: { locationId },
      orderBy: { number: 'desc' },
    })
    let nextNumber = (lastContract?.number ?? 0) + 1

    for (const orphan of locationOrphans) {
      await prisma.contract.create({
        data: {
          number: nextNumber,
          locationId,
          clientId: orphan.clientId,
          staffId: orphan.staffId,
          eventDate: orphan.checkoutDate,
          paymentMethod: '(não informado)',
          allocations: { connect: { id: orphan.id } },
        },
      })
      nextNumber += 1
    }
  }
}

async function seedMissingClauses(): Promise<void> {
  const locationsWithoutClauses = await prisma.location.findMany({
    where: { contractClauses: { none: {} } },
  })
  for (const location of locationsWithoutClauses) {
    await prisma.locationContractClause.createMany({
      data: DEFAULT_CONTRACT_CLAUSES.map((text, index) => ({ locationId: location.id, text, sortOrder: index })),
    })
  }
}

export async function runContractBackfill(): Promise<void> {
  await backfillOrphanAllocations()
  await seedMissingClauses()
}
