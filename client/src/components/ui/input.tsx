import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-md border border-border-soft bg-white px-3 text-sm text-ink placeholder:text-muted-text transition-colors',
          'hover:border-brand-300',
          'focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
