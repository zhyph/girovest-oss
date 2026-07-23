import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../src/i18n.ts'
import { App, LocaleSync } from './App.tsx'
import { useLocale } from './lib/LocaleContext.tsx'
import * as api from './lib/api.ts'
import { setToken, clearToken } from './lib/auth.ts'

describe('App', () => {
  it('renders the login screen when logged out', () => {
    render(<App />)
    // "Entrar" appears both as the page title and the submit button text,
    // so assert on the button specifically rather than getByText (which
    // would throw on finding two matches).
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
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
