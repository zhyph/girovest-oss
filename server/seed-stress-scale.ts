import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'

// One-off performance investigation script — NOT part of the e2e suite.
// Seeds at real client-reported scale (~1500 products, hundreds of clients,
// 300+ contracts on a single busy day) with real, varied JPEG photos so
// image-loading cost is genuinely exercised, not just DB row count.
//
// Usage: npx tsx seed-stress-scale.ts <photo-pool-dir>
// photo-pool-dir must contain pool-1.jpg .. pool-N.jpg (real distinct JPEGs).

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const staff = await prisma.staff.findUnique({ where: { login: 'e2e-staff' } })
if (!staff) {
  throw new Error('e2e-staff not found — run `npx tsx seed-e2e.ts` first.')
}

const poolDir = process.argv[2]
if (!poolDir || !fs.existsSync(poolDir)) {
  throw new Error('Usage: npx tsx seed-stress-scale.ts <photo-pool-dir-with-pool-N.jpg-files>')
}
const poolFiles = fs.readdirSync(poolDir).filter((f) => /^pool-\d+\.jpg$/.test(f))
if (poolFiles.length === 0) {
  throw new Error(`No pool-N.jpg files found in ${poolDir}`)
}
console.log(`Photo pool: ${poolFiles.length} distinct real images from ${poolDir}`)

const PRODUCT_COUNT = 1500
const CLIENT_COUNT = 300
const BUSY_DAY_CONTRACT_COUNT = 320

const photosDir = process.env.PRODUCT_PHOTOS_DIR ?? './product-photos'
fs.mkdirSync(photosDir, { recursive: true })

function assignPhotos(productId: string, index: number): string {
  const photoCount = (index % 3) + 1 // 1, 2, or 3 photos, cycling
  const filenames: string[] = []
  for (let p = 0; p < photoCount; p += 1) {
    const poolFile = poolFiles[(index * 7 + p * 13) % poolFiles.length]
    const filename = `${crypto.randomUUID()}.jpg`
    fs.copyFileSync(path.join(poolDir, poolFile), path.join(photosDir, filename))
    filenames.push(filename)
  }
  return JSON.stringify(filenames.map((filename) => `/api/products/${productId}/photos/${filename}`))
}

console.log(`Seeding ${PRODUCT_COUNT} products with real photos (this copies files, will take a bit)...`)
const categories = ['festa', 'casamento', 'debutante', 'formatura', 'coquetel']
const sizes = ['PP', 'P', 'M', 'G', 'GG']
const colors = ['azul', 'vermelho', 'verde', 'rosa', 'dourado', 'prata', 'preto', 'branco']

const productIds: string[] = []
for (let i = 1; i <= PRODUCT_COUNT; i += 1) {
  const id = `stress-product-${i}`
  productIds.push(id)
  await prisma.product.upsert({
    where: { id },
    update: {},
    create: {
      id,
      locationId: staff.locationId,
      name: `Vestido Stress Scale ${i}`,
      category: categories[i % categories.length],
      size: sizes[i % sizes.length],
      color: colors[i % colors.length],
      rentalPrice: 150 + (i % 400),
      depositAmount: 80 + (i % 150),
      photos: assignPhotos(id, i),
    },
  })
  if (i % 200 === 0) console.log(`  ${i}/${PRODUCT_COUNT} products...`)
}

console.log(`Seeding ${CLIENT_COUNT} clients...`)
const clientIds: string[] = []
for (let i = 1; i <= CLIENT_COUNT; i += 1) {
  const id = `stress-client-${i}`
  clientIds.push(id)
  await prisma.client.upsert({
    where: { id },
    update: {},
    create: {
      id,
      name: `Cliente Stress Scale ${i}`,
      phone: `11${String(900000000 + i).slice(-9)}`,
      email: `stress-scale-${i}@example.com`,
    },
  })
}

console.log(`Seeding ${BUSY_DAY_CONTRACT_COUNT} contracts on a single busy day, each with a distinct product...`)
const busyEventDate = new Date('2027-06-15')
const busyCheckoutDate = new Date('2027-06-12')
const busyDueDate = new Date('2027-06-19')

for (let i = 1; i <= BUSY_DAY_CONTRACT_COUNT; i += 1) {
  const client = clientIds[i % clientIds.length]
  const product = productIds[i % productIds.length]
  const contractId = `stress-contract-${i}`
  await prisma.contract.upsert({
    where: { id: contractId },
    update: {},
    create: {
      id: contractId,
      number: 60000 + i,
      locationId: staff.locationId,
      clientId: client,
      staffId: staff.id,
      eventDate: busyEventDate,
      paymentMethod: i % 2 === 0 ? 'PIX' : 'CARTAO',
    },
  })
  await prisma.allocation.upsert({
    where: { id: `stress-allocation-${i}` },
    update: {},
    create: {
      id: `stress-allocation-${i}`,
      productId: product,
      clientId: client,
      staffId: staff.id,
      contractId,
      checkoutDate: busyCheckoutDate,
      dueDate: busyDueDate,
      status: 'reserved',
      priceCharged: 200,
    },
  })
  if (i % 100 === 0) console.log(`  ${i}/${BUSY_DAY_CONTRACT_COUNT} contracts...`)
}

console.log(
  `Done: ${PRODUCT_COUNT} products (real photos, avg ~2/product), ${CLIENT_COUNT} clients, ${BUSY_DAY_CONTRACT_COUNT} contracts on 2027-06-15 (calendar checkout window 2027-06-12..2027-06-19).`,
)
await prisma.$disconnect()
