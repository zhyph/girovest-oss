import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInstallId } from './useInstallId.ts'

type Bridge = { getInstallId?: () => Promise<string | null> }

function setBridge(bridge: Bridge | undefined) {
  const target = window as Window & { girovest?: Bridge }
  if (bridge === undefined) delete target.girovest
  else target.girovest = bridge
}

afterEach(() => {
  setBridge(undefined)
})

describe('useInstallId', () => {
  it('devolve null quando nao ha ponte (build web hospedado)', () => {
    setBridge(undefined)
    const { result } = renderHook(() => useInstallId())
    expect(result.current).toBeNull()
  })

  it('devolve null quando a ponte existe mas nao expoe getInstallId', () => {
    // Instalacao antiga rodando um preload anterior a esta funcionalidade: a
    // tela precisa apenas nao mostrar a secao, nunca quebrar.
    setBridge({})
    const { result } = renderHook(() => useInstallId())
    expect(result.current).toBeNull()
  })

  it('devolve o id resolvido pelo processo main', async () => {
    setBridge({ getInstallId: () => Promise.resolve('b2a4f6c8-1111-4222-8333-444455556666') })
    const { result } = renderHook(() => useInstallId())
    await waitFor(() => expect(result.current).toBe('b2a4f6c8-1111-4222-8333-444455556666'))
  })

  it('engole falha do invoke sem propagar', async () => {
    const getInstallId = vi.fn(() => Promise.reject(new Error('ipc caiu')))
    setBridge({ getInstallId })
    const { result } = renderHook(() => useInstallId())
    await waitFor(() => expect(getInstallId).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('nao chama setState depois de desmontar', async () => {
    // Sem a guarda de desmontagem isto vira warning de update em componente
    // desmontado, que polui a saida de todos os outros testes da tela.
    let resolver: (value: string) => void = () => undefined
    setBridge({ getInstallId: () => new Promise<string>((resolve) => { resolver = resolve }) })
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { unmount } = renderHook(() => useInstallId())
    unmount()
    resolver('b2a4f6c8-1111-4222-8333-444455556666')
    await Promise.resolve()

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
