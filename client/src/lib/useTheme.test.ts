import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// The theme store is module-level state (so all consumers share one value),
// which means each test needs a fresh module instance to control what the
// store reads from localStorage at load time.
async function loadUseTheme() {
  vi.resetModules()
  return await import('./useTheme.ts')
}

function rootClasses() {
  return Array.from(document.documentElement.classList)
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('light', 'dark')
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('light', 'dark')
})

describe('useTheme', () => {
  it('reads the stored preference on mount', async () => {
    localStorage.setItem('theme', 'dark')
    const { useTheme } = await loadUseTheme()
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('defaults to system when nothing is stored', async () => {
    const { useTheme } = await loadUseTheme()
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('system')
  })

  it('persists an explicit choice and applies the root class', async () => {
    const { useTheme } = await loadUseTheme()
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('dark'))

    expect(result.current.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(rootClasses()).toContain('dark')
  })

  it('swaps the root class when switching between explicit themes', async () => {
    const { useTheme } = await loadUseTheme()
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('dark'))
    act(() => result.current.setTheme('light'))

    expect(rootClasses()).toContain('light')
    expect(rootClasses()).not.toContain('dark')
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('removes the stored key and both root classes for system', async () => {
    localStorage.setItem('theme', 'dark')
    const { useTheme } = await loadUseTheme()
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('system'))

    expect(result.current.theme).toBe('system')
    expect(localStorage.getItem('theme')).toBeNull()
    expect(rootClasses()).not.toContain('dark')
    expect(rootClasses()).not.toContain('light')
  })

  it('keeps every consumer in sync through the shared store', async () => {
    const { useTheme } = await loadUseTheme()
    const first = renderHook(() => useTheme())
    const second = renderHook(() => useTheme())

    act(() => first.result.current.setTheme('dark'))

    expect(second.result.current.theme).toBe('dark')
  })

  it('falls back to system when storage access throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    const { useTheme } = await loadUseTheme()
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('system')

    // The write path must be guarded too: the in-session theme still applies
    // even when persisting it is impossible.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    act(() => result.current.setTheme('dark'))
    expect(result.current.theme).toBe('dark')
    expect(rootClasses()).toContain('dark')
  })

  it('applies the stored theme and root class via initTheme on boot', async () => {
    localStorage.setItem('theme', 'dark')
    const { initTheme } = await loadUseTheme()
    initTheme()
    expect(rootClasses()).toContain('dark')
  })
})
