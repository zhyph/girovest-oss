import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import '../../i18n.ts'
import { setThemePreference } from '../../lib/useTheme.ts'
import { SettingsPage } from './SettingsPage.tsx'
import * as useLocationSettingsModule from './useLocationSettings.ts'
import * as tourReplayModule from '../onboarding/tourReplay.ts'
import { Toaster } from '../../components/ui/sonner.tsx'
import type { LocationSettings } from './settingsSchemas.ts'

const settings: LocationSettings = {
  id: 'loc1',
  name: 'Priscila Moda Festa',
  address: 'Rua das Flores, 120',
  maintenanceBufferDays: 0,
  phone: '11987654321',
  connectivityMode: 'lan',
  clauses: [
    { id: 'c1', text: 'Primeira cláusula', sortOrder: 0 },
    { id: 'c2', text: 'Segunda cláusula', sortOrder: 1 },
  ],
}

// Settings is five navigable sections now, and inactive ones are `hidden`,
// which takes them out of the accessibility tree. Tests therefore have to
// reach a section the way a user does before querying inside it.
async function goToSection(name: 'Loja' | 'Contrato' | 'Backup' | 'Aparência' | 'Suporte') {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }))
}

function renderWithToast(ui: React.ReactElement) {
  return render(<>{ui}<Toaster /></>, { wrapper: MemoryRouter })
}

function mockSettingsHooks(updateImpl: (...args: never[]) => Promise<unknown> = vi.fn()) {
  vi.spyOn(useLocationSettingsModule, 'useLocationSettings').mockReturnValue({
    data: settings,
    isLoading: false,
  } as never)
  vi.spyOn(useLocationSettingsModule, 'useUpdateLocationSettings').mockReturnValue({
    mutateAsync: updateImpl,
    isPending: false,
  } as never)
}

// The theme store is module-level, so an explicit choice made in one test
// would leak into the next; 'system' resets the store, the stored key, and
// the root class in one call.
afterEach(() => {
  setThemePreference('system')
})

