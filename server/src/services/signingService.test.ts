import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { issueSigningToken, checkTokenValidity, submitSignature } from './signingService.js'

let contractId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  const staff = await prisma.staff.create({
    data: { name: 'S', login: `staff-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'staff', locationId: location.id },
  })
  const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@example.com' } })
  const contract = await prisma.contract.create({
    data: {
      number: 1,
      locationId: location.id,
      clientId: client.id,
      staffId: staff.id,
      eventDate: new Date('2026-10-03'),
      paymentMethod: 'PIX',
    },
  })
  contractId = contract.id
})

afterEach(async () => {
  await prisma.signingToken.deleteMany()
  await prisma.installment.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
})

describe('issueSigningToken', () => {
  it('creates a token expiring 15 minutes from now', async () => {
    const before = Date.now()
    const { token, expiresAt } = await issueSigningToken(contractId)

    expect(token.length).toBeGreaterThan(20)
    expect(expiresAt.getTime()).toBeGreaterThan(before + 14 * 60 * 1000)
    expect(expiresAt.getTime()).toBeLessThan(before + 16 * 60 * 1000)
  })

  it('invalidates a previously issued token for the same contract', async () => {
    const first = await issueSigningToken(contractId)
    const second = await issueSigningToken(contractId)

    expect(await checkTokenValidity(first.token)).toBe('not_found')
    expect(await checkTokenValidity(second.token)).toBe('valid')
  })

  it('throws NOT_FOUND for a missing contract', async () => {
    await expect(issueSigningToken('missing-id')).rejects.toThrow(AppError)
  })
})

describe('checkTokenValidity', () => {
  it('returns not_found for an unknown token', async () => {
    expect(await checkTokenValidity('unknown-token')).toBe('not_found')
  })

  it('returns expired for a token past its expiry', async () => {
    const { token } = await issueSigningToken(contractId)
    await prisma.signingToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    expect(await checkTokenValidity(token)).toBe('expired')
  })

  it('returns used for an already-consumed token', async () => {
    const { token } = await issueSigningToken(contractId)
    await submitSignature(token, 'data:image/png;base64,abc')

    expect(await checkTokenValidity(token)).toBe('used')
  })
})

describe('submitSignature', () => {
  it('marks the contract signed and the token used', async () => {
    const { token } = await issueSigningToken(contractId)

    await submitSignature(token, 'data:image/png;base64,abc')

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })
    expect(contract.signatureStatus).toBe('signed')
    expect(contract.signatureImage).toBe('data:image/png;base64,abc')
    expect(contract.signedAt).not.toBeNull()
  })

  it('rejects a second submit with the same token', async () => {
    const { token } = await issueSigningToken(contractId)
    await submitSignature(token, 'data:image/png;base64,abc')

    await expect(submitSignature(token, 'data:image/png;base64,def')).rejects.toThrow(AppError)
  })

  it('rejects an expired token', async () => {
    const { token } = await issueSigningToken(contractId)
    await prisma.signingToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(submitSignature(token, 'data:image/png;base64,abc')).rejects.toThrow(AppError)
  })

  it('rejects an unknown token', async () => {
    await expect(submitSignature('unknown-token', 'data:image/png;base64,abc')).rejects.toThrow(AppError)
  })
})
