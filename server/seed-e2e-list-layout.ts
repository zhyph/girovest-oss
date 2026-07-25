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

// Bulk products/clients/contracts, all with fixed IDs, so that the
// Products/Clients/Contracts pages have enough rows to overflow the
// viewport without the sticky-header/scroll-region fix from this plan —
// used by client/e2e/list-layout.spec.ts.
const PRODUCT_COUNT = 40
const CLIENT_COUNT = 40
const CONTRACT_COUNT = 20

for (let i = 1; i <= PRODUCT_COUNT; i += 1) {
  await prisma.product.upsert({
    where: { id: `e2e-list-layout-product-${i}` },
    update: {},
    create: {
      id: `e2e-list-layout-product-${i}`,
      locationId: staff.locationId,
      name: `Vestido Layout E2E ${i}`,
      category: 'festa',
      size: 'M',
      color: 'azul',
      rentalPrice: 200 + i,
      depositAmount: 100,
    },
  })
}

const clients = []
for (let i = 1; i <= CLIENT_COUNT; i += 1) {
  const client = await prisma.client.upsert({
    where: { id: `e2e-list-layout-client-${i}` },
    update: {},
    create: {
      id: `e2e-list-layout-client-${i}`,
      name: `Cliente Layout E2E ${i}`,
      phone: `1199999${String(1000 + i).slice(-4)}`,
      email: `list-layout-e2e-${i}@example.com`,
    },
  })
  clients.push(client)
}

// A product with 2+ real photo files attached — used by list-layout.spec.ts
// to test the ProductDrawer footer-overflow scenario (Salvar must stay
// within the viewport even with several photo thumbnails rendered above it).
const photosDir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
fs.mkdirSync(photosDir, { recursive: true })
const photoProductId = 'e2e-list-layout-photo-product'
const photoFilenames = [
  '22222222-2222-2222-2222-222222222221.jpg',
  '22222222-2222-2222-2222-222222222222.jpg',
  '22222222-2222-2222-2222-222222222223.jpg',
]
for (const filename of photoFilenames) {
  fs.copyFileSync(path.resolve('fixtures/sample-product-photo.jpg'), path.join(photosDir, filename))
}

await prisma.product.upsert({
  where: { id: photoProductId },
  update: {
    photos: JSON.stringify(photoFilenames.map((filename) => `/api/products/${photoProductId}/photos/${filename}`)),
  },
  create: {
    id: photoProductId,
    locationId: staff.locationId,
    name: 'Vestido Fotos Layout E2E',
    category: 'festa',
    size: 'M',
    color: 'verde',
    rentalPrice: 300,
    depositAmount: 150,
    photos: JSON.stringify(photoFilenames.map((filename) => `/api/products/${photoProductId}/photos/${filename}`)),
  },
})

// Contracts, one allocation each, for the Contracts page's default (page 1)
// results to be long enough to overflow the viewport.
for (let i = 1; i <= CONTRACT_COUNT; i += 1) {
  const client = clients[i - 1]
  const contract = await prisma.contract.upsert({
    where: { id: `e2e-list-layout-contract-${i}` },
    update: {},
    create: {
      id: `e2e-list-layout-contract-${i}`,
      number: 9200 + i,
      locationId: staff.locationId,
      clientId: client.id,
      staffId: staff.id,
      eventDate: new Date('2027-04-01'),
      paymentMethod: 'PIX',
    },
  })

  const product = await prisma.product.upsert({
    where: { id: `e2e-list-layout-contract-product-${i}` },
    update: {},
    create: {
      id: `e2e-list-layout-contract-product-${i}`,
      locationId: staff.locationId,
      name: `Vestido Contrato Layout E2E ${i}`,
      category: 'festa',
      size: 'M',
      color: 'azul',
      rentalPrice: 200,
      depositAmount: 100,
    },
  })

  await prisma.allocation.upsert({
    where: { id: `e2e-list-layout-contract-allocation-${i}` },
    update: {},
    create: {
      id: `e2e-list-layout-contract-allocation-${i}`,
      productId: product.id,
      clientId: client.id,
      staffId: staff.id,
      contractId: contract.id,
      checkoutDate: new Date('2027-03-28'),
      dueDate: new Date('2027-04-02'),
      status: 'reserved',
      priceCharged: 200,
    },
  })
}

console.log(
  `Seeded ${PRODUCT_COUNT} products, ${CLIENT_COUNT} clients, ${CONTRACT_COUNT} contracts, and a ${photoFilenames.length}-photo product for list-layout E2E testing.`,
)
await prisma.$disconnect()
