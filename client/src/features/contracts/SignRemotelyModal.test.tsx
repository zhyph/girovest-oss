import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { SignRemotelyModal } from './SignRemotelyModal.tsx'
import * as useContractsModule from './useContracts.ts'
import type { Contract, SigningTokenResponse } from './contractSchemas.ts'

const unsignedContract: Contract = {
  id: 'ct1', number: 1, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  allocations: [], installments: [],
}

const tokenResponse: SigningTokenResponse = {
  token: 'abc123',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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

  it('shows a success state once the contract is signed', async () => {
    mockHooks({ contract: { ...unsignedContract, signatureStatus: 'signed' } })

    renderWithProviders(<SignRemotelyModal contractId="ct1" open onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Assinado com sucesso!')).toBeInTheDocument())
  })
})
