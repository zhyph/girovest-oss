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

  // The distinction that matters: clearToken() runs on ANY 401, even with
  // suppressAuthLogoutEvent -- that flag only suppresses the global
  // 'auth:logout' event, not the token clear itself. A route with a valid
  // session that fails a SEPARATE business check (e.g. "confirm your
  // current password") has to answer with something other than 401, or a
  // wrong answer on that unrelated check silently logs out an otherwise-
  // still-valid session. Found via exactly that bug in
  // POST /api/auth/recovery-code/rotate.
  it('does NOT clear the token on a 403 response, even with a valid session', async () => {
    setToken('still-valid-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'Invalid password' }), {
        status: 403,
      }),
    )

    await expect(apiFetch('/api/auth/recovery-code/rotate')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBe('still-valid-token')
  })

  it('dispatches auth:logout on a 401 by default', async () => {
    const handler = vi.fn()
    window.addEventListener('auth:logout', handler)
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Invalid token' }), {
        status: 401,
      }),
    )

    await expect(apiFetch('/api/clients')).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledOnce()
    window.removeEventListener('auth:logout', handler)
  })

  // Used by the login flow (useAuth.ts): a 401 from the login POST itself, or
  // from the post-login /me check, is handled locally right there and must
  // not also fire the global session-expiry event -- that would navigate
  // away from /login and clear the query cache mid-attempt, on top of (and
  // racing) the local error handling.
  it('does not dispatch auth:logout on a 401 when suppressed', async () => {
    const handler = vi.fn()
    window.addEventListener('auth:logout', handler)
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'Invalid login or password' }), {
        status: 401,
      }),
    )

    await expect(
      apiFetch('/api/auth/login', {}, { suppressAuthLogoutEvent: true }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
    window.removeEventListener('auth:logout', handler)
  })
})

describe('apiFetch session renewal', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores the token the server hands back on X-Renewed-Token', async () => {
    setToken('old-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'X-Renewed-Token': 'fresh-token' },
      }),
    )

    await apiFetch('/api/clients')

    expect(getToken()).toBe('fresh-token')
  })

  it('leaves the stored token alone when the server sends no renewal', async () => {
    setToken('old-token')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await apiFetch('/api/clients')

    expect(getToken()).toBe('old-token')
  })

  // A 204 returns early, before the body is ever read — a renewal riding on a
  // DELETE must not be dropped on the floor.
  it('stores a renewed token that arrives on a 204 response', async () => {
    setToken('old-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 204, headers: { 'X-Renewed-Token': 'fresh-token' } }),
    )

    await apiFetch('/api/products/abc')

    expect(getToken()).toBe('fresh-token')
  })

  it('does not resurrect the token when a 401 carries a renewal header', async () => {
    setToken('old-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Invalid token' }), {
        status: 401,
        headers: { 'X-Renewed-Token': 'fresh-token' },
      }),
    )

    await expect(apiFetch('/api/clients')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
  })

  // Other suites mock fetch with a bare { ok, status, json } object that has no
  // headers at all; reading them unguarded would break those tests.
  it('tolerates a response object with no headers', async () => {
    setToken('old-token')
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    } as unknown as Response)

    await expect(apiFetch('/api/clients')).resolves.toEqual({ ok: true })
    expect(getToken()).toBe('old-token')
  })
})
