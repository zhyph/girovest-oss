import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent, DialogTitle } from './dialog.tsx'

// These assertions moved here from the deleted `Modal` wrapper. Modal was a
// third overlay system with its own radius, padding and header; it is gone,
// but the dismissal semantics it guaranteed are now Dialog's, so the
// coverage follows the behaviour rather than the file. This helper is the
// same preset the decision dialogs in ContractsPage use.
function DecisionDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-5">
        <DialogTitle className="mb-3 text-heading">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <DecisionDialog open={false} onClose={vi.fn()} title="Excluir Maria?">
        <p>conteúdo</p>
      </DecisionDialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the dialog with its title and children when open', () => {
    render(
      <DecisionDialog open onClose={vi.fn()} title="Excluir Maria?">
        <p>conteúdo</p>
      </DecisionDialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Excluir Maria?' })).toBeInTheDocument()
    expect(screen.getByText('conteúdo')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(
      <DecisionDialog open onClose={onClose} title="Excluir Maria?">
        <p>conteúdo</p>
      </DecisionDialog>,
    )
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(
      <DecisionDialog open onClose={onClose} title="Excluir Maria?">
        <p>conteúdo</p>
      </DecisionDialog>,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when the dialog panel itself is clicked', async () => {
    const onClose = vi.fn()
    render(
      <DecisionDialog open onClose={onClose} title="Excluir Maria?">
        <p>conteúdo</p>
      </DecisionDialog>,
    )
    await userEvent.click(screen.getByText('conteúdo'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('carries the overlay radius and elevation, not the field radius', () => {
    render(
      <DecisionDialog open onClose={vi.fn()} title="Excluir Maria?">
        <p>conteúdo</p>
      </DecisionDialog>,
    )
    // A dialog previously shared the radius of the inputs inside it, so it
    // carried no more visual weight than its own content.
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveClass('rounded-dialog', 'shadow-overlay')
  })
})
