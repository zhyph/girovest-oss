import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import * as useClientsModule from './useClients.ts'

const client = {
  id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01',
  hasAllocationHistory: false,
}

function mockClientHooks(
  deleteImpl: () => Promise<unknown> = vi.fn(),
  createImpl: (...args: never[]) => Promise<unknown> = vi.fn(),
  updateImpl: (...args: never[]) => Promise<unknown> = vi.fn(),
) {
  vi.spyOn(useClientsModule, 'useCreateClient').mockReturnValue({ mutateAsync: createImpl } as never)
  vi.spyOn(useClientsModule, 'useUpdateClient').mockReturnValue({ mutateAsync: updateImpl } as never)
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
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(
      await screen.findByText('Não é possível excluir um cliente com histórico de alocações.'),
    ).toBeInTheDocument()
  })

  it('asks for confirmation before deleting, and does not delete if confirmation is dismissed', async () => {
    const deleteImpl = vi.fn()
    mockClientHooks(deleteImpl)
    render(<ClientDrawer client={client} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(deleteImpl).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteImpl).not.toHaveBeenCalled()
  })

  it('closes the drawer when delete succeeds', async () => {
    const onClose = vi.fn()
    mockClientHooks(vi.fn().mockResolvedValue(undefined))
    render(<ClientDrawer client={client} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows a translated error and does not close the drawer when creating a client fails', async () => {
    const onClose = vi.fn()
    const createImpl = vi.fn().mockRejectedValue({ code: 'UNKNOWN', message: 'network error' })
    mockClientHooks(vi.fn(), createImpl)
    render(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999999999')
    await userEvent.type(screen.getByLabelText('E-mail'), 'nova@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a translated error and does not close the drawer when updating a client fails', async () => {
    const onClose = vi.fn()
    const updateImpl = vi.fn().mockRejectedValue({ code: 'UNKNOWN', message: 'network error' })
    mockClientHooks(vi.fn(), vi.fn(), updateImpl)
    render(<ClientDrawer client={client} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hides Excluir when the client has allocation history, per the drawer spec', () => {
    mockClientHooks(vi.fn())
    render(<ClientDrawer client={{ ...client, hasAllocationHistory: true }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})
