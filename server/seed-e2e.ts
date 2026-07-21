import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const location = await prisma.location.create({
  data: {
    name: 'E2E Test Location',
    address: '123 Test St',
  },
})

const passwordHash = await bcrypt.hash('e2e-password12', 10)

await prisma.staff.create({
  data: {
    name: 'E2E Staff',
    login: 'e2e-staff',
    passwordHash,
    role: 'owner',
    locationId: location.id,
  },
})

console.log('Seeded Location + Staff for E2E test')
await prisma.$disconnect()
