import { prisma } from '../db/client.js'
import { fromCentavos, toCentavos } from '../lib/money.js'

/**
 * One-time conversion from the old fixed-installment schedule to the
 * free-form Payment ledger: every Installment already marked `paid` becomes
 * a Payment (same amount, same date it was actually paid); an unpaid one
 * carried no real payment and is simply dropped, since there is no more
 * schedule for it to belong to.
 *
 * Idempotent because each row's conversion is ATOMIC: the Payment insert and
 * the Installment delete commit together or not at all, so a rerun's
 * `findMany` only ever comes back with rows that were never converted.
 *
 * The two used to be bare sequential awaits, and the comment here claimed
 * idempotency anyway. They are not the same thing: this runs before
 * `app.listen` (server.ts), so a forced Windows update, a power cut, or the
 * owner closing an Electron window that looks stuck between the insert and the
 * delete left the Payment written and the Installment still standing — and the
 * next boot converted it a second time. A R$ 400,00 parcel counted twice
 * against a R$ 900,00 contract makes the shop under-collect R$ 400,00, or flip
 * a settled contract to "Devolver". Money duplicated by a crash, from the one
 * path in the app that runs unattended.
 *
 * Per-row rather than one transaction over the whole set, deliberately: the
 * shop PC's migration runner has no transactions of its own, the row count can
 * be large, and a partial run is safe here precisely BECAUSE each row is
 * all-or-nothing — an interrupted backfill simply resumes where it stopped.
 *
 * `Installment` stays a valid Prisma model — see the doc comment on it in
 * models.prisma — purely so this can still run via Prisma Client on an
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
    await prisma.$transaction(async (tx) => {
      if (installment.paid) {
        await tx.payment.create({
          data: {
            contractId: installment.contractId,
            // Quantised like every other Payment write. Legacy installment
            // amounts came from an integer-cent split so they are already
            // whole centavos in practice, but this is the one path that runs
            // unattended against arbitrary old data, and it was the only
            // Payment write not enforcing the invariant.
            amount: fromCentavos(toCentavos(installment.amount)),
            method: installment.contract.paymentMethod,
            paidAt: installment.paidAt ?? installment.dueDate,
          },
        })
      }
      await tx.installment.delete({ where: { id: installment.id } })
    })
  }
}
