import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import i18n from '../src/i18n.ts'
import { App, LocaleSync } from './App.tsx'
import { useLocale } from './lib/LocaleContext.tsx'
import * as api from './lib/api.ts'
import { setToken, clearToken } from './lib/auth.ts'

describe('App', () => {
  it('renders the login screen when logged out', async () => {
    // The setup check has to SUCCEED for the login form to be the right
    // answer. It used to render regardless, which is the bug: on a fresh
    // install no staff row exists, so every attempt answers 401 — and
    // `useSetupStatus` is `retry: false`, so one failed request left the
    // login form as the app's terminal state with no route to the wizard.
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ needsSetup: false } as never)
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument())
  })

  it('CRITICAL: offers a way out when the setup check itself fails', async () => {
    vi.spyOn(api, 'apiFetch').mockRejectedValue(new Error('server still booting'))
    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Não foi possível verificar se a loja já foi configurada.')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    // Not the login form, which could only ever answer 401 here.
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument()
  })
})

function LocaleProbe() {
  const { locale } = useLocale()
  return <span data-testid="locale-probe">{locale}</span>
}

function renderLocaleSync() {
  const queryClient = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <LocaleSync>
          <LocaleProbe />
        </LocaleSync>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('LocaleSync', () => {
  beforeEach(() => {
    clearToken()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    i18n.changeLanguage('pt-BR')
  })

  it('defaults to pt-BR before a staff is loaded', () => {
    renderLocaleSync()
    expect(screen.getByTestId('locale-probe')).toHaveTextContent('pt-BR')
  })

  it('provides the logged-in staff locale, not the hardcoded default', async () => {
    setToken('existing-token')
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      id: '1',
      name: 'Ana',
      role: 'owner',
      locationId: 'l1',
      locationName: 'Loja',
      locale: 'en-US',
    } as never)

    renderLocaleSync()

    await waitFor(() => expect(screen.getByTestId('locale-probe')).toHaveTextContent('en-US'))
  })
})
