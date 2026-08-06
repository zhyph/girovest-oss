import { prisma } from '../db/client.js'

/**
 * One-time conversion from the old fixed-installment schedule to the
 * free-form Payment ledger: every Installment already marked `paid` becomes
 * a Payment (same amount, same date it was actually paid); an unpaid one
 * carried no real payment and is simply dropped, since there is no more
 * schedule for it to belong to.
 *
 * Naturally idempotent the same way backfillOrphanAllocations is: every row
 * this function touches is deleted once it's been converted (or found to
 * need no conversion), so a rerun's `findMany` comes back empty and it's a
 * no-op. `Installment` stays a valid Prisma model — see the doc comment on
 * it in models.prisma — purely so this can still run via Prisma Client on an
 * install that hasn't been through it yet.
 *
 * `method` has no real per-installment record of what was actually used —
 * the old schema never asked — so it falls back to the contract's own
 * `paymentMethod`, the closest available fact.
 */
export async function runPaymentBackfill(): Promise<void> {
  const installments = await prisma.installment.findMany({
    include: { contract: { select: { paymentMethod: true } } },
  })
  if (installments.length === 0) return

  for (const installment of installments) {
    if (installment.paid) {
      await prisma.payment.create({
        data: {
          contractId: installment.contractId,
          amount: installment.amount,
          method: installment.contract.paymentMethod,
          paidAt: installment.paidAt ?? installment.dueDate,
        },
      })
    }
    await prisma.installment.delete({ where: { id: installment.id } })
  }
}
