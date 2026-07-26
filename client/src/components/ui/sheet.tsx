import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn.ts'

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-40 bg-overlay opacity-100 transition-opacity duration-200 starting:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

const SIDE_CLASSES = {
  right: 'inset-y-0 right-0 translate-x-0 border-l starting:translate-x-full',
  left: 'inset-y-0 left-0 translate-x-0 border-r starting:-translate-x-full',
} as const

function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: keyof typeof SIDE_CLASSES }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden border-border bg-card text-card-foreground shadow-lg outline-none',
          'transition-transform duration-200 ease-out',
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3',
        className,
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-base font-semibold', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('sr-only', className)}
      {...props}
    />
  )
}

function SheetClose({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      data-slot="sheet-close"
      className={cn(
        'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        className,
      )}
      {...props}
    />
  )
}

function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-body" className={cn('min-h-0 flex-1 overflow-y-auto p-4', className)} {...props} />
  )
}

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose, SheetBody }
