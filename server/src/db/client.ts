import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'

function buildAdapter() {
  if (process.env.DB_PROVIDER === 'postgresql') {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL must be set when DB_PROVIDER=postgresql')
    }
    return new PrismaPg({ connectionString })
  }
  return new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
}

export const prisma = new PrismaClient({ adapter: buildAdapter() })
