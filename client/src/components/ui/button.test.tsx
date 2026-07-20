import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button.tsx'

describe('Button', () => {
  it('renders its children and responds to clicks', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Salvar</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disables the button when disabled is true', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Salvar
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Salvar' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('applies variant and size classes', () => {
    render(<Button variant="ghost" size="sm">Cancelar</Button>)
    const button = screen.getByRole('button', { name: 'Cancelar' })
    expect(button.className).toContain('h-8')
  })

  it('forwards additional className without dropping base styles', () => {
    render(<Button className="w-full">Full width</Button>)
    const button = screen.getByRole('button', { name: 'Full width' })
    expect(button.className).toContain('w-full')
    expect(button.className).toContain('inline-flex')
  })
})
