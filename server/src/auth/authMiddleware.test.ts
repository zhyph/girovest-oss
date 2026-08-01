import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { requireAuth } from './authMiddleware.js'
import { signStaffToken } from './jwt.js'

describe('requireAuth', () => {
  let location: { id: string }

  beforeEach(async () => {
    location = await prisma.location.create({ data: { name: 'Loja Auth', address: 'Rua Teste, 9' } })
  })

  afterEach(async () => {
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  it('sets req.staff.locationId from the Staff record', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: `mw-test-${Date.now()}`, passwordHash: 'x', role: 'owner', locationId: location.id },
    })
    const token = signStaffToken({ staffId: staff.id, role: 'owner' })
    const req = { header: (name: string) => (name === 'authorization' ? `Bearer ${token}` : undefined) } as any
    const res = { setHeader: () => {} } as any
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(req.staff).toEqual({ staffId: staff.id, role: 'owner', locationId: location.id })
    expect(next).toHaveBeenCalled()
  })

  it('rejects a token for a staff member who no longer exists', async () => {
    const token = signStaffToken({ staffId: 'does-not-exist', role: 'owner' })
    const req = { header: (name: string) => (name === 'authorization' ? `Bearer ${token}` : undefined) } as any
    const res = { setHeader: () => {} } as any
    const next = vi.fn()

    await expect(requireAuth(req, res, next)).rejects.toThrow(AppError)
    expect(next).not.toHaveBeenCalled()
  })
})
