import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DateInput } from './date-input.tsx'

vi.mock('../../lib/LocaleContext.tsx', () => ({
  useLocale: () => ({
    locale: 'x-TEST',
    config: {
      currency: 'BRL',
      date: {
        formatDigits: () => 'MOCKED-DATE',
        digitsToIso: () => '9999-99-99',
        isoToDigits: () => '',
        placeholder: 'MOCKED',
      },
      phone: {} as never,
    },
  }),
}))

describe('DateInput locale wiring', () => {
  it('formats using the date config from useLocale(), not a hardcoded DD/MM/AAAA mask', () => {
    render(<DateInput value="2026-08-23" onChange={vi.fn()} aria-label="Data" />)
    expect(screen.getByLabelText('Data')).toHaveValue('MOCKED-DATE')
    expect(screen.getByLabelText('Data')).toHaveAttribute('placeholder', 'MOCKED')
  })
})
