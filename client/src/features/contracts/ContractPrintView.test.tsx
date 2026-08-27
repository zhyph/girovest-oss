import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { ContractPrintView } from './ContractPrintView.tsx'
import type { ContractDetail } from './contractSchemas.ts'

const baseContract: ContractDetail = {
  id: 'ct1',
  number: 7,
  locationId: 'loc1',
  clientId: 'c1',
  staffId: 's1',
  eventDate: '2026-10-03',
  paymentMethod: 'PIX',
  signatureStatus: 'unsigned',
  signatureImage: null,
  signedAt: null,
  createdAt: '2026-09-01',
  location: {
    id: 'loc1',
    name: 'Priscila Moda Festa',
    address: 'Rua das Flores, 100',
    phone: '1199999999',
    locale: 'pt-BR',
    contractClauses: [
      { id: 'cl1', text: 'Primeira cláusula.', sortOrder: 0 },
      { id: 'cl2', text: 'Segunda cláusula.', sortOrder: 1 },
    ],
  },
  client: {
    id: 'c1',
    name: 'Maria Souza',
    phone: '11988887777',
    email: 'maria@example.com',
    identityDocuments: [{ id: 'd1', label: 'CPF', value: '123.456.789-00' }],
    addressLines: [{ id: 'a1', label: 'Endereço', value: 'Rua A, 100', sortOrder: 0 }],
  },
  allocations: [
    {
      id: 'al1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
      checkoutDate: '2026-10-02', actualCheckoutDate: null, dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
      product: { id: 'p1', name: 'Vestido Azul' },
    },
  ],
  payments: [{ id: 'pm1', contractId: 'ct1', amount: 380, method: 'PIX', paidAt: '2026-09-20', createdAt: '2026-09-20' }],
}

describe('ContractPrintView', () => {
  it('renders every paper-contract field for an unsigned contract', () => {
    render(<ContractPrintView contract={baseContract} />)

    expect(screen.getByText('Priscila Moda Festa')).toBeInTheDocument()
    expect(screen.getByText(/Contrato Nº 7/)).toBeInTheDocument()
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    expect(screen.getByText(/CPF/)).toBeInTheDocument()
    expect(screen.getByText(/Rua A, 100/)).toBeInTheDocument()
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Primeira cláusula.')).toBeInTheDocument()
    expect(screen.getByText('Segunda cláusula.')).toBeInTheDocument()

    const expectedTotal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(380)
    // Intl inserts a non-breaking space (U+00A0) between "R$" and the amount, but
    // testing-library's default normalizer collapses whitespace (including NBSP) to a
    // regular space before matching. Escape whitespace as `\s` so the regex still matches
    // the normalized DOM text.
    const expectedTotalPattern = new RegExp(expectedTotal.replace('$', '\\$').replace(/\s/g, '\\s'))
    expect(screen.getAllByText(expectedTotalPattern).length).toBeGreaterThan(0)

    expect(screen.queryByAltText('Assinatura do Cliente')).not.toBeInTheDocument()
  })

  it('CRITICAL: leaves a cancelled piece off the sheet and out of the total', () => {
    // A signed sheet that bills a dress the shop never sent out. Cancelling is
    // irreversible, so once this is printed and signed there is no fixing it
    // in the app — only reprinting and explaining the difference at the
    // counter. The single reserved allocation the other tests use here is
    // exactly why this stayed green while the bug was live.
    const mixedContract: ContractDetail = {
      ...baseContract,
      allocations: [
        baseContract.allocations[0],
        {
          ...baseContract.allocations[0],
          id: 'al2',
          productId: 'p2',
          status: 'cancelled',
          priceCharged: 500,
          product: { id: 'p2', name: 'Vestido Cancelado' },
        },
      ],
    }
    render(<ContractPrintView contract={mixedContract} />)

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.queryByText('Vestido Cancelado')).not.toBeInTheDocument()

    const brl = (value: number) =>
      new RegExp(
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
          .format(value)
          .replace('$', '\\$')
          .replace(/\s/g, '\\s'),
      )
    expect(screen.getAllByText(brl(380)).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(brl(880))).toHaveLength(0)
  })

  it('CRITICAL: prints the caução the client handed over, as her only receipt for it', () => {
    // Real cash, taken at checkout and stored on the allocation, appeared on
    // no screen and on no document afterwards. The signed contract she took
    // home did not mention it at all, so nothing outside the shop's memory
    // recorded that R$ 300,00 had changed hands.
    const withDeposit: ContractDetail = {
      ...baseContract,
      allocations: [{ ...baseContract.allocations[0], depositCollected: 300 }],
    }
    render(<ContractPrintView contract={withDeposit} />)

    expect(screen.getByText(/Caução recebida/)).toBeInTheDocument()
    // Separate from the total — never folded into what she owes.
    const total = screen.getByText(/Total/).textContent?.replace(/\u00a0/g, ' ')
    expect(total).toContain('R$ 380,00')
  })

  it('says nothing about caução when none was taken', () => {
    render(<ContractPrintView contract={baseContract} />)
    expect(screen.queryByText(/Caução/)).not.toBeInTheDocument()
  })

  it('renders the signature image when the contract is signed', () => {
    const signedContract: ContractDetail = {
      ...baseContract,
      signatureStatus: 'signed',
      signatureImage: 'data:image/png;base64,iVBORw0KGgo=',
      signedAt: '2026-09-02T14:30:00.000Z',
    }
    render(<ContractPrintView contract={signedContract} />)

    expect(screen.getByAltText('Assinatura do Cliente')).toBeInTheDocument()
    expect(screen.getByText(/Assinado em/)).toBeInTheDocument()
  })

  it('marks item rows and the signature block to avoid splitting across a print page break', () => {
    const { container } = render(<ContractPrintView contract={baseContract} />)

    const row = container.querySelector('tbody tr')
    expect(row?.className).toContain('print:break-inside-avoid')

    const signatureBlock = screen.getByText('Assinatura do Cliente').closest('section')
    expect(signatureBlock?.className).toContain('print:break-inside-avoid')
  })
})
