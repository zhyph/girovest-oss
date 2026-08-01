import { describe, expect, it, vi, beforeEach } from 'vitest'
import { resumeRelayConnections, relayCredentialsFromEnv } from './relayResume.js'

vi.mock('../db/client.js', () => ({
  prisma: {
    productPhotoToken: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('./relayRegistry.js', () => ({
  registerRelayConnection: vi.fn(),
}))

const openedTokens: string[] = []
vi.mock('./relayClient.js', () => ({
  openRelayConnection: vi.fn((token: string) => {
    openedTokens.push(token)
    return { close: vi.fn() }
  }),
}))

describe('resumeRelayConnections', () => {
  beforeEach(async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.productPhotoToken.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { token: 'live-1', expiresAt: new Date(Date.now() + 60_000), location: { connectivityMode: 'relay' } },
      { token: 'live-2', expiresAt: new Date(Date.now() + 60_000), location: { connectivityMode: 'relay' } },
    ])
    const { registerRelayConnection } = await import('./relayRegistry.js')
    ;(registerRelayConnection as ReturnType<typeof vi.fn>).mockClear()
    openedTokens.length = 0
  })

  it('registers every resumed connection so each one is closed again', async () => {
    const { registerRelayConnection } = await import('./relayRegistry.js')

    await resumeRelayConnections({ url: 'https://relay.example', productKey: 'k', installId: 'i' })

    expect(registerRelayConnection).toHaveBeenCalledTimes(2)
    expect((registerRelayConnection as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual([
      'live-1',
      'live-2',
    ])
  })

  it('opens a relay connection for every unexpired photo token at a relay-mode location', async () => {
    await resumeRelayConnections({ url: 'https://relay.example', productKey: 'k', installId: 'i' })
    expect(openedTokens).toEqual(['live-1', 'live-2'])
  })

  it('does nothing when credentials are null (LAN mode, or relay not configured)', async () => {
    const result = await resumeRelayConnections(null)
    expect(result).toEqual([])
    expect(openedTokens).toEqual([])
  })

  it('queries only unexpired tokens, selecting each token\'s own location connectivityMode', async () => {
    const { prisma } = await import('../db/client.js')
    await resumeRelayConnections({ url: 'https://relay.example', productKey: 'k', installId: 'i' })
    expect(prisma.productPhotoToken.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { gt: expect.any(Date) } },
      select: { token: true, expiresAt: true, location: { select: { connectivityMode: true } } },
    })
  })

  it('resumes only the relay location\'s token, not the lan location\'s, on boot', async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.productPhotoToken.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { token: 'relay-token', expiresAt: new Date(Date.now() + 60_000), location: { connectivityMode: 'relay' } },
      { token: 'lan-token', expiresAt: new Date(Date.now() + 60_000), location: { connectivityMode: 'lan' } },
    ])
    const { registerRelayConnection } = await import('./relayRegistry.js')

    const connections = await resumeRelayConnections({ url: 'https://relay.example', productKey: 'k', installId: 'i' })

    expect(openedTokens).toEqual(['relay-token'])
    expect(connections).toHaveLength(1)
    expect(registerRelayConnection).toHaveBeenCalledTimes(1)
    expect((registerRelayConnection as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('relay-token')
  })
})

describe('relayCredentialsFromEnv', () => {
  const ENV_KEYS = ['GIROVEST_UPDATE_URL', 'GIROVEST_UPDATE_KEY', 'GIROVEST_INSTALL_ID'] as const

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it('resolves env values with no Prisma/location awareness', async () => {
    process.env.GIROVEST_UPDATE_URL = 'wss://example.com'
    process.env.GIROVEST_UPDATE_KEY = 'k'
    process.env.GIROVEST_INSTALL_ID = 'i'

    const credentials = await relayCredentialsFromEnv()

    expect(credentials).toEqual({ url: 'wss://example.com', productKey: 'k', installId: 'i' })
  })

  it('returns null when an env var is missing', async () => {
    process.env.GIROVEST_UPDATE_URL = 'wss://example.com'
    process.env.GIROVEST_UPDATE_KEY = 'k'
    // GIROVEST_INSTALL_ID intentionally left unset

    const result = await relayCredentialsFromEnv()

    expect(result).toBeNull()
  })

  it('returns null when an env var is present but empty', async () => {
    process.env.GIROVEST_UPDATE_URL = ''
    process.env.GIROVEST_UPDATE_KEY = 'k'
    process.env.GIROVEST_INSTALL_ID = 'i'

    const result = await relayCredentialsFromEnv()

    expect(result).toBeNull()
  })
})
