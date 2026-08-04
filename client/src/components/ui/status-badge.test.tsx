import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { StatusBadge, STATE_TONE, type EntityState } from './status-badge.tsx'

const ALL_STATES = Object.keys(STATE_TONE) as EntityState[]

describe('StatusBadge', () => {
  it('has a label for every state in the closed list', () => {
    // The state list is the contract between Produtos, Contratos,
    // Calendário and Painel. A state without a label would render as its
    // raw i18n key in whichever screen happened to use it first.
    for (const state of ALL_STATES) {
      const { unmount } = render(<StatusBadge state={state} />)
      const text = screen.getByText(/\S/).textContent ?? ''
      expect(text, `${state} should have a translated label`).not.toContain('states.')
      expect(text.trim().length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('gives the same state the same colour wherever it appears', () => {
    // `rented` (a product) and `checked_out` (an allocation) are the same
    // real-world state seen from two tables, so they must not read as two
    // different things.
    expect(STATE_TONE.rented).toBe(STATE_TONE.checked_out)

    const { container: rented } = render(<StatusBadge state="rented" />)
    const { container: checkedOut } = render(<StatusBadge state="checked_out" />)
    expect(rented.firstElementChild?.className).toBe(checkedOut.firstElementChild?.className)
    expect(rented.textContent).toBe(checkedOut.textContent)
  })

  it('maps each state to the tone its meaning implies', () => {
    expect(STATE_TONE.available).toBe('success')
    expect(STATE_TONE.returned).toBe('success')
    expect(STATE_TONE.paid).toBe('success')
    expect(STATE_TONE.overdue).toBe('danger')
    expect(STATE_TONE.reserved).toBe('neutral')
    expect(STATE_TONE.signed).toBe('accent')
  })

  it('strikes through a cancelled state so it cannot be confused with reserved', () => {
    // Both are neutral-toned; without the strike they would be the same
    // badge with different words.
    const { container: cancelled } = render(<StatusBadge state="cancelled" />)
    const { container: reserved } = render(<StatusBadge state="reserved" />)
    expect(cancelled.firstElementChild?.className).toContain('line-through')
    expect(reserved.firstElementChild?.className).not.toContain('line-through')
  })
})
