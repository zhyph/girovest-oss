import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const staff = await prisma.staff.findUnique({ where: { login: 'e2e-staff' } })
if (!staff) {
  throw new Error('e2e-staff not found — run `npx tsx seed-e2e.ts` first.')
}

const photosDir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
fs.mkdirSync(photosDir, { recursive: true })
const seededFilename = '11111111-1111-1111-1111-111111111111.jpg'
fs.copyFileSync(path.resolve('fixtures/sample-product-photo.jpg'), path.join(photosDir, seededFilename))

const product = await prisma.product.upsert({
  where: { id: 'e2e-calendar-load-product' },
  update: {},
  create: {
    id: 'e2e-calendar-load-product',
    locationId: staff.locationId,
    name: 'Vestido Carga E2E',
    category: 'festa',
    size: 'M',
    color: 'azul',
    rentalPrice: 200,
    depositAmount: 100,
    photos: JSON.stringify([`/api/products/e2e-calendar-load-product/photos/${seededFilename}`]),
  },
})

const client = await prisma.client.upsert({
  where: { id: 'e2e-calendar-load-client' },
  update: {},
  create: {
    id: 'e2e-calendar-load-client',
    locationId: staff.locationId,
    name: 'Cliente Carga E2E',
    phone: '11999990020',
    email: 'calendar-load-e2e@example.com',
  },
})

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
tomorrow.setHours(9, 0, 0, 0)
const dueDate = new Date(tomorrow)
dueDate.setDate(dueDate.getDate() + 4)

const TOTAL = 300
for (let i = 1; i <= TOTAL; i += 1) {
  await prisma.allocation.upsert({
    where: { id: `e2e-calendar-load-allocation-${i}` },
    update: {
      productId: product.id,
      clientId: client.id,
      staffId: staff.id,
      checkoutDate: tomorrow,
      dueDate,
      status: 'reserved',
      priceCharged: 200,
    },
    create: {
      id: `e2e-calendar-load-allocation-${i}`,
      productId: product.id,
      clientId: client.id,
      staffId: staff.id,
      checkoutDate: tomorrow,
      dueDate,
      status: 'reserved',
      priceCharged: 200,
    },
  })
}

console.log(`Seeded ${TOTAL} same-day allocations (checkout ${tomorrow.toISOString().slice(0, 10)}) for calendar load testing.`)
await prisma.$disconnect()
