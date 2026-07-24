import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

type MaskedTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
  mask?: (raw: string) => string
}

// Module-level so its reference is stable across renders — inlining this
// as a fallback (mask ?? ((raw) => raw)) would create a new function every
// render whenever no mask is provided, making the effect below re-run on
// every render instead of only when `value` actually changes.
function identityFormat(raw: string): string {
  return raw
}

export const MaskedTextInput = forwardRef<HTMLInputElement, MaskedTextInputProps>(
  function MaskedTextInput({ className, value, onChange, mask, ...props }, ref) {
    const format = mask ?? identityFormat
    const [display, setDisplay] = useState(() => format(value))

    useEffect(() => {
      setDisplay(format(value))
    }, [value, format])

    return (
      <input
        ref={ref}
        type="text"
        value={display}
        onChange={(event) => {
          const formatted = format(event.target.value)
          setDisplay(formatted)
          onChange(formatted)
        }}
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
