import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { getLocationSettings, updateLocationSettings } from './locationSettingsService.js'

afterEach(async () => {
  await prisma.locationContractClause.deleteMany()
  await prisma.location.deleteMany()
})

describe('getLocationSettings', () => {
  it('returns the phone and clauses ordered by sortOrder', async () => {
    const location = await prisma.location.create({
      data: {
        name: 'L',
        address: 'A',
        phone: '11987654321',
        contractClauses: {
          create: [
            { text: 'Second clause', sortOrder: 1 },
            { text: 'First clause', sortOrder: 0 },
          ],
        },
      },
    })

    const settings = await getLocationSettings(location.id)

    expect(settings.phone).toBe('11987654321')
    expect(settings.clauses.map((clause) => clause.text)).toEqual(['First clause', 'Second clause'])
  })

  it('throws NOT_FOUND for a missing location', async () => {
    await expect(getLocationSettings('does-not-exist')).rejects.toThrow(AppError)
  })
})

describe('updateLocationSettings', () => {
  it('updates the phone without touching clauses when clauses is omitted', async () => {
    const location = await prisma.location.create({
      data: { name: 'L', address: 'A', contractClauses: { create: [{ text: 'Original', sortOrder: 0 }] } },
    })

    const updated = await updateLocationSettings(location.id, { phone: '11999998888' })

    expect(updated.phone).toBe('11999998888')
    expect(updated.clauses.map((clause) => clause.text)).toEqual(['Original'])
  })

  it('replaces all clauses, in the given order, when clauses is provided', async () => {
    const location = await prisma.location.create({
      data: { name: 'L', address: 'A', contractClauses: { create: [{ text: 'Old clause', sortOrder: 0 }] } },
    })

    const updated = await updateLocationSettings(location.id, {
      clauses: [{ text: 'New first' }, { text: 'New second' }],
    })

    expect(updated.clauses.map((clause) => clause.text)).toEqual(['New first', 'New second'])
    expect(updated.clauses.map((clause) => clause.sortOrder)).toEqual([0, 1])
  })

  it('clears all clauses when given an empty array', async () => {
    const location = await prisma.location.create({
      data: { name: 'L', address: 'A', contractClauses: { create: [{ text: 'Old', sortOrder: 0 }] } },
    })

    const updated = await updateLocationSettings(location.id, { clauses: [] })

    expect(updated.clauses).toEqual([])
  })

  it('throws NOT_FOUND for a missing location', async () => {
    await expect(updateLocationSettings('does-not-exist', { phone: '1' })).rejects.toThrow(AppError)
  })
})
