import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { listGoingOut, listDueBack, listOverdue } from './calendarService.js'

let locationId: string
let staffId: string
let clientId: string
let productId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-cal-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId },
  })
  staffId = staff.id
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
  clientId = client.id
  const product = await prisma.product.create({
    data: { locationId, name: 'Vestido', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50 },
  })
  productId = product.id
})

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('calendarService', () => {
  it('lists reserved allocations checking out within a range', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-09-10'), dueDate: new Date('2026-09-15'),
        status: 'reserved', priceCharged: 100,
      },
    })

    const results = await listGoingOut(new Date('2026-09-01'), new Date('2026-09-30'))
    expect(results).toHaveLength(1)
  })

  it('lists checked_out allocations due back within a range', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-09-01'), dueDate: new Date('2026-09-10'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    const results = await listDueBack(new Date('2026-09-05'), new Date('2026-09-15'))
    expect(results).toHaveLength(1)
  })

  it('lists overdue allocations: checked_out with due date in the past', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'checked_out', priceCharged: 100,
      },
    })

    const results = await listOverdue(new Date('2026-07-17'))
    expect(results).toHaveLength(1)
  })

  it('does not count a returned allocation as overdue', async () => {
    await prisma.allocation.create({
      data: {
        productId, clientId, staffId,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        actualReturnDate: new Date('2026-01-04'),
        status: 'returned', priceCharged: 100,
      },
    })

    const results = await listOverdue(new Date('2026-07-17'))
    expect(results).toHaveLength(0)
  })
})
