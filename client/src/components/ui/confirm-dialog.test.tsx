import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './confirm-dialog.tsx'

const baseProps = {
  title: 'Descartar alterações?',
  message: 'As alterações não foram salvas.',
  confirmLabel: 'Descartar',
  cancelLabel: 'Continuar editando',
}

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} {...baseProps} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a dialog named by its title, with the message and both buttons', () => {
    render(<ConfirmDialog open {...baseProps} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Descartar alterações?' })).toBeInTheDocument()
    expect(screen.getByText('As alterações não foram salvas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar editando' })).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open {...baseProps} onConfirm={onConfirm} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('calls onCancel when the backdrop is clicked', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('calls onCancel when Escape is pressed', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not close when the dialog panel itself is clicked', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open {...baseProps} onConfirm={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByText('As alterações não foram salvas.'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('styles the confirm button as destructive when asked to', () => {
    render(
      <ConfirmDialog open {...baseProps} confirmVariant="danger" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Descartar' }).className).toContain('text-destructive')
  })

  it('disables the confirm button while the confirmed action is pending', () => {
    render(<ConfirmDialog open {...baseProps} confirmDisabled onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled()
  })
})
