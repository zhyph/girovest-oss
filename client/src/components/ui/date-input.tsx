import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { isValidIsoDate, parseDateOnly, toIsoDateOnly } from '../../lib/date.ts'
import { Calendar } from './calendar.tsx'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './popover.tsx'

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
    const [isPickerOpen, setIsPickerOpen] = useState(false)

    useEffect(() => {
      setDigits(isoToDigits(value))
    }, [value, isoToDigits])

    const isIncomplete = digits.length < 8
    const isInvalidDate = !isIncomplete && !isValidIsoDate(digitsToIso(digits))
    const invalid = ariaInvalid || (!isIncomplete && isInvalidDate) || undefined
    const selected = isValidIsoDate(value) ? parseDateOnly(value) : undefined

    return (
      // The typed field stays the primary way in — it is faster than any
      // calendar for a date the operator already knows. The popover replaces
      // the native picker, which rendered in the browser's language and chrome
      // no matter what locale the shop runs in.
      <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
        <PopoverAnchor asChild>
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
                'h-10 w-full rounded-md border border-input bg-card py-2 pr-9 pl-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors',
                'hover:border-input-hover',
                'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
                'aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/30',
                'disabled:cursor-not-allowed disabled:opacity-50',
                className,
              )}
              {...props}
            />
            <PopoverTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('actions.pickDate')}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1.5 text-muted-foreground transition-colors hover:text-primary"
              >
                <CalendarIcon size={16} />
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            // Remounts the pane when the typed date moves to another day, since
            // defaultMonth only seeds the month at mount.
            key={isValidIsoDate(value) ? value : 'empty'}
            selected={selected}
            locale={config.calendar}
            onSelect={(date) => {
              if (!date) return
              onChange(toIsoDateOnly(date))
              setIsPickerOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    )
  },
)
