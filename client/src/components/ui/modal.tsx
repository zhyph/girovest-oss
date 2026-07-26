import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from './dialog.tsx'

export function Modal({
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
        <DialogTitle className="mb-3 text-base font-semibold text-foreground">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
