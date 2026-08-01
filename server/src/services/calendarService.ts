import { prisma } from '../db/client.js'

export function listGoingOut(locationId: string, from: Date, to: Date) {
  return prisma.allocation.findMany({
    where: {
      status: 'reserved',
      checkoutDate: { gte: from, lte: to },
      product: { locationId },
    },
    orderBy: { checkoutDate: 'asc' },
  })
}

export function listDueBack(locationId: string, from: Date, to: Date) {
  return prisma.allocation.findMany({
    where: {
      status: 'checked_out',
      dueDate: { gte: from, lte: to },
      product: { locationId },
    },
    orderBy: { dueDate: 'asc' },
  })
}

export function listOverdue(locationId: string, asOf: Date = new Date()) {
  return prisma.allocation.findMany({
    where: {
      status: 'checked_out',
      dueDate: { lt: asOf },
      product: { locationId },
    },
    orderBy: { dueDate: 'asc' },
  })
}
