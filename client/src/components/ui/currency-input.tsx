import { forwardRef, useMemo, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'

function parseDigitsToNumber(raw: string): number {
  const digitsOnly = raw.replace(/\D/g, '')
  if (digitsOnly === '') return 0
  return Number(digitsOnly) / 100
}

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onChange: (value: number) => void
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput({ className, value, onChange, ...props }, ref) {
    const { locale, config } = useLocale()
    const currencyFormatter = useMemo(
      () => new Intl.NumberFormat(locale, { style: 'currency', currency: config.currency }),
      [locale, config.currency],
    )
    const [display, setDisplay] = useState(() => currencyFormatter.format(value))

    useEffect(() => {
      setDisplay(currencyFormatter.format(value))
    }, [value, currencyFormatter])

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(event) => {
          const nextValue = parseDigitsToNumber(event.target.value)
          setDisplay(currencyFormatter.format(nextValue))
          onChange(nextValue)
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
