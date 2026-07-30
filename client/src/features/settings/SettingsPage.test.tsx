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
  maintenanceBufferDays: 0,
  phone: '11987654321',
  connectivityMode: 'lan',
  clauses: [
    { id: 'c1', text: 'Primeira cláusula', sortOrder: 0 },
    { id: 'c2', text: 'Segunda cláusula', sortOrder: 1 },
  ],
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
  it('renders the three appearance options with the current selection pressed', () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)

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

    await userEvent.click(screen.getByRole('button', { name: 'Escuro' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Escuro' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sistema' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the current phone and clause rows', () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    expect(screen.getByLabelText('Telefone')).toHaveValue('(11) 98765-4321')
    expect(screen.getByDisplayValue('Primeira cláusula')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Segunda cláusula')).toBeInTheDocument()
  })

  it('lets staff add a clause row', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar cláusula/i }))
    expect(screen.getAllByLabelText('Texto da cláusula')).toHaveLength(3)
  })

  it('lets staff remove a clause row', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    const removeButtons = screen.getAllByRole('button', { name: /remover cláusula/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('Primeira cláusula')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Segunda cláusula')).toBeInTheDocument()
  })

  it('saves the phone and clauses in order', async () => {
    const updateImpl = vi.fn().mockResolvedValue(settings)
    mockSettingsHooks(updateImpl)
    renderWithToast(<SettingsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith({
      phone: '11987654321',
      maintenanceBufferDays: 0,
      connectivityMode: 'lan',
      clauses: [{ text: 'Primeira cláusula' }, { text: 'Segunda cláusula' }],
    })
  })

  it('shows the connectivity mode group and submits the selected value', async () => {
    const updateImpl = vi.fn().mockResolvedValue(settings)
    mockSettingsHooks(updateImpl)
    renderWithToast(<SettingsPage />)

    const group = screen.getByRole('group', { name: 'Conectividade' })
    await userEvent.click(within(group).getByRole('radio', { name: 'Internet' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith(expect.objectContaining({ connectivityMode: 'relay' }))
  })
})

describe('tours guiados', () => {
  it('lista um botão Rever para cada seção coberta', () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)

    expect(screen.getByRole('button', { name: 'Rever tour de Painel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rever tour de Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rever tour de Produtos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rever tour de Contratos' })).toBeInTheDocument()
  })

  it('solicita o replay da seção ao clicar em Rever', async () => {
    const requestTourReplaySpy = vi.spyOn(tourReplayModule, 'requestTourReplay')
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)

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
    await screen.findByText('Configurações')
    expect(screen.queryByText('Identificador desta instalação')).not.toBeInTheDocument()
  })

  it('mostra o identificador quando o app desktop o fornece', async () => {
    ;(window as Window & { girovest?: Bridge }).girovest = {
      getInstallId: () => Promise.resolve(INSTALL),
    }
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    expect(await screen.findByText(INSTALL)).toBeInTheDocument()
    expect(screen.getByText('Identificador desta instalação')).toBeInTheDocument()
  })
})
