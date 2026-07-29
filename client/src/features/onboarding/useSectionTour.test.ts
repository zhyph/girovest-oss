import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import '../../i18n.ts'

// driver.js manipulates real layout (getBoundingClientRect, scrollIntoView,
// rAF) in ways jsdom does not model — mocked here so these tests exercise
// this hook's own start/auto-launch/replay/cleanup logic, not driver.js.
const driveMock = vi.fn()
const destroyMock = vi.fn()
const driverFactory = vi.fn((_config?: unknown) => ({ drive: driveMock, destroy: destroyMock }))

vi.mock('driver.js', () => ({ driver: (config?: unknown) => driverFactory(config) }))
vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('./tour-theme.css', () => ({}))

// The tour state/replay stores are module-level, and useSectionTour imports
// them internally — resetting modules before each dynamic import of the
// hook gives every test a clean, isolated store.
async function loadUseSectionTour() {
  vi.resetModules()
  return await import('./useSectionTour.ts')
}

function addAnchor(value: string) {
  const el = document.createElement('div')
  el.setAttribute('data-tour', value)
  document.body.appendChild(el)
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  driveMock.mockClear()
  destroyMock.mockClear()
  driverFactory.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('useSectionTour', () => {
  it('inicia automaticamente o tour na primeira visita à seção', async () => {
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()

    renderHook(() => useSectionTour('clients'))

    expect(driveMock).toHaveBeenCalledTimes(1)
  })

  it('não inicia automaticamente quando a seção já foi vista', async () => {
    localStorage.setItem('girovest.tour.v1.clients', '1')
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()

    renderHook(() => useSectionTour('clients'))

    expect(driveMock).not.toHaveBeenCalled()
  })

  it('marca a seção como vista depois do início automático', async () => {
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()
    const { hasSeenTour } = await import('./tourState.ts')

    renderHook(() => useSectionTour('clients'))

    expect(hasSeenTour('clients')).toBe(true)
  })

  it('replay() inicia o tour mesmo quando a seção já foi vista', async () => {
    localStorage.setItem('girovest.tour.v1.clients', '1')
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()

    const { result } = renderHook(() => useSectionTour('clients'))
    driveMock.mockClear()
    act(() => result.current.replay())

    expect(driveMock).toHaveBeenCalledTimes(1)
  })

  it('consome um pedido de replay pendente ao montar, mesmo já tendo sido visto', async () => {
    localStorage.setItem('girovest.tour.v1.clients', '1')
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()
    const { requestTourReplay } = await import('./tourReplay.ts')
    requestTourReplay('clients')

    renderHook(() => useSectionTour('clients'))

    expect(driveMock).toHaveBeenCalledTimes(1)
  })

  it('não inicia o tour quando nenhum elemento da seção está presente', async () => {
    const { useSectionTour } = await loadUseSectionTour()

    renderHook(() => useSectionTour('clients'))

    expect(driverFactory).not.toHaveBeenCalled()
  })

  it('destroi a instância ativa ao desmontar', async () => {
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()

    const { unmount } = renderHook(() => useSectionTour('clients'))
    unmount()

    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('não re-executa o início automático em re-renderizações', async () => {
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()

    const { rerender } = renderHook(() => useSectionTour('clients'))
    rerender()
    rerender()

    expect(driveMock).toHaveBeenCalledTimes(1)
  })

  it('não inicia o tour enquanto ready é falso, mesmo com âncoras presentes', async () => {
    // Reproduces every real page: it early-returns a bare loading div (no
    // anchors at all) while its data query is in flight, so this covers
    // both "not ready" causes — missing anchors and an explicit ready=false.
    addAnchor('clients.create')
    const { useSectionTour } = await loadUseSectionTour()

    renderHook(({ ready }) => useSectionTour('clients', ready), { initialProps: { ready: false } })

    expect(driveMock).not.toHaveBeenCalled()
  })

  it('inicia o tour quando ready passa de falso para verdadeiro', async () => {
    // The realistic sequence: the page mounts while its query is still
    // loading (no anchors yet, ready=false), then the query resolves and
    // the real content — including anchors — mounts (ready=true).
    const { useSectionTour } = await loadUseSectionTour()

    const { rerender } = renderHook(({ ready }) => useSectionTour('clients', ready), {
      initialProps: { ready: false },
    })
    expect(driveMock).not.toHaveBeenCalled()

    addAnchor('clients.create')
    rerender({ ready: true })

    expect(driveMock).toHaveBeenCalledTimes(1)
  })

  it('preserva um pedido de replay pendente até que ready seja verdadeiro', async () => {
    localStorage.setItem('girovest.tour.v1.clients', '1')
    const { useSectionTour } = await loadUseSectionTour()
    const { requestTourReplay } = await import('./tourReplay.ts')
    requestTourReplay('clients')

    const { rerender } = renderHook(({ ready }) => useSectionTour('clients', ready), {
      initialProps: { ready: false },
    })
    expect(driveMock).not.toHaveBeenCalled()

    addAnchor('clients.create')
    rerender({ ready: true })

    expect(driveMock).toHaveBeenCalledTimes(1)
  })
})
