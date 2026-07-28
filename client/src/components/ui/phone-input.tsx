import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ className, value, onChange, ...props }, ref) {
    const { config } = useLocale()
    const { format } = config.phone
    const [display, setDisplay] = useState(() => format(value))

    useEffect(() => {
      setDisplay(format(value))
    }, [value, format])

    return (
      <input
        ref={ref}
        type="tel"
        inputMode="tel"
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
          'aria-invalid:border-destructive aria-invalid:bg-destructive-subtle aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
