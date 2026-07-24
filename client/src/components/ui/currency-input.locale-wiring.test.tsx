import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CurrencyInput } from './currency-input.tsx'

vi.mock('../../lib/LocaleContext.tsx', () => ({
  useLocale: () => ({
    locale: 'en-US',
    config: { currency: 'USD', date: {} as never, phone: {} as never },
  }),
}))

describe('CurrencyInput locale wiring', () => {
  it('formats using the currency/locale from useLocale(), not a hardcoded BRL', () => {
    render(<CurrencyInput value={1234.5} onChange={vi.fn()} aria-label="Preço" />)
    const expected = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1234.5)
    expect(screen.getByLabelText('Preço')).toHaveValue(expected)
  })
})
