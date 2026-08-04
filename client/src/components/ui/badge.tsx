import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  danger: 'bg-destructive-subtle text-destructive-subtle-foreground',
  // Reserved for the contract's own signature state, which is neither good
  // nor bad news — it is the brand acting as a mark.
  accent: 'bg-secondary text-secondary-foreground',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
