import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { AddPhotosRemotelyModal } from './AddPhotosRemotelyModal.tsx'
import * as useProductsModule from './useProducts.ts'
import type { Product, PhotoTokenResponse } from './productSchemas.ts'

const product: Product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active', availability: 'available',
  hasAllocationHistory: false, createdAt: '2026-01-01', photos: [],
}

const tokenResponse: PhotoTokenResponse = {
  token: 'abc123',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  port: 3000,
  candidates: [{ interfaceName: 'wlan0', address: '192.168.1.42' }],
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function mockHooks(overrides: { products?: Product[]; issueImpl?: (...args: never[]) => Promise<PhotoTokenResponse> } = {}) {
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
    data: overrides.products ?? [product],
  } as never)
  vi.spyOn(useProductsModule, 'useIssueProductPhotoToken').mockReturnValue({
    mutateAsync: overrides.issueImpl ?? vi.fn().mockResolvedValue(tokenResponse),
    isPending: false,
  } as never)
}

describe('AddPhotosRemotelyModal', () => {
  beforeEach(() => {
    mockHooks()
  })

  it('issues a token and shows a QR code when opened', async () => {
    renderWithProviders(<AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument())
  })

  it('shows the no-LAN message when there are no candidates', async () => {
    mockHooks({ issueImpl: vi.fn().mockResolvedValue({ ...tokenResponse, candidates: [] }) })

    renderWithProviders(<AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Nenhuma rede local detectada/)).toBeInTheDocument())
  })

  it('shows a network picker when there is more than one candidate', async () => {
    mockHooks({
      issueImpl: vi.fn().mockResolvedValue({
        ...tokenResponse,
        candidates: [
          { interfaceName: 'wlan0', address: '192.168.1.42' },
          { interfaceName: 'eth0', address: '192.168.1.43' },
        ],
      }),
    })

    renderWithProviders(<AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByLabelText('Rede')).toBeInTheDocument())
  })

  it('shows a regenerate action', async () => {
    renderWithProviders(<AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar novo código' })).toBeInTheDocument())
  })

  it('shows the current photo count while waiting', async () => {
    mockHooks({ products: [{ ...product, photos: ['https://example.com/a.jpg'] }] })

    renderWithProviders(<AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Aguardando fotos\.\.\. \(1\)/)).toBeInTheDocument())
  })

  it('does not reissue the token when the product list updates from polling', async () => {
    const issueImpl = vi.fn().mockResolvedValue(tokenResponse)
    mockHooks({ issueImpl })

    const queryClient = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(issueImpl).toHaveBeenCalledTimes(1))

    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({
      data: [{ ...product, photos: ['https://example.com/a.jpg'] }],
    } as never)
    rerender(
      <QueryClientProvider client={queryClient}>
        <AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(issueImpl).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the QR code when the network selection changes', async () => {
    const issueImpl = vi.fn().mockResolvedValue({
      ...tokenResponse,
      candidates: [
        { interfaceName: 'wlan0', address: '192.168.1.42' },
        { interfaceName: 'eth0', address: '192.168.1.43' },
      ],
    })
    mockHooks({ issueImpl })

    renderWithProviders(<AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />)

    const img = await screen.findByRole('img', { name: /qr/i })
    const firstSrc = img.getAttribute('src')
    expect(firstSrc).toBeTruthy()

    await userEvent.selectOptions(screen.getByLabelText('Rede'), '192.168.1.43')

    await waitFor(() => expect(img.getAttribute('src')).not.toBe(firstSrc))
  })

  it('stops polling once the modal closes', () => {
    const useProductsSpy = vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product] } as never)
    vi.spyOn(useProductsModule, 'useIssueProductPhotoToken').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(tokenResponse),
      isPending: false,
    } as never)

    const queryClient = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AddPhotosRemotelyModal productId="p1" open onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(useProductsSpy).toHaveBeenLastCalledWith({ refetchInterval: 3000 })

    rerender(
      <QueryClientProvider client={queryClient}>
        <AddPhotosRemotelyModal productId="p1" open={false} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(useProductsSpy).toHaveBeenLastCalledWith({ refetchInterval: false })
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<AddPhotosRemotelyModal productId="p1" open onClose={onClose} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
