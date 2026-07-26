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

  it('shares one fetch and object URL across concurrent consumers of the same path', async () => {
    const blob = new Blob(['a'])
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) })
    URL.createObjectURL = vi.fn().mockReturnValue('blob:shared')
    URL.revokeObjectURL = vi.fn()

    // Two independent hook instances for the same path, as when a product's
    // thumbnail is rendered in both the list row and its drawer at once.
    const a = renderHook(() => useAuthenticatedImageUrl('/api/products/p1/photos/x.jpg'))
    const b = renderHook(() => useAuthenticatedImageUrl('/api/products/p1/photos/x.jpg'))

    await waitFor(() => expect(a.result.current).toBe('blob:shared'))
    await waitFor(() => expect(b.result.current).toBe('blob:shared'))
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Unmounting one consumer must not revoke the URL the other still uses.
    a.unmount()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    b.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:shared')
  })

  it('revokes the object URL when the fetch resolves after the last consumer unmounted', async () => {
    let resolveBlob!: (blob: Blob) => void
    const blobPromise = new Promise<Blob>((resolve) => {
      resolveBlob = resolve
    })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => blobPromise })
    URL.createObjectURL = vi.fn().mockReturnValue('blob:late')
    URL.revokeObjectURL = vi.fn()

    const { unmount } = renderHook(() => useAuthenticatedImageUrl('/api/products/p1/photos/late.jpg'))
    unmount()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    // The fetch only completes after the cache entry was already dropped by
    // the unmount cleanup — the URL created now has no owner left to revoke
    // it, so the fetch itself must revoke it instead of leaking it.
    resolveBlob(new Blob(['late-bytes']))
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late'))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('retries with a fresh fetch after every consumer of a failed path has unmounted', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, blob: () => Promise.reject(new Error('unused')) })

    const first = renderHook(() => useAuthenticatedImageUrl('/api/products/p1/photos/bad.jpg'))
    await waitFor(() => expect(first.result.current).toBeNull())
    expect(global.fetch).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderHook(() => useAuthenticatedImageUrl('/api/products/p1/photos/bad.jpg'))
    await waitFor(() => expect(second.result.current).toBeNull())
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
