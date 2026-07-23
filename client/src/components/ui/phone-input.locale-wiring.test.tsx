import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PhoneInput } from './phone-input.tsx'

vi.mock('../../lib/LocaleContext.tsx', () => ({
  useLocale: () => ({
    locale: 'x-TEST',
    config: {
      currency: 'BRL',
      date: {} as never,
      phone: { format: () => 'MOCKED-PHONE' },
    },
  }),
}))

describe('PhoneInput locale wiring', () => {
  it('formats using the phone config from useLocale(), not a hardcoded BR mask', () => {
    render(<PhoneInput value="11987654321" onChange={vi.fn()} aria-label="Telefone" />)
    expect(screen.getByLabelText('Telefone')).toHaveValue('MOCKED-PHONE')
  })
})
