import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { runPaymentBackfill } from './paymentBackfill.js'

afterEach(async () => {
  await prisma.payment.deleteMany()
  await prisma.installment.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

async function seedContract(paymentMethod = 'PIX') {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
  })
  const client = await prisma.client.create({ data: { locationId: location.id, name: 'C', phone: '1', email: 'c@example.com' } })
  return prisma.contract.create({
    data: { number: 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod },
  })
}

describe('runPaymentBackfill', () => {
  it('converts a paid installment into a Payment with the same amount and paidAt', async () => {
    const contract = await seedContract('Dinheiro')
    const paidAt = new Date('2026-08-01T12:00:00Z')
    await prisma.installment.create({
      data: { contractId: contract.id, dueDate: new Date('2026-08-01'), amount: 150, paid: true, paidAt },
    })

    await runPaymentBackfill()

    const payments = await prisma.payment.findMany({ where: { contractId: contract.id } })
    expect(payments).toHaveLength(1)
    expect(payments[0].amount).toBe(150)
    expect(payments[0].paidAt).toEqual(paidAt)
    // No per-installment record of what was actually used, so it falls back
    // to the contract's own agreed method.
    expect(payments[0].method).toBe('Dinheiro')
  })

  it('falls back to the installment dueDate when a paid row somehow has no paidAt', async () => {
    const contract = await seedContract()
    const dueDate = new Date('2026-08-05')
    await prisma.installment.create({
      data: { contractId: contract.id, dueDate, amount: 80, paid: true, paidAt: null },
    })

    await runPaymentBackfill()

    const [payment] = await prisma.payment.findMany({ where: { contractId: contract.id } })
    expect(payment.paidAt).toEqual(dueDate)
  })

  it('drops an unpaid installment without creating a Payment for it', async () => {
    const contract = await seedContract()
    await prisma.installment.create({
      data: { contractId: contract.id, dueDate: new Date('2026-08-10'), amount: 200, paid: false },
    })

    await runPaymentBackfill()

    expect(await prisma.payment.count()).toBe(0)
  })

  it('empties the Installment table either way, paid or not', async () => {
    const contract = await seedContract()
    await prisma.installment.createMany({
      data: [
        { contractId: contract.id, dueDate: new Date('2026-08-01'), amount: 100, paid: true, paidAt: new Date('2026-08-01') },
        { contractId: contract.id, dueDate: new Date('2026-08-15'), amount: 100, paid: false },
      ],
    })

    await runPaymentBackfill()

    expect(await prisma.installment.count()).toBe(0)
  })

  it('is idempotent: running twice does not duplicate Payments', async () => {
    const contract = await seedContract()
    await prisma.installment.create({
      data: { contractId: contract.id, dueDate: new Date('2026-08-01'), amount: 100, paid: true, paidAt: new Date('2026-08-01') },
    })

    await runPaymentBackfill()
    await runPaymentBackfill()

    expect(await prisma.payment.count()).toBe(1)
  })

  it('does nothing when there are no installments left to convert', async () => {
    await expect(runPaymentBackfill()).resolves.toBeUndefined()
    expect(await prisma.payment.count()).toBe(0)
  })
})
