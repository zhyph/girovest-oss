import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { SignRemotelyModal } from './SignRemotelyModal.tsx'
import * as useContractsModule from './useContracts.ts'
import type { Contract, SigningTokenResponse } from './contractSchemas.ts'

const unsignedContract: Contract = {
  id: 'ct1', number: 1, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  allocations: [], payments: [],
}

const tokenResponse: SigningTokenResponse = {
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

function mockHooks(overrides: { contract?: Contract; issueImpl?: (...args: never[]) => Promise<SigningTokenResponse> } = {}) {
  vi.spyOn(useContractsModule, 'useContract').mockReturnValue({
    data: overrides.contract ?? unsignedContract,
  } as never)
  vi.spyOn(useContractsModule, 'useIssueSigningToken').mockReturnValue({
    mutateAsync: overrides.issueImpl ?? vi.fn().mockResolvedValue(tokenResponse),
    isPending: false,
  } as never)
}

describe('SignRemotelyModal', () => {
  beforeEach(() => {
    mockHooks()
  })

  it('issues a token and shows a QR code when opened', async () => {
    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument())
  })

  it('shows the no-LAN message when there are no candidates', async () => {
    mockHooks({ issueImpl: vi.fn().mockResolvedValue({ ...tokenResponse, candidates: [] }) })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

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

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByLabelText('Rede')).toBeInTheDocument())
  })

  it('renders the QR from relayUrl directly, with no network picker, when mode is relay', async () => {
    mockHooks({
      issueImpl: vi.fn().mockResolvedValue({
        token: 'abc123',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUrl: 'https://relay.example/relay/abc123/sign',
      }),
    })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rede')).not.toBeInTheDocument()
  })

  // Relay mode has no LAN candidates to be missing, so before this the desktop
  // showed a normal "waiting for signature" screen while the phone could only
  // ever get a 504.
  it('shows the no-connection message and a retry action when the relay never connected', async () => {
    mockHooks({
      issueImpl: vi.fn().mockResolvedValue({
        token: 'abc123',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUnavailable: true,
      }),
    })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Sem conexão com o serviço de assinatura remota/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Gerar novo código' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /qr/i })).not.toBeInTheDocument()
  })

  it('shows a success state once the contract is signed', async () => {
    mockHooks({ contract: { ...unsignedContract, signatureStatus: 'signed' } })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Assinado com sucesso!')).toBeInTheDocument())
  })

  it('shows a regenerate action in the no-LAN state', async () => {
    mockHooks({ issueImpl: vi.fn().mockResolvedValue({ ...tokenResponse, candidates: [] }) })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/Nenhuma rede local detectada/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Gerar novo código' })).toBeInTheDocument()
  })

  it('does not reissue the token when the contract updates from polling', async () => {
    const issueImpl = vi.fn().mockResolvedValue(tokenResponse)
    mockHooks({ issueImpl })

    const queryClient = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(issueImpl).toHaveBeenCalledTimes(1))

    // Simulate a poll tick updating the contract data (still unsigned) —
    // reconfigure the mock, then re-render the SAME component instance
    // (same queryClient, same rerender target) with unchanged open/contractId
    // props, matching what a poll-driven re-render actually looks like.
    vi.spyOn(useContractsModule, 'useContract').mockReturnValue({
      data: { ...unsignedContract, createdAt: '2026-09-02' },
    } as never)
    rerender(
      <QueryClientProvider client={queryClient}>
        <SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />
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

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    const img = await screen.findByRole('img', { name: /qr/i })
    const firstSrc = img.getAttribute('src')
    expect(firstSrc).toBeTruthy()

    await userEvent.selectOptions(screen.getByLabelText('Rede'), '192.168.1.43')

    await waitFor(() => expect(img.getAttribute('src')).not.toBe(firstSrc))
  })

  // Relay issuance can block server-side for up to 4s (the handshake wait),
  // so a close-and-reopen realistically leaves the FIRST issuance resolving
  // after the second — and the server already deleted the first token when it
  // minted the second. A stale response landing last must not overwrite the
  // live session's state with a dead QR or a spurious "Sem conexão".
  it('ignores a stale issuance response that resolves after the modal was reopened', async () => {
    let resolveStale!: (response: SigningTokenResponse) => void
    const issueImpl = vi
      .fn()
      .mockImplementationOnce(() => new Promise<SigningTokenResponse>((resolve) => (resolveStale = resolve)))
      .mockResolvedValueOnce({
        token: 'fresh',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUrl: 'https://relay.example/relay/fresh/sign',
      })
    mockHooks({ issueImpl })

    const queryClient = new QueryClient()
    const view = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <SignRemotelyModal contractId="ct1" open={open} onClose={vi.fn()} />
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
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        mode: 'relay',
        relayUnavailable: true,
      })
      await Promise.resolve()
    })

    expect(screen.queryByText(/Sem conexão com o serviço de assinatura remota/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /qr/i })).toBeInTheDocument()
  })

  it('shows a loading indicator while the token is being issued', async () => {
    mockHooks({ issueImpl: () => new Promise<SigningTokenResponse>(() => {}) })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Gerando código...')).toBeInTheDocument())
  })

  it('offers a retry when issuing the token itself rejects', async () => {
    mockHooks({ issueImpl: () => Promise.reject(new Error('network error')) })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Não foi possível gerar o código. Tente novamente.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Gerar novo código' })).toBeInTheDocument()
  })

  it('stops polling once the modal closes', () => {
    const useContractSpy = vi.spyOn(useContractsModule, 'useContract').mockReturnValue({ data: unsignedContract } as never)
    vi.spyOn(useContractsModule, 'useIssueSigningToken').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(tokenResponse),
      isPending: false,
    } as never)

    const queryClient = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(useContractSpy).toHaveBeenLastCalledWith('ct1', { refetchInterval: 3000 })

    rerender(
      <QueryClientProvider client={queryClient}>
        <SignRemotelyModal contractId="ct1" open={false} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(useContractSpy).toHaveBeenLastCalledWith('ct1', { refetchInterval: false })
  })
})
