import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../src/i18n.ts'
import { App } from './App.tsx'

describe('App', () => {
  it('renders the login screen when logged out', () => {
    render(<App />)
    // "Entrar" appears both as the page title and the submit button text,
    // so assert on the button specifically rather than getByText (which
    // would throw on finding two matches).
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })
})
