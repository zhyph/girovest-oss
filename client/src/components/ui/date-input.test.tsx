import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { DateInput } from './date-input.tsx'

describe('DateInput', () => {
  it('formats a stored ISO date as DD/MM/AAAA regardless of OS locale', () => {
    render(<DateInput value="2026-08-23" onChange={vi.fn()} aria-label="Data" />)
    expect(screen.getByLabelText('Data')).toHaveValue('23/08/2026')
  })

  it('shows a partial mask while digits are still being typed', async () => {
    const onChange = vi.fn()
    render(<DateInput value="" onChange={onChange} aria-label="Data" />)

    await userEvent.type(screen.getByLabelText('Data'), '2308')

    expect(screen.getByLabelText('Data')).toHaveValue('23/08')
  })

  it('emits a YYYY-MM-DD value once all 8 digits are entered', async () => {
    const onChange = vi.fn()
    render(<DateInput value="" onChange={onChange} aria-label="Data" />)

    await userEvent.type(screen.getByLabelText('Data'), '23082026')

    expect(onChange).toHaveBeenLastCalledWith('2026-08-23')
  })

  it('keeps the labelled field a plain masked text input (no OS-locale display)', () => {
    render(<DateInput value="" onChange={vi.fn()} aria-label="Data" />)
    expect(screen.getByLabelText('Data')).toHaveAttribute('type', 'text')
  })

  it('offers a native date picker as a secondary, hidden affordance behind the calendar button', () => {
    const { container } = render(<DateInput value="2026-08-23" onChange={vi.fn()} aria-label="Data" />)

    // The visible, labelled field the user types into is still the masked
    // text input above — this hidden native input exists only so the
    // calendar button can trigger the OS/browser date picker.
    const nativeDateInput = container.querySelector('input[type="date"]')
    expect(nativeDateInput).not.toBeNull()
    expect(nativeDateInput).toHaveAttribute('aria-hidden', 'true')
    expect(nativeDateInput).toHaveValue('2026-08-23')
    expect(nativeDateInput).not.toBe(screen.getByLabelText('Data'))
  })

  it('shows a calendar button that is not part of the tab order (masked field already takes full keyboard entry)', () => {
    render(<DateInput value="" onChange={vi.fn()} aria-label="Data" />)
    const pickerButton = screen.getByRole('button', { name: 'Escolher data no calendário' })
    expect(pickerButton).toHaveAttribute('tabindex', '-1')
  })
})
