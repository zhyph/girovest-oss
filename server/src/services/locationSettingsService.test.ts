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

  it('defaults connectivityMode to lan for an existing location', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })

    const settings = await getLocationSettings(location.id)

    expect(settings.connectivityMode).toBe('lan')
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

  it('updates connectivityMode to relay', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })

    const updated = await updateLocationSettings(location.id, { connectivityMode: 'relay' })

    expect(updated.connectivityMode).toBe('relay')
  })
})

describe('editing the shop identity', () => {
  it('reads back the name and address the setup wizard stored', async () => {
    const location = await prisma.location.create({ data: { name: 'Ateliê Rosa', address: 'Rua A, 100' } })

    const settings = await getLocationSettings(location.id)

    expect(settings.name).toBe('Ateliê Rosa')
    expect(settings.address).toBe('Rua A, 100')
  })

  it('updates the name and address without disturbing the other settings', async () => {
    const location = await prisma.location.create({
      data: {
        name: 'Ateliê Rosa',
        address: 'Rua A, 100',
        phone: '11987654321',
        maintenanceBufferDays: 3,
        contractClauses: { create: [{ text: 'Only clause', sortOrder: 0 }] },
      },
    })

    const settings = await updateLocationSettings(location.id, {
      name: 'Ateliê Rosa & Cia',
      address: 'Avenida B, 2000',
    })

    expect(settings.name).toBe('Ateliê Rosa & Cia')
    expect(settings.address).toBe('Avenida B, 2000')
    // The PATCH is partial: omitting a field must leave it alone, not blank it.
    expect(settings.phone).toBe('11987654321')
    expect(settings.maintenanceBufferDays).toBe(3)
    expect(settings.clauses.map((clause) => clause.text)).toEqual(['Only clause'])
  })

  it('leaves the name and address untouched when the payload omits them', async () => {
    const location = await prisma.location.create({ data: { name: 'Ateliê Rosa', address: 'Rua A, 100' } })

    const settings = await updateLocationSettings(location.id, { phone: '11999999999' })

    expect(settings.name).toBe('Ateliê Rosa')
    expect(settings.address).toBe('Rua A, 100')
  })
})
