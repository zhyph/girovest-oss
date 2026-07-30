import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { AddPhotosSessionModal } from './AddPhotosSessionModal.tsx'
import * as useProductsModule from './useProducts.ts'
import type { PhotoTokenResponse } from './productSchemas.ts'

const tokenResponse: PhotoTokenResponse = {
  token: 'abc123',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  mode: 'lan',
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

  it('shows the no-connection message and a retry action when the relay never connected', async () => {
    mockHooks({
      issueImpl: vi.fn().mockResolvedValue({
        token: 'abc123',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUnavailable: true,
      }),
    })

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Sem conexão com o serviço de envio de fotos/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Gerar novo código' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /qr/i })).not.toBeInTheDocument()
  })

  it('renders the QR from relayUrl directly, with no network picker, when mode is relay', async () => {
    mockHooks({
      issueImpl: vi.fn().mockResolvedValue({
        token: 'abc123',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUrl: 'https://relay.example/relay/abc123/photos',
      }),
    })

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rede')).not.toBeInTheDocument()
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

  it('shows a loading indicator while the token is being issued', async () => {
    mockHooks({ issueImpl: () => new Promise<PhotoTokenResponse>(() => {}) })

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Gerando código...')).toBeInTheDocument())
  })

  it('offers a retry when issuing the token itself rejects', async () => {
    mockHooks({ issueImpl: () => Promise.reject(new Error('network error')) })

    renderWithProviders(<AddPhotosSessionModal open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Não foi possível gerar o código. Tente novamente.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Gerar novo código' })).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<AddPhotosSessionModal open onClose={onClose} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  // Relay issuance can block server-side for up to 4s (the handshake wait),
  // so a close-and-reopen realistically leaves the FIRST issuance resolving
  // after the second. A stale response landing last must not overwrite the
  // live session's state with a dead QR or a spurious "Sem conexão".
  it('ignores a stale issuance response that resolves after the modal was reopened', async () => {
    let resolveStale!: (response: PhotoTokenResponse) => void
    const issueImpl = vi
      .fn()
      .mockImplementationOnce(() => new Promise<PhotoTokenResponse>((resolve) => (resolveStale = resolve)))
      .mockResolvedValueOnce({
        token: 'fresh',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUrl: 'https://relay.example/relay/fresh/photos',
      })
    mockHooks({ issueImpl })

    const queryClient = new QueryClient()
    const view = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <AddPhotosSessionModal open={open} onClose={vi.fn()} />
      </QueryClientProvider>
    )
    const { rerender } = render(view(true))
    await waitFor(() => expect(issueImpl).toHaveBeenCalledTimes(1))

    rerender(view(false))
    rerender(view(true))
    await waitFor(() => expect(issueImpl).toHaveBeenCalledTimes(2))
    await screen.findByRole('img', { name: /qr/i })

    await act(async () => {
      resolveStale({
        token: 'stale',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUnavailable: true,
      })
      await Promise.resolve()
    })

    expect(screen.queryByText(/Sem conexão com o serviço de envio de fotos/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument()
  })
})
