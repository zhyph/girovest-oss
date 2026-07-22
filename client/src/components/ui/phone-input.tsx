import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

/**
 * BR-specific phone mask: (DDD) NNNNN-NNNN for a 9-digit mobile local number,
 * or (DDD) NNNN-NNNN for an 8-digit landline. A future non-pt-BR locale
 * would swap this formatting function rather than this component's shape.
 */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (digits.length === 0) return ''
  if (digits.length <= 2) return `(${digits}`
  const ddd = digits.slice(0, 2)
  const rest = digits.slice(2)
  if (rest.length <= 4) return `(${ddd}) ${rest}`
  const suffix = rest.slice(-4)
  const prefix = rest.slice(0, -4)
  return `(${ddd}) ${prefix}-${suffix}`
}

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ className, value, onChange, ...props }, ref) {
    const [display, setDisplay] = useState(() => formatPhone(value))

    useEffect(() => {
      setDisplay(formatPhone(value))
    }, [value])

    return (
      <input
        ref={ref}
        type="tel"
        inputMode="tel"
        value={display}
        onChange={(event) => {
          const formatted = formatPhone(event.target.value)
          setDisplay(formatted)
          onChange(formatted)
        }}
        className={cn(
          'h-10 w-full rounded-md border border-border-soft bg-white px-3 text-sm text-ink placeholder:text-muted transition-colors',
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