describe('SettingsPage', () => {
  it('renders the three appearance options with the current selection pressed', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Aparência')

    const group = screen.getByRole('group', { name: 'Aparência' })
    const systemButton = within(group).getByRole('button', { name: 'Sistema' })
    const lightButton = within(group).getByRole('button', { name: 'Claro' })
    const darkButton = within(group).getByRole('button', { name: 'Escuro' })

    expect(systemButton).toHaveAttribute('aria-pressed', 'true')
    expect(lightButton).toHaveAttribute('aria-pressed', 'false')
    expect(darkButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies the root class, persists the choice, and moves aria-pressed on selection', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Aparência')

    await userEvent.click(screen.getByRole('button', { name: 'Escuro' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Escuro' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sistema' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the current shop identity, phone and clause rows', () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    expect(screen.getByLabelText('Nome da loja')).toHaveValue('Priscila Moda Festa')
    expect(screen.getByLabelText('Endereço')).toHaveValue('Rua das Flores, 120')
    expect(screen.getByLabelText('Telefone')).toHaveValue('(11) 98765-4321')
    expect(screen.getByDisplayValue('Primeira cláusula')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Segunda cláusula')).toBeInTheDocument()
  })

  it('lets staff add a clause row', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Contrato')
    await userEvent.click(screen.getByRole('button', { name: /adicionar cláusula/i }))
    expect(screen.getAllByLabelText('Texto da cláusula')).toHaveLength(3)
  })

  it('lets staff remove a clause row', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Contrato')
    const removeButtons = screen.getAllByRole('button', { name: /remover cláusula/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('Primeira cláusula')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Segunda cláusula')).toBeInTheDocument()
  })

  it('saves the phone and clauses in order', async () => {
    const updateImpl = vi.fn().mockResolvedValue(settings)
    mockSettingsHooks(updateImpl)
    renderWithToast(<SettingsPage />)
    await goToSection('Contrato')

    // The save bar only appears once something has actually changed, so an
    // edit is what makes saving reachable at all. Editing the first clause
    // also keeps this test's real point: the clauses submit in the order
    // they are shown, which is the order they print.
    const firstClause = screen.getAllByLabelText('Texto da cláusula')[0]
    await userEvent.clear(firstClause)
    await userEvent.type(firstClause, 'Cláusula editada')

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith({
      name: 'Priscila Moda Festa',
      address: 'Rua das Flores, 120',
      phone: '11987654321',
      maintenanceBufferDays: 0,
      connectivityMode: 'lan',
      clauses: [{ text: 'Cláusula editada' }, { text: 'Segunda cláusula' }],
    })
  })

  it('shows the connectivity mode group and submits the selected value', async () => {
    const updateImpl = vi.fn().mockResolvedValue(settings)
    mockSettingsHooks(updateImpl)
    renderWithToast(<SettingsPage />)
    await goToSection('Aparência')

    const group = screen.getByRole('group', { name: 'Conectividade' })
    await userEvent.click(within(group).getByRole('radio', { name: 'Internet' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith(expect.objectContaining({ connectivityMode: 'relay' }))
  })

  it('saves an edited shop name and address', async () => {
    const updateImpl = vi.fn().mockResolvedValue(settings)
    mockSettingsHooks(updateImpl)
    renderWithToast(<SettingsPage />)

    const nameField = screen.getByLabelText('Nome da loja')
    await userEvent.clear(nameField)
    await userEvent.type(nameField, 'Priscila Alta Costura')
    const addressField = screen.getByLabelText('Endereço')
    await userEvent.clear(addressField)
    await userEvent.type(addressField, 'Avenida Central, 4000')

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Priscila Alta Costura', address: 'Avenida Central, 4000' }),
    )
  })

  it('refuses to save an empty shop name', async () => {
    const updateImpl = vi.fn().mockResolvedValue(settings)
    mockSettingsHooks(updateImpl)
    renderWithToast(<SettingsPage />)

    await userEvent.clear(screen.getByLabelText('Nome da loja'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // A blank name would leave the nav rail and every printed contract
    // header with nothing in it.
    expect(updateImpl).not.toHaveBeenCalled()
  })
})

describe('tours guiados', () => {
  it('lista um botão Rever para cada seção coberta', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Suporte')

    expect(screen.getByRole('button', { name: 'Rever tour de Painel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rever tour de Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rever tour de Produtos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rever tour de Contratos' })).toBeInTheDocument()
  })

  it('solicita o replay da seção ao clicar em Rever', async () => {
    const requestTourReplaySpy = vi.spyOn(tourReplayModule, 'requestTourReplay')
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Suporte')

    await userEvent.click(screen.getByRole('button', { name: 'Rever tour de Clientes' }))

    expect(requestTourReplaySpy).toHaveBeenCalledWith('clients')
  })
})

describe('identificador da instalação', () => {
  const INSTALL = 'b2a4f6c8-1111-4222-8333-444455556666'
  type Bridge = { getInstallId?: () => Promise<string | null> }

  afterEach(() => {
    delete (window as Window & { girovest?: Bridge }).girovest
  })

  it('não mostra a seção no build web, onde não há ponte', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Suporte')
    await screen.findByText('Configurações')
    expect(screen.queryByText('Identificador desta instalação')).not.toBeInTheDocument()
  })

  it('mostra o identificador quando o app desktop o fornece', async () => {
    ;(window as Window & { girovest?: Bridge }).girovest = {
      getInstallId: () => Promise.resolve(INSTALL),
    }
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Suporte')
    expect(await screen.findByText(INSTALL)).toBeInTheDocument()
    expect(screen.getByText('Identificador desta instalação')).toBeInTheDocument()
  })
})

describe('SettingsPage sections', () => {
  it('splits the single column into five navigable sections, showing one at a time', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)

    for (const name of ['Loja', 'Contrato', 'Backup', 'Aparência', 'Suporte']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument()
    }

    // Loja is the landing section: its field is reachable, the clause
    // editor in another section is not. Asserted with toBeVisible rather
    // than presence — inactive panels are `hidden`, which label queries
    // still walk right past even though role queries and the browser do not.
    expect(screen.getByLabelText('Telefone')).toBeVisible()
    expect(screen.queryByRole('button', { name: /adicionar cláusula/i })).not.toBeInTheDocument()

    await goToSection('Contrato')
    expect(screen.getByRole('button', { name: /adicionar cláusula/i })).toBeVisible()
    expect(screen.getByLabelText('Telefone')).not.toBeVisible()
  })

  it('offers saving only once something has changed, and can discard back', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)

    // Nothing to save yet: the bar would otherwise sit there permanently
    // inviting a no-op write.
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Dias de higienização entre aluguéis'), '3')

    expect(screen.getByText('Alterações não salvas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
  })

  it('keeps edits made in one section when another is visited', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)

    await userEvent.type(screen.getByLabelText('Dias de higienização entre aluguéis'), '3')
    await goToSection('Contrato')
    await goToSection('Loja')

    // Sections are hidden rather than unmounted precisely so that three
    // panels of one form cannot lose state to mount order.
    expect(screen.getByLabelText('Dias de higienização entre aluguéis')).toHaveValue(3)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })
})

describe('validation feedback', () => {
  it('CRITICAL: says why a save was refused, from whichever section is on screen', async () => {
    const update = vi.fn()
    mockSettingsHooks(update)
    renderWithToast(<SettingsPage />)

    await userEvent.clear(screen.getByLabelText('Endereço'))
    // Leave Loja for a section that does not contain the offending field.
    // The panel it lives on is `hidden`, so an inline message there is
    // invisible AND out of the accessibility tree — before this, pressing
    // Salvar simply did nothing at all, with no explanation anywhere.
    await goToSection('Contrato')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(update).not.toHaveBeenCalled()
    expect(screen.getByText('Corrija os campos destacados antes de salvar.')).toBeVisible()
    // And the nav points at the section holding the bad field.
    expect(screen.getByRole('button', { name: /^Loja/ })).toHaveTextContent('Há campos a corrigir.')
  })

  it('marks an emptied required field inline and for assistive tech', async () => {
    mockSettingsHooks(vi.fn())
    renderWithToast(<SettingsPage />)

    await userEvent.clear(screen.getByLabelText('Nome da loja'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(screen.getByLabelText('Nome da loja')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('Campo obrigatório.')[0]).toBeVisible()
  })

  it('CRITICAL: marks an emptied clause instead of failing silently', async () => {
    const update = vi.fn()
    mockSettingsHooks(update)
    renderWithToast(<SettingsPage />)
    await goToSection('Contrato')

    const [firstClause] = screen.getAllByLabelText('Texto da cláusula')
    await userEvent.clear(firstClause)
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(update).not.toHaveBeenCalled()
    // An empty clause prints as a blank numbered line on the contract, so it
    // has to be rejected — visibly, on a field that looks fine when empty.
    expect(firstClause).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Escreva a cláusula ou remova-a.')).toBeVisible()
  })
})

describe('backup section without the desktop bridge', () => {
  it('CRITICAL: explains itself instead of rendering an empty tab', async () => {
    // No window.girovest: the hosted web build, and every browser anyone
    // tests the app in. This tab used to render literally nothing.
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await goToSection('Backup')

    expect(
      screen.getByText(/Backup e restauração estão disponíveis apenas no aplicativo para computador/),
    ).toBeVisible()
  })
})
