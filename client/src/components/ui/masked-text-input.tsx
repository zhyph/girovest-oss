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
          'h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors',
          'hover:border-input-hover',
          'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
