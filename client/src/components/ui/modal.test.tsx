import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './modal.tsx'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Excluir Maria?">
        <p>conteúdo</p>
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the dialog with its title and children when open', () => {
    render(
      <Modal open onClose={vi.fn()} title="Excluir Maria?">
        <p>conteúdo</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Excluir Maria?' })).toBeInTheDocument()
    expect(screen.getByText('conteúdo')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal open onClose={onClose} title="Excluir Maria?">
        <p>conteúdo</p>
      </Modal>,
    )
    await userEvent.click(container.querySelector('[aria-hidden="true"]')!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Excluir Maria?">
        <p>conteúdo</p>
      </Modal>,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when the dialog panel itself is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Excluir Maria?">
        <p>conteúdo</p>
      </Modal>,
    )
    await userEvent.click(screen.getByText('conteúdo'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
