import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, ApiError } from './api.ts'
import { setToken, getToken } from './auth.ts'

describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches the Authorization header when a token exists', async () => {
    setToken('my-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    await apiFetch('/api/clients')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer my-token')
  })

  it('throws ApiError with the backend code and message on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Invalid payload' }), {
        status: 400,
      }),
    )

    await expect(apiFetch('/api/clients')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid payload',
    })
  })

  it('clears the token on a 401 response', async () => {
    setToken('stale-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Invalid token' }), {
        status: 401,
      }),
    )

    await expect(apiFetch('/api/clients')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
  })
})
