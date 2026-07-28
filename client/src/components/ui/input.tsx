import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors',
          'hover:border-input-hover',
          'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
          'aria-invalid:border-destructive aria-invalid:bg-destructive-subtle aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
