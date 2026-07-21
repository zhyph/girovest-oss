import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'

const LOGIN = process.argv[2]
const PASSWORD = process.argv[3]
const NAME = process.argv[4]
const ROLE = (process.argv[5] ?? 'staff') as 'owner' | 'staff'
const LOCATION_ID = process.argv[6]

if (!LOGIN || !PASSWORD || !NAME || !LOCATION_ID) {
  console.error(
    'Usage: npx tsx seed-staff.ts <login> <password> <name> <role: owner|staff> <locationId>',
  )
  process.exit(1)
}

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const passwordHash = await bcrypt.hash(PASSWORD, 10)

const staff = await prisma.staff.create({
  data: { name: NAME, login: LOGIN, passwordHash, role: ROLE, locationId: LOCATION_ID },
})

console.log(`Created staff: ${staff.login} (${staff.role}) at location ${staff.locationId}`)
await prisma.$disconnect()
