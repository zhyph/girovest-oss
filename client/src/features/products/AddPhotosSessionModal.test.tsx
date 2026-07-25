import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { AddPhotosSessionModal } from './AddPhotosSessionModal.tsx'
import * as useProductsModule from './useProducts.ts'
import type { PhotoTokenResponse } from './productSchemas.ts'

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

function mockHooks(overrides: { issueImpl?: (...args: never[]) => Promise<PhotoTokenResponse> } = {}) {
  vi.spyOn(useProductsModule, 'useIssueProductPhotoSession').mockReturnValue({
    mutateAsync: overrides.issueImpl ?? vi.fn().mockResolvedValue(tokenResponse),
    isPending: false,
  } as never)
}

describe('AddPhotosSessionModal', () => {
  beforeEach(() => {
    mockHooks()
  })

  it('issues a session token with no product context and shows a QR code when opened', async () => {
    const issueImpl = vi.fn().mockResolvedValue(tokenResponse)
    mockHooks({ issueImpl })

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument())
    expect(issueImpl).toHaveBeenCalledWith()
  })

  it('shows the no-LAN message when there are no candidates', async () => {
    mockHooks({ issueImpl: vi.fn().mockResolvedValue({ ...tokenResponse, candidates: [] }) })

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

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

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByLabelText('Rede')).toBeInTheDocument())
  })

  it('shows a regenerate action', async () => {
    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar novo código' })).toBeInTheDocument())
  })

  it('shows a simple close-when-done message instead of a per-product photo count', async () => {
    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText('Feche esta janela quando terminar de enviar fotos.')).toBeInTheDocument(),
    )
  })

  it('reissues a fresh token every time the modal is reopened', async () => {
    const issueImpl = vi.fn().mockResolvedValue(tokenResponse)
    mockHooks({ issueImpl })

    const queryClient = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AddPhotosSessionModal open={false} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(issueImpl).not.toHaveBeenCalled()

    rerender(
      <QueryClientProvider client={queryClient}>
        <AddPhotosSessionModal open onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(issueImpl).toHaveBeenCalledTimes(1))
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

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    const img = await screen.findByRole('img', { name: /qr/i })
    const firstSrc = img.getAttribute('src')
    expect(firstSrc).toBeTruthy()

    await userEvent.selectOptions(screen.getByLabelText('Rede'), '192.168.1.43')

    await waitFor(() => expect(img.getAttribute('src')).not.toBe(firstSrc))
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<AddPhotosSessionModal open onClose={onClose} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
