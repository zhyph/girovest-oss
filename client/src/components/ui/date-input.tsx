import { forwardRef, useRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { isValidIsoDate } from '../../lib/date.ts'

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput({ className, value, onChange, 'aria-invalid': ariaInvalid, ...props }, ref) {
    const { t } = useTranslation('common')
    const { config } = useLocale()
    const { formatDigits, digitsToIso, isoToDigits, placeholder } = config.date
    const [digits, setDigits] = useState(() => isoToDigits(value))
    const nativeDateRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
      setDigits(isoToDigits(value))
    }, [value, isoToDigits])

    const isIncomplete = digits.length < 8
    const isInvalidDate = !isIncomplete && !isValidIsoDate(digitsToIso(digits))
    const invalid = ariaInvalid || (!isIncomplete && isInvalidDate) || undefined

    return (
      <div className="relative">
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          value={formatDigits(digits)}
          aria-invalid={invalid}
          onChange={(event) => {
            const nextDigits = event.target.value.replace(/\D/g, '').slice(0, 8)
            setDigits(nextDigits)
            onChange(digitsToIso(nextDigits))
          }}
          className={cn(
            'h-10 w-full rounded-md border border-border-soft bg-white py-2 pr-9 pl-3 text-sm text-ink placeholder:text-muted-text transition-colors',
            'hover:border-brand-300',
            'focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
            'aria-invalid:border-red-400 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/30',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('actions.pickDate')}
          onClick={() => nativeDateRef.current?.showPicker?.()}
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1.5 text-muted-text transition-colors hover:text-brand-600"
        >
          <CalendarIcon size={16} />
        </button>
        <input
          ref={nativeDateRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={isValidIsoDate(value) ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </div>
    )
  },
)
