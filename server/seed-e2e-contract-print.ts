import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'
import { DEFAULT_CONTRACT_CLAUSES } from './src/constants/defaultContractClauses.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const staff = await prisma.staff.findUnique({ where: { login: 'e2e-staff' } })
if (!staff) {
  throw new Error('e2e-staff not found — run `npx tsx seed-e2e.ts` first.')
}

// Use the real production clause text (not shorter placeholders) — this is
// what actually reproduces the reported print overflow; see
// docs/superpowers/specs/2026-07-24-contract-print-a4-design.md.
// SQLite doesn't support `skipDuplicates` on createMany, so upsert one at a time.
for (let i = 0; i < DEFAULT_CONTRACT_CLAUSES.length; i += 1) {
  // `update` syncs text/sortOrder on every run, not just `{}` — a dev.db seeded
  // by an older version of this script (shorter placeholder clause text) would
  // otherwise keep the stale text forever, since the id already exists.
  await prisma.locationContractClause.upsert({
    where: { id: `e2e-print-clause-${i + 1}` },
    update: { locationId: staff.locationId, sortOrder: i, text: DEFAULT_CONTRACT_CLAUSES[i] },
    create: { id: `e2e-print-clause-${i + 1}`, locationId: staff.locationId, sortOrder: i, text: DEFAULT_CONTRACT_CLAUSES[i] },
  })
}

const client = await prisma.client.upsert({
  where: { id: 'e2e-print-client' },
  update: {},
  create: {
    id: 'e2e-print-client',
    locationId: staff.locationId,
    name: 'Cliente Impressão E2E',
    phone: '11999990010',
    email: 'print-e2e@example.com',
  },
})

// Short contract: the originally reported bug — one item, a typical 3-installment
// payment plan. Zero installments does NOT reproduce the overflow (verified
// directly): a modest installment table is part of what tips a one-item
// contract onto a 2nd page, alongside the real clause text above.
const shortProduct = await prisma.product.upsert({
  where: { id: 'e2e-print-short-product' },
  update: {},
  create: {
    id: 'e2e-print-short-product',
    locationId: staff.locationId,
    name: 'Vestido Curto Impressão E2E',
    category: 'festa',
    size: 'M',
    color: 'azul',
    rentalPrice: 250,
    depositAmount: 150,
  },
})

const shortContract = await prisma.contract.upsert({
  where: { id: 'e2e-print-short-contract' },
  update: {},
  create: {
    id: 'e2e-print-short-contract',
    number: 9001,
    locationId: staff.locationId,
    clientId: client.id,
    staffId: staff.id,
    eventDate: new Date('2027-03-01'),
    paymentMethod: 'PIX',
  },
})

await prisma.allocation.upsert({
  where: { id: 'e2e-print-short-allocation' },
  update: {},
  create: {
    id: 'e2e-print-short-allocation',
    productId: shortProduct.id,
    clientId: client.id,
    staffId: staff.id,
    contractId: shortContract.id,
    checkoutDate: new Date('2027-02-27'),
    dueDate: new Date('2027-03-02'),
    status: 'reserved',
    priceCharged: 250,
  },
})

const shortInstallments = [
  { dueDate: new Date('2027-01-15'), amount: 100, paid: true },
  { dueDate: new Date('2027-02-01'), amount: 100, paid: false },
  { dueDate: new Date('2027-02-27'), amount: 50, paid: false },
]
for (let i = 0; i < shortInstallments.length; i += 1) {
  await prisma.installment.upsert({
    where: { id: `e2e-print-short-installment-${i + 1}` },
    update: shortInstallments[i],
    create: { id: `e2e-print-short-installment-${i + 1}`, contractId: shortContract.id, ...shortInstallments[i] },
  })
}

// Stress contract: worst case for the print layout — 15 items, 8 installments.
const stressContract = await prisma.contract.upsert({
  where: { id: 'e2e-print-stress-contract' },
  update: {},
  create: {
    id: 'e2e-print-stress-contract',
    number: 9002,
    locationId: staff.locationId,
    clientId: client.id,
    staffId: staff.id,
    eventDate: new Date('2027-03-01'),
    paymentMethod: 'Dinheiro',
  },
})

for (let i = 1; i <= 15; i += 1) {
  const product = await prisma.product.upsert({
    where: { id: `e2e-print-stress-product-${i}` },
    update: {},
    create: {
      id: `e2e-print-stress-product-${i}`,
      locationId: staff.locationId,
      name: `Vestido Stress E2E ${i}`,
      category: 'festa',
      size: 'M',
      color: 'azul',
      rentalPrice: 200 + i,
      depositAmount: 100,
    },
  })
  await prisma.allocation.upsert({
    where: { id: `e2e-print-stress-allocation-${i}` },
    update: {},
    create: {
      id: `e2e-print-stress-allocation-${i}`,
      productId: product.id,
      clientId: client.id,
      staffId: staff.id,
      contractId: stressContract.id,
      checkoutDate: new Date('2027-02-27'),
      dueDate: new Date('2027-03-02'),
      status: 'reserved',
      priceCharged: 200 + i,
    },
  })
}

for (let i = 1; i <= 8; i += 1) {
  await prisma.installment.upsert({
    where: { id: `e2e-print-stress-installment-${i}` },
    update: {},
    create: {
      id: `e2e-print-stress-installment-${i}`,
      contractId: stressContract.id,
      dueDate: new Date(2027, 1, 20 + i),
      amount: 150,
      paid: false,
    },
  })
}

console.log('Seeded e2e-print-short-contract (1 item, 3 installments) and e2e-print-stress-contract (15 items, 8 installments).')
await prisma.$disconnect()
