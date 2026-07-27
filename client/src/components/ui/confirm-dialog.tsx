import { Button } from './button.tsx'
import { Modal } from './modal.tsx'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmVariant = 'primary',
  confirmDisabled,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  confirmVariant?: 'primary' | 'danger'
  confirmDisabled?: boolean
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="mb-4 text-sm text-foreground">{message}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={confirmVariant} onClick={onConfirm} disabled={confirmDisabled}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
