import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import * as useClientsModule from './useClients.ts'

const client = { id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }

function mockClientHooks(deleteImpl: () => Promise<unknown>) {
  vi.spyOn(useClientsModule, 'useCreateClient').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useClientsModule, 'useUpdateClient').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useClientsModule, 'useDeleteClient').mockReturnValue({ mutateAsync: deleteImpl } as never)
}

describe('ClientDrawer', () => {
  it('does not show a delete button in create mode', () => {
    mockClientHooks(vi.fn())
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('shows the translated error when deleting a client with allocation history', async () => {
    mockClientHooks(vi.fn().mockRejectedValue({ code: 'CANNOT_DELETE_WITH_HISTORY', message: 'nope' }))
    render(<ClientDrawer client={client} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    expect(
      await screen.findByText('Não é possível excluir um cliente com histórico de alocações.'),
    ).toBeInTheDocument()
  })

  it('closes the drawer when delete succeeds', async () => {
    const onClose = vi.fn()
    mockClientHooks(vi.fn().mockResolvedValue(undefined))
    render(<ClientDrawer client={client} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
