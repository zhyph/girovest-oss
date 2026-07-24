import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const staff = await prisma.staff.findUnique({ where: { login: 'e2e-staff' } })
if (!staff) {
  throw new Error('e2e-staff not found — run `npx tsx seed-e2e.ts` first.')
}

// SQLite doesn't support `skipDuplicates` on createMany, so upsert one at a time.
const clauses = [
  { id: 'e2e-print-clause-1', sortOrder: 0, text: 'O item alugado deve ser devolvido limpo e na data combinada.' },
  { id: 'e2e-print-clause-2', sortOrder: 1, text: 'Danos ao item serão descontados do valor do depósito.' },
  { id: 'e2e-print-clause-3', sortOrder: 2, text: 'O atraso na devolução gera multa diária de 10% do valor da diária.' },
  { id: 'e2e-print-clause-4', sortOrder: 3, text: 'Não é permitido repasse do item alugado a terceiros.' },
  { id: 'e2e-print-clause-5', sortOrder: 4, text: 'O cancelamento deve ser feito com no mínimo 7 dias de antecedência.' },
]
for (const clause of clauses) {
  await prisma.locationContractClause.upsert({
    where: { id: clause.id },
    update: {},
    create: { ...clause, locationId: staff.locationId },
  })
}

const client = await prisma.client.upsert({
  where: { id: 'e2e-print-client' },
  update: {},
  create: {
    id: 'e2e-print-client',
    name: 'Cliente Impressão E2E',
    phone: '11999990010',
    email: 'print-e2e@example.com',
  },
})

// Short contract: the originally reported bug — one item, no installments.
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

console.log('Seeded e2e-print-short-contract (1 item) and e2e-print-stress-contract (15 items, 8 installments).')
await prisma.$disconnect()
