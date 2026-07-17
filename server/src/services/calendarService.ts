import { prisma } from '../db/client.js'

export function listGoingOut(from: Date, to: Date) {
  return prisma.allocation.findMany({
    where: {
      status: 'reserved',
      checkoutDate: { gte: from, lte: to },
    },
    orderBy: { checkoutDate: 'asc' },
  })
}

export function listDueBack(from: Date, to: Date) {
  return prisma.allocation.findMany({
    where: {
      status: 'checked_out',
      dueDate: { gte: from, lte: to },
    },
    orderBy: { dueDate: 'asc' },
  })
}

export function listOverdue(asOf: Date = new Date()) {
  return prisma.allocation.findMany({
    where: {
      status: 'checked_out',
      dueDate: { lt: asOf },
    },
    orderBy: { dueDate: 'asc' },
  })
}
