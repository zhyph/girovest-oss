import { prisma } from '../db/client.js'

/**
 * The longest-lived relay session is a 12h photo token; 24h of retention
 * comfortably outlives every real session (signing tokens live 15min) while
 * still bounding this table's growth to roughly one server-lifetime's worth
 * of submissions rather than forever.
 */
const RETENTION_MS = 24 * 60 * 60 * 1000

export async function pruneExpiredIdempotencyKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS)
  const result = await prisma.relayIdempotencyKey.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return result.count
}
