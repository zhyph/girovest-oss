import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'
import { generateRecoveryCode, hashRecoveryCode } from './src/auth/recoveryCodes.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const location = await prisma.location.create({
  data: {
    name: 'E2E Test Location',
    address: '123 Test St',
  },
})

const passwordHash = await bcrypt.hash('e2e-password12', 10)

// A pre-existing recoveryCodeHash, not left null: without it, the very
// first login (authRoutes.ts's backfill) mints one and LoginPage shows the
// one-time reveal screen INSTEAD of the dashboard -- every e2e spec that
// logs in and asserts "Painel — hoje" fails on its first run against a
// freshly-seeded DB, and only passes on Playwright's automatic retry
// (config: retries: 1), invisibly.
await prisma.staff.create({
  data: {
    name: 'E2E Staff',
    login: 'e2e-staff',
    passwordHash,
    role: 'owner',
    locationId: location.id,
    recoveryCodeHash: await hashRecoveryCode(generateRecoveryCode()),
  },
})

console.log('Seeded Location + Staff for E2E test')
await prisma.$disconnect()
