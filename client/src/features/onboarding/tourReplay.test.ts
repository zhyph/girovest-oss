import { describe, it, expect, vi, beforeEach } from 'vitest'

// The pending-replay flag is module-level (a Settings-page click needs to
// survive the SPA navigation to the target page, which does not reload the
// module graph), so each test needs a fresh module instance.
async function loadTourReplay() {
  vi.resetModules()
  return await import('./tourReplay.ts')
}

beforeEach(() => {
  vi.resetModules()
})

describe('tourReplay', () => {
  it('consumePendingReplay retorna false quando nada foi solicitado', async () => {
    const { consumePendingReplay } = await loadTourReplay()
    expect(consumePendingReplay('clients')).toBe(false)
  })

  it('requestTourReplay marca a seção como pendente para ser consumida uma única vez', async () => {
    const { requestTourReplay, consumePendingReplay } = await loadTourReplay()
    requestTourReplay('clients')

    expect(consumePendingReplay('clients')).toBe(true)
    expect(consumePendingReplay('clients')).toBe(false)
  })

  it('consumePendingReplay de outra seção não consome o pedido pendente', async () => {
    const { requestTourReplay, consumePendingReplay } = await loadTourReplay()
    requestTourReplay('clients')

    expect(consumePendingReplay('products')).toBe(false)
    expect(consumePendingReplay('clients')).toBe(true)
  })

  it('uma nova solicitação substitui a anterior ainda não consumida', async () => {
    const { requestTourReplay, consumePendingReplay } = await loadTourReplay()
    requestTourReplay('clients')
    requestTourReplay('products')

    expect(consumePendingReplay('clients')).toBe(false)
    expect(consumePendingReplay('products')).toBe(true)
  })
})
