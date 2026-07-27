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

  it('opens an in-app calendar instead of the browser\'s native picker', async () => {
    const { container } = render(<DateInput value="2026-08-23" onChange={vi.fn()} aria-label="Data" />)

    // The native input is what dragged the browser's own language and chrome
    // into a pt-BR app; nothing may fall back to it.
    expect(container.querySelector('input[type="date"]')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /escolher data/i }))

    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  it('renders the calendar in the shop locale, not the browser locale', async () => {
    render(<DateInput value="2026-08-23" onChange={vi.fn()} aria-label="Data" />)

    await userEvent.click(screen.getByRole('button', { name: /escolher data/i }))

    expect(screen.getByText(/agosto/i)).toBeInTheDocument()
  })

  it('writes the picked day back as a YYYY-MM-DD value', async () => {
    const onChange = vi.fn()
    render(<DateInput value="2026-08-23" onChange={onChange} aria-label="Data" />)
    await userEvent.click(screen.getByRole('button', { name: /escolher data/i }))

    // Addressed by full date because the grid also renders the neighbouring
    // months' spill-over days, and narrowed to the button because the cell
    // wrapping it carries the same label.
    const dayButton = screen
      .getAllByLabelText(/5 de agosto de 2026/i)
      .find((element) => element.tagName === 'BUTTON')
    await userEvent.click(dayButton!)

    // Not toISOString(): that converts to UTC first and, anywhere behind UTC,
    // hands back the day before the one the operator clicked.
    expect(onChange).toHaveBeenLastCalledWith('2026-08-05')
  })

  it('shows a calendar button that is not part of the tab order (masked field already takes full keyboard entry)', () => {
    render(<DateInput value="" onChange={vi.fn()} aria-label="Data" />)
    const pickerButton = screen.getByRole('button', { name: 'Escolher data no calendário' })
    expect(pickerButton).toHaveAttribute('tabindex', '-1')
  })
})
