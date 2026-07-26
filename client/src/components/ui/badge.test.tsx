import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge.tsx'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge tone="success">Disponível</Badge>)
    expect(screen.getByText('Disponível')).toBeInTheDocument()
  })

  it('applies the tone-specific color classes', () => {
    render(<Badge tone="danger">Atrasado</Badge>)
    expect(screen.getByText('Atrasado')).toHaveClass('bg-destructive-subtle', 'text-destructive-subtle-foreground')
  })
})
