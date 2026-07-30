import { describe, expect, it, vi } from 'vitest'
import { pruneExpiredIdempotencyKeys } from './relayIdempotencyPrune.js'

vi.mock('../db/client.js', () => ({
  prisma: { relayIdempotencyKey: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) } },
}))

describe('pruneExpiredIdempotencyKeys', () => {
  it('deletes rows older than the retention window and returns the count', async () => {
    const { prisma } = await import('../db/client.js')
    const before = Date.now()
    const deleted = await pruneExpiredIdempotencyKeys()
    const after = Date.now()

    expect(prisma.relayIdempotencyKey.deleteMany).toHaveBeenCalledTimes(1)
    const call = (prisma.relayIdempotencyKey.deleteMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const cutoff = call.where.createdAt.lt as Date
    const RETENTION_MS = 24 * 60 * 60 * 1000
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - RETENTION_MS - 1000)
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - RETENTION_MS + 1000)
    expect(deleted).toBe(3)
  })
})
