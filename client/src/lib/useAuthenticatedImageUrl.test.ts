import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAuthenticatedImageUrl } from './useAuthenticatedImageUrl.ts'
import { setToken, clearToken } from './auth.ts'

const originalFetch = global.fetch
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

beforeEach(() => {
  setToken('test-token')
})

afterEach(() => {
  global.fetch = originalFetch
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  clearToken()
  vi.restoreAllMocks()
})

describe('useAuthenticatedImageUrl', () => {
  it('returns null when given a null path', () => {
    const { result } = renderHook(() => useAuthenticatedImageUrl(null))
    expect(result.current).toBeNull()
  })

  it('fetches the path with auth headers and returns an object URL', async () => {
    const blob = new Blob(['fake-image-bytes'])
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url')
    URL.revokeObjectURL = vi.fn()

    const { result } = renderHook(() => useAuthenticatedImageUrl('/api/products/p1/photos/x.jpg'))

    await waitFor(() => expect(result.current).toBe('blob:fake-url'))
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/products/p1/photos/x.jpg'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer /) }) }),
    )
  })

  it('revokes the previous object URL when the path changes', async () => {
    const blob = new Blob(['a'])
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
    URL.createObjectURL = vi.fn().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two')
    URL.revokeObjectURL = vi.fn()

    const { result, rerender } = renderHook(({ path }) => useAuthenticatedImageUrl(path), {
      initialProps: { path: '/api/products/p1/photos/a.jpg' },
    })
    await waitFor(() => expect(result.current).toBe('blob:one'))

    rerender({ path: '/api/products/p1/photos/b.jpg' })
    await waitFor(() => expect(result.current).toBe('blob:two'))

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one')
  })
})
