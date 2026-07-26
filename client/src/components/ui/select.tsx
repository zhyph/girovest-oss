import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

// Styled native <select>, following input.tsx's conventions so every select
// in the app lands on the same border/background/focus/invalid treatment
// instead of ad-hoc class strings at each call site.
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground transition-colors',
          'hover:border-input-hover',
          'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
          'aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
