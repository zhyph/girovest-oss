import { describe, expect, it, vi, beforeEach } from 'vitest'
import { resumeRelayConnections, relayCredentialsFromEnv } from './relayResume.js'

vi.mock('../db/client.js', () => ({
  prisma: {
    productPhotoToken: {
      findMany: vi.fn().mockResolvedValue([
        { token: 'live-1', expiresAt: new Date(Date.now() + 60_000) },
        { token: 'live-2', expiresAt: new Date(Date.now() + 60_000) },
      ]),
    },
    location: {
      findFirst: vi.fn(),
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
  it('registers every resumed connection so each one is closed again', async () => {
    const { registerRelayConnection } = await import('./relayRegistry.js')
    ;(registerRelayConnection as ReturnType<typeof vi.fn>).mockClear()
    openedTokens.length = 0

    await resumeRelayConnections({ url: 'https://relay.example', productKey: 'k', installId: 'i' })

    expect(registerRelayConnection).toHaveBeenCalledTimes(2)
    expect((registerRelayConnection as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual([
      'live-1',
      'live-2',
    ])
  })

  it('opens a relay connection for every unexpired photo token', async () => {
    openedTokens.length = 0
    await resumeRelayConnections({ url: 'https://relay.example', productKey: 'k', installId: 'i' })
    expect(openedTokens).toEqual(['live-1', 'live-2'])
  })

  it('does nothing when credentials are null (LAN mode, or relay not configured)', async () => {
    openedTokens.length = 0
    const result = await resumeRelayConnections(null)
    expect(result).toEqual([])
    expect(openedTokens).toEqual([])
  })

  it('queries only unexpired tokens', async () => {
    const { prisma } = await import('../db/client.js')
    await resumeRelayConnections({ url: 'https://relay.example', productKey: 'k', installId: 'i' })
    expect(prisma.productPhotoToken.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { gt: expect.any(Date) } },
      select: { token: true, expiresAt: true },
    })
  })
})

describe('relayCredentialsFromEnv', () => {
  const ENV_KEYS = ['GIROVEST_UPDATE_URL', 'GIROVEST_UPDATE_KEY', 'GIROVEST_INSTALL_ID'] as const

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it('returns credentials when connectivityMode is relay and all three env vars are present', async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ connectivityMode: 'relay' })
    process.env.GIROVEST_UPDATE_URL = 'https://relay.example'
    process.env.GIROVEST_UPDATE_KEY = 'secret-key'
    process.env.GIROVEST_INSTALL_ID = 'install-1'

    const result = await relayCredentialsFromEnv()

    expect(result).toEqual({ url: 'https://relay.example', productKey: 'secret-key', installId: 'install-1' })
  })

  it('returns null when connectivityMode is lan even if all env vars are present', async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ connectivityMode: 'lan' })
    process.env.GIROVEST_UPDATE_URL = 'https://relay.example'
    process.env.GIROVEST_UPDATE_KEY = 'secret-key'
    process.env.GIROVEST_INSTALL_ID = 'install-1'

    const result = await relayCredentialsFromEnv()

    expect(result).toBeNull()
  })

  it('returns null when connectivityMode is relay but an env var is missing', async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ connectivityMode: 'relay' })
    process.env.GIROVEST_UPDATE_URL = 'https://relay.example'
    process.env.GIROVEST_UPDATE_KEY = 'secret-key'
    // GIROVEST_INSTALL_ID intentionally left unset

    const result = await relayCredentialsFromEnv()

    expect(result).toBeNull()
  })

  it('returns null when an env var is present but empty', async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ connectivityMode: 'relay' })
    process.env.GIROVEST_UPDATE_URL = ''
    process.env.GIROVEST_UPDATE_KEY = 'secret-key'
    process.env.GIROVEST_INSTALL_ID = 'install-1'

    const result = await relayCredentialsFromEnv()

    expect(result).toBeNull()
  })

  it('returns null when no location row exists', async () => {
    const { prisma } = await import('../db/client.js')
    ;(prisma.location.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    process.env.GIROVEST_UPDATE_URL = 'https://relay.example'
    process.env.GIROVEST_UPDATE_KEY = 'secret-key'
    process.env.GIROVEST_INSTALL_ID = 'install-1'

    const result = await relayCredentialsFromEnv()

    expect(result).toBeNull()
  })
})
