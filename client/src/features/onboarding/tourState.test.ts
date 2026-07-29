import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// The seen-state store is module-level (so all consumers share one value),
// which means each test needs a fresh module instance to control what the
// store reads from localStorage at load time. Mirrors useTheme.test.ts.
async function loadTourState() {
  vi.resetModules()
  return await import('./tourState.ts')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('tourState', () => {
  it('hasSeenTour retorna false quando nada foi salvo', async () => {
    const { hasSeenTour } = await loadTourState()
    expect(hasSeenTour('clients')).toBe(false)
  })

  it('markTourSeen persiste e hasSeenTour passa a retornar true', async () => {
    const { hasSeenTour, markTourSeen } = await loadTourState()
    markTourSeen('clients')
    expect(hasSeenTour('clients')).toBe(true)
    expect(localStorage.getItem('girovest.tour.v1.clients')).toBe('1')
  })

  it('seções diferentes são rastreadas de forma independente', async () => {
    const { hasSeenTour, markTourSeen } = await loadTourState()
    markTourSeen('clients')
    expect(hasSeenTour('clients')).toBe(true)
    expect(hasSeenTour('products')).toBe(false)
  })

  it('useTourState reflete o estado salvo no localStorage ao montar', async () => {
    localStorage.setItem('girovest.tour.v1.contracts', '1')
    const { useTourState } = await loadTourState()
    const { result } = renderHook(() => useTourState('contracts'))
    expect(result.current.hasSeen).toBe(true)
  })

  it('markSeen do hook atualiza todos os consumidores através do store compartilhado', async () => {
    const { useTourState } = await loadTourState()
    const first = renderHook(() => useTourState('products'))
    const second = renderHook(() => useTourState('products'))

    act(() => first.result.current.markSeen())

    expect(second.result.current.hasSeen).toBe(true)
  })

  it('falha de leitura do storage é tratada como não visto', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    const { hasSeenTour } = await loadTourState()
    expect(hasSeenTour('dashboard')).toBe(false)
  })

  it('markSeen mantém a mesma referência entre renderizações', async () => {
    const { useTourState } = await loadTourState()
    const { result, rerender } = renderHook(() => useTourState('clients'))
    const firstMarkSeen = result.current.markSeen

    rerender()

    expect(result.current.markSeen).toBe(firstMarkSeen)
  })

  it('falha de escrita do storage não impede o estado em sessão', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    const { hasSeenTour, markTourSeen } = await loadTourState()
    markTourSeen('dashboard')
    expect(hasSeenTour('dashboard')).toBe(true)
  })
})
