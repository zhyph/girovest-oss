import { useEffect, useState } from 'react'
import { getToken } from './auth.ts'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

interface CacheEntry {
  promise: Promise<string>
  objectUrl: string | null
  refCount: number
}

// Shared across every consumer of a given path — e.g. the product list row
// and the product drawer both render the same photo's thumbnail. Without
// this, each mounted <AuthenticatedPhoto> issued its own full-resolution
// authenticated fetch and held its own object URL, so a list of N products
// meant N parallel downloads, repeated every time filtering unmounted and
// remounted the rows. refCount tracks how many consumers are currently
// using the entry so the object URL is only revoked once the last one lets go.
const cache = new Map<string, CacheEntry>()

function createCacheEntry(path: string): CacheEntry {
  const token = getToken()
  const entry: CacheEntry = {
    objectUrl: null,
    refCount: 0,
    promise: fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => {
        if (!response.ok) throw new Error('failed to fetch image')
        return response.blob()
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        // The entry this fetch was started for may no longer be in the cache:
        // the last consumer unmounted mid-flight (cleanup deleted the entry),
        // or a rapid unmount/remount replaced it with a fresh entry running
        // its own fetch. Storing the URL on a dead entry leaks it (nothing
        // would ever revoke it), and storing it on the replacement would make
        // the replacement revoke the wrong URL later — so revoke it here.
        if (cache.get(path) !== entry) {
          URL.revokeObjectURL(url)
          return url
        }
        entry.objectUrl = url
        return url
      }),
  }
  return entry
}

export function useAuthenticatedImageUrl(path: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(() => (path ? (cache.get(path)?.objectUrl ?? null) : null))

  useEffect(() => {
    if (!path) {
      setObjectUrl(null)
      return
    }

    let cancelled = false
    let entry = cache.get(path)
    if (!entry) {
      entry = createCacheEntry(path)
      cache.set(path, entry)
    }
    entry.refCount += 1

    entry.promise
      .then((url) => {
        if (!cancelled) setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(null)
      })

    return () => {
      cancelled = true
      const current = cache.get(path)
      if (!current) return
      current.refCount -= 1
      if (current.refCount <= 0) {
        cache.delete(path)
        if (current.objectUrl) URL.revokeObjectURL(current.objectUrl)
      }
    }
  }, [path])

  return objectUrl
}
