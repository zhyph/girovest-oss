import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

/**
 * Locale-formatted date input: displays DD/MM/AAAA (pt-BR) regardless of
 * the browser/OS locale — unlike a native <input type="date">, whose
 * displayed text follows the OS locale even when the app's own locale is
 * pt-BR. The emitted value stays a plain YYYY-MM-DD string, matching what
 * a native date input already produces, so callers don't need to change.
 */
function formatDigits(digits: string): string {
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  let out = dd
  if (digits.length > 2) out += `/${mm}`
  if (digits.length > 4) out += `/${yyyy}`
  return out
}

function digitsToIso(digits: string): string {
  if (digits.length < 8) return ''
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  return `${yyyy}-${mm}-${dd}`
}

function isoToDigits(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return ''
  const [, yyyy, mm, dd] = match
  return `${dd}${mm}${yyyy}`
}

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput({ className, value, onChange, ...props }, ref) {
    const [digits, setDigits] = useState(() => isoToDigits(value))

    useEffect(() => {
      setDigits(isoToDigits(value))
    }, [value])

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/AAAA"
        value={formatDigits(digits)}
        onChange={(event) => {
          const nextDigits = event.target.value.replace(/\D/g, '').slice(0, 8)
          setDigits(nextDigits)
          onChange(digitsToIso(nextDigits))
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
