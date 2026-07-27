import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, getDefaultClassNames, type Locale } from 'react-day-picker'
import { cn } from '../../lib/cn.ts'

/**
 * The app's calendar, styled from the same theme tokens as every other
 * surface. Replaces the browser's native date popup, which drew itself in the
 * browser's own language and chrome regardless of the shop's locale.
 */
export function Calendar({
  selected,
  onSelect,
  locale,
  defaultMonth,
  className,
}: {
  selected: Date | undefined
  onSelect: (date: Date | undefined) => void
  locale: Locale
  defaultMonth?: Date
  className?: string
}) {
  const defaults = getDefaultClassNames()

  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={onSelect}
      locale={locale}
      defaultMonth={defaultMonth ?? selected}
      showOutsideDays
      autoFocus
      components={{
        PreviousMonthButton: ({ className: buttonClassName, ...props }) => (
          <button type="button" {...props} className={cn(buttonClassName, 'cursor-pointer')}>
            <ChevronLeft size={16} />
          </button>
        ),
        NextMonthButton: ({ className: buttonClassName, ...props }) => (
          <button type="button" {...props} className={cn(buttonClassName, 'cursor-pointer')}>
            <ChevronRight size={16} />
          </button>
        ),
      }}
      className={cn('p-2 text-sm text-foreground', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: cn('relative flex flex-col gap-4', defaults.months),
        month: cn('flex w-full flex-col gap-2', defaults.month),
        nav: cn('absolute inset-x-0 top-0 flex items-center justify-between', defaults.nav),
        button_previous: cn(
          'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground aria-disabled:opacity-40',
          defaults.button_previous,
        ),
        button_next: cn(
          'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground aria-disabled:opacity-40',
          defaults.button_next,
        ),
        month_caption: cn('flex h-8 items-center justify-center px-8', defaults.month_caption),
        caption_label: cn('text-sm font-medium capitalize select-none', defaults.caption_label),
        weekdays: cn('flex', defaults.weekdays),
        weekday: cn(
          'w-9 text-xs font-normal text-muted-foreground capitalize select-none',
          defaults.weekday,
        ),
        week: cn('mt-1 flex w-full', defaults.week),
        day: cn('size-9 p-0 text-center select-none', defaults.day),
        day_button: cn(
          // react-day-picker/style.css is deliberately not imported (every rule
          // here is ours), so the centering it would supply has to be explicit.
          'flex size-9 items-center justify-center rounded-md transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          defaults.day_button,
        ),
        selected: cn(
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
          defaults.selected,
        ),
        today: cn('[&>button]:font-semibold [&>button]:text-primary', defaults.today),
        outside: cn('text-muted-foreground opacity-50', defaults.outside),
        disabled: cn('text-muted-foreground opacity-40', defaults.disabled),
        hidden: cn('invisible', defaults.hidden),
      }}
    />
  )
}
