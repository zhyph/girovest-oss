import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'icon'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
  secondary:
    'bg-white text-ink border border-border-soft hover:border-brand-300 hover:bg-brand-50 active:bg-brand-100',
  ghost: 'bg-transparent text-ink hover:bg-brand-50 active:bg-brand-100',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  icon: 'h-10 w-10 p-0',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-cream',
        'disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  )
}
