import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import type { Client } from './clientSchemas.ts'
import * as useClientsModule from './useClients.ts'
import { Toaster } from '../../components/ui/sonner.tsx'

const client = {
  id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01',
  hasAllocationHistory: false, identityDocuments: [], addressLines: [],
  contractCount: 0, lastRentalProductId: null, lastRentalDate: null,
}

function renderWithToast(ui: React.ReactElement) {
  return render(<>{ui}<Toaster /></>)
}

function mockClientHooks(
  deleteImpl: () => Promise<unknown> = vi.fn(),
  createImpl: (...args: never[]) => Promise<unknown> = vi.fn(),
  updateImpl: (...args: never[]) => Promise<unknown> = vi.fn(),
  otherClients: Client[] = [],
) {
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: otherClients } as never)
  vi.spyOn(useClientsModule, 'useCreateClient').mockReturnValue({ mutateAsync: createImpl } as never)
  vi.spyOn(useClientsModule, 'useUpdateClient').mockReturnValue({ mutateAsync: updateImpl } as never)
  vi.spyOn(useClientsModule, 'useDeleteClient').mockReturnValue({ mutateAsync: deleteImpl } as never)
}

describe('ClientDrawer', () => {
  it('prefills the name field from initialName in create mode only', () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} initialName="Nova Cliente" onClose={vi.fn()} />)

    expect(screen.getByLabelText('Nome')).toHaveValue('Nova Cliente')
  })

  it('CRITICAL: says why the save was blocked instead of no-opping', async () => {
    // A document row with a value and no label fails clientSchema's per-row
    // refine. That error had nowhere to render, so Salvar stayed enabled, the
    // drawer stayed open and nothing at all appeared: identical to a frozen
    // app, with a customer waiting at the counter.
    const createImpl = vi.fn()
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar documento' }))
    await userEvent.type(screen.getAllByLabelText('Valor do documento').at(-1)!, '123456789')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).not.toHaveBeenCalled()
    expect(await screen.findByText(/Dê um nome a este documento/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Rótulo do documento').at(-1)!).toHaveAttribute('aria-invalid', 'true')
  })

  it('saves once the blocked row is given a label', async () => {
    const createImpl = vi.fn().mockResolvedValue({ ...client, id: 'c-new' })
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar documento' }))
    await userEvent.type(screen.getAllByLabelText('Valor do documento').at(-1)!, '123456789')
    await userEvent.type(screen.getAllByLabelText('Rótulo do documento').at(-1)!, 'CNH')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalled()
  })

  it('CRITICAL: keeps template rows locked when an earlier one was never filled', async () => {
    // Both the lock and the delete-confirm compared by ARRAY POSITION, and
    // stored rows come back in insertion order — so a client saved with RG but
    // no CPF shifted every later row up by one, and RG rendered white and
    // editable with one click on ✕ wiping it, no confirmation. The unlocked
    // label is the second-order damage: retyping "Bairro" as "Barrio" makes
    // clientReadiness report a missing field on a fully filled address.
    const withGap: Client = {
      ...client,
      identityDocuments: [{ id: 'd1', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' }],
    }
    mockClientHooks()
    renderWithToast(<ClientDrawer client={withGap} onClose={vi.fn()} />)

    const labelField = screen.getAllByLabelText('Rótulo do documento').at(0)!
    expect(labelField).toHaveAttribute('readonly')

    await userEvent.click(screen.getAllByRole('button', { name: 'Remover documento' }).at(0)!)
    // Confirmed, not dropped on the spot.
    expect(screen.getByRole('heading', { name: 'Remover "RG"?' })).toBeInTheDocument()
  })

  it('opens with focus on the field she came to fill', () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.getByLabelText('Nome')).toHaveFocus()
  })

  it('ignores initialName when editing an existing client', () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={client} initialName="Deveria Ser Ignorado" onClose={vi.fn()} />)

    expect(screen.getByLabelText('Nome')).toHaveValue('Maria Silva')
  })

  it('calls onCreated with the created client on save, only in create mode', async () => {
    const created: Client = { ...client, id: 'c-new', name: 'Nova Cliente' }
    const createImpl = vi.fn().mockResolvedValue(created)
    const onCreated = vi.fn()
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} onCreated={onCreated} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onCreated).toHaveBeenCalledWith(created)
  })

  it('does not call onCreated when updating an existing client', async () => {
    const updateImpl = vi.fn().mockResolvedValue(client)
    const onCreated = vi.fn()
    mockClientHooks(vi.fn(), vi.fn(), updateImpl)
    renderWithToast(<ClientDrawer client={client} onClose={vi.fn()} onCreated={onCreated} />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onCreated).not.toHaveBeenCalled()
  })

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]')!)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes immediately when Cancelar is clicked on a pristine drawer', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks to confirm before discarding typed input when Cancelar is clicked', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('discards and closes once Descartar is confirmed', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the drawer and the typed value when Continuar editando is chosen', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nome')).toHaveValue('Nova Cliente')
  })

  it('prompts instead of closing when the backdrop is clicked with unsaved input', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]')!)

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prompts instead of closing when Escape is pressed with unsaved input', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.keyboard('{Escape}')

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // Dismissing the prompt hands the drawer back, still open and still filled.
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))
    expect(screen.getByRole('dialog', { name: 'Novo cliente' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Nova Cliente')
  })

  it('prompts instead of closing when the header X is clicked with unsaved input', async () => {
    const onClose = vi.fn()
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not show a delete button in create mode', () => {
    mockClientHooks(vi.fn())
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('shows the translated error when deleting a client with allocation history', async () => {
    mockClientHooks(vi.fn().mockRejectedValue({ code: 'CANNOT_DELETE_WITH_HISTORY', message: 'nope' }))
    renderWithToast(<ClientDrawer client={client} onClose={vi.fn()} />)

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
    renderWithToast(<ClientDrawer client={client} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(screen.getByText('Excluir Maria Silva?')).toBeInTheDocument()
    expect(deleteImpl).not.toHaveBeenCalled()

    // Escape dismisses the confirmation dialog on top; the drawer underneath
    // (itself now a proper dialog) stays open rather than also closing.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Excluir Maria Silva?')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()
    expect(deleteImpl).not.toHaveBeenCalled()
  })

  it('masks a typed phone number as (DDD) NNNNN-NNNN', async () => {
    mockClientHooks(vi.fn())
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Telefone'), '11987654321')

    expect(screen.getByLabelText('Telefone')).toHaveValue('(11) 98765-4321')
  })

  it('closes the drawer when delete succeeds', async () => {
    const onClose = vi.fn()
    mockClientHooks(vi.fn().mockResolvedValue(undefined))
    renderWithToast(<ClientDrawer client={client} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows a translated error and does not close the drawer when creating a client fails', async () => {
    const onClose = vi.fn()
    const createImpl = vi.fn().mockRejectedValue({ code: 'UNKNOWN', message: 'network error' })
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={onClose} />)

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
    renderWithToast(<ClientDrawer client={client} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hides Excluir when the client has allocation history, per the drawer spec', () => {
    mockClientHooks(vi.fn())
    renderWithToast(<ClientDrawer client={{ ...client, hasAllocationHistory: true }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('ClientDrawer identity documents', () => {
  it('pre-seeds CPF and RG rows for a new client', () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('CPF')).toBeInTheDocument()
    expect(screen.getByDisplayValue('RG')).toBeInTheDocument()
  })

  it('lets staff add a custom identity document row', async () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    const addButton = screen.getByRole('button', { name: /adicionar documento/i })
    await userEvent.click(addButton)
    const labelInputs = screen.getAllByLabelText(/rótulo do documento/i)
    expect(labelInputs).toHaveLength(3)
  })

  it('confirms before removing a default identity document row', async () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    const removeButtons = screen.getAllByRole('button', { name: /remover documento/i })
    await userEvent.click(removeButtons[0])
    expect(screen.getByDisplayValue('CPF')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: /remover "cpf"/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }))
    expect(screen.queryByDisplayValue('CPF')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('RG')).toBeInTheDocument()
  })

  it('cancels removal of a default identity document row without removing it', async () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    const removeButtons = screen.getAllByRole('button', { name: /remover documento/i })
    await userEvent.click(removeButtons[0])
    const dialog = screen.getByRole('dialog', { name: /remover "cpf"/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByDisplayValue('CPF')).toBeInTheDocument()
  })

  it('applies the CPF mask as staff types into a CPF row value', async () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    const valueInputs = screen.getAllByLabelText(/valor do documento/i)
    await userEvent.type(valueInputs[0], '12345678900')
    expect(valueInputs[0]).toHaveValue('123.456.789-00')
  })

  it("shows an existing client's stored identity documents, not the template defaults", () => {
    mockClientHooks()
    const existingClient: Client = {
      id: 'c1',
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      notes: '',
      identityDocuments: [{ id: 'd1', label: 'Passaporte', value: 'AB123456', maskKey: null }],
      addressLines: [],
      hasAllocationHistory: false,
      createdAt: '2026-01-01',
      contractCount: 0,
      lastRentalProductId: null,
      lastRentalDate: null,
    }
    renderWithToast(<ClientDrawer client={existingClient} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Passaporte')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('CPF')).not.toBeInTheDocument()
  })

  it('does not send blank template rows when creating a client without filling them in', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999999999')
    await userEvent.type(screen.getByLabelText('E-mail'), 'nova@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].identityDocuments).toEqual([])
  })

  it('saves successfully when a freshly added, fully blank document row is left untouched', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /adicionar documento/i }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999999999')
    await userEvent.type(screen.getByLabelText('E-mail'), 'nova@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].identityDocuments).toEqual([])
  })
})

describe('ClientDrawer address lines', () => {
  it('pre-seeds the four pt-BR address line rows for a new client', () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Endereço')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bairro')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Cidade')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Estado')).toBeInTheDocument()
  })

  it('lets staff add a custom address line row', async () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    const addButton = screen.getByRole('button', { name: /adicionar linha de endereço/i })
    await userEvent.click(addButton)
    const labelInputs = screen.getAllByLabelText(/rótulo da linha de endereço/i)
    expect(labelInputs).toHaveLength(5)
  })

  it('confirms before removing a default address line row', async () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)
    const removeButtons = screen.getAllByRole('button', { name: /remover linha de endereço/i })
    await userEvent.click(removeButtons[0])
    expect(screen.getByDisplayValue('Endereço')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: /remover "endereço"/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover' }))
    expect(screen.queryByDisplayValue('Endereço')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Bairro')).toBeInTheDocument()
  })

  it("shows an existing client's stored address lines, not the template defaults", () => {
    mockClientHooks()
    const existingClient: Client = {
      id: 'c1',
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      notes: '',
      identityDocuments: [],
      addressLines: [{ id: 'l1', label: 'Zip Code', value: '90210', sortOrder: 0, maskKey: null }],
      hasAllocationHistory: false,
      createdAt: '2026-01-01',
      contractCount: 0,
      lastRentalProductId: null,
      lastRentalDate: null,
    }
    renderWithToast(<ClientDrawer client={existingClient} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Zip Code')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Endereço')).not.toBeInTheDocument()
  })

  it('does not send blank template rows when creating a client without filling them in', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999999999')
    await userEvent.type(screen.getByLabelText('E-mail'), 'nova@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].addressLines).toEqual([])
  })

  it('normalizes a typed address line to the casing already on file for the same value', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    const otherClient: Client = {
      id: 'c-other', name: 'Outra Cliente', phone: '11988887777', email: '', notes: '',
      identityDocuments: [],
      addressLines: [{ id: 'l1', label: 'Cidade', value: 'Piedade', sortOrder: 0, maskKey: null }],
      hasAllocationHistory: false, createdAt: '2026-01-01',
      contractCount: 0, lastRentalProductId: null, lastRentalDate: null,
    }
    mockClientHooks(vi.fn(), createImpl, vi.fn(), [otherClient])
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999999999')
    await userEvent.type(screen.getByLabelText('E-mail'), 'nova@example.com')
    await userEvent.type(screen.getAllByLabelText(/valor da linha de endereço/i)[2], 'piedade')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    const savedCidade = createImpl.mock.calls[0][0].addressLines.find((line: { label: string }) => line.label === 'Cidade')
    expect(savedCidade.value).toBe('Piedade')
  })

  it('trims whitespace from a saved address line value even when nothing on file matches', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999999999')
    await userEvent.type(screen.getByLabelText('E-mail'), 'nova@example.com')
    await userEvent.type(screen.getAllByLabelText(/valor da linha de endereço/i)[2], '  Nova Cidade  ')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    const savedCidade = createImpl.mock.calls[0][0].addressLines.find((line: { label: string }) => line.label === 'Cidade')
    expect(savedCidade.value).toBe('Nova Cidade')
  })
})
