import type { ReactNode } from 'react'
import type * as React from 'react'
import { Search } from 'lucide-react'
import { cn } from '../../lib/cn.ts'

/**
 * The single control strip a screen is allowed. Search, filters, and the
 * one primary action live here, in this order, on every screen — so the
 * same control is always in the same place.
 *
 * The search field used to be written out by hand in Clientes, Produtos
 * and Contratos, three times, and drifted; no screen gets a second search
 * field, and no filter belongs inside the content panel below.
 */
export function Toolbar({
  search,
  filters,
  filtersDataTour,
  extra,
  actions,
  className,
}: {
  search?: ReactNode
  filters?: ReactNode
  /** Onboarding-tour anchor for the filter row as a whole. */
  filtersDataTour?: string
  /** Secondary controls that are neither a filter nor the primary action. */
  extra?: ReactNode
  /** Right-aligned. At most one filled button among these. */
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-shrink-0 flex-wrap items-center gap-2.5 pb-3.5', className)}>
      {search}
      {filters && (
        <div className="flex items-center gap-1.5" data-tour={filtersDataTour}>
          {filters}
        </div>
      )}
      {extra}
      {actions && <div className="ml-auto flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  label,
  className,
  // The onboarding tour anchors onto the field itself, not the wrapper, so
  // the attribute has to reach the input.
  dataTour,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
  className?: string
  dataTour?: string
}) {
  return (
    <div className={cn('relative flex-[0_1_280px]', className)}>
      <Search
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-foreground-subtle"
      />
      <input
        type="search"
        data-tour={dataTour}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8.5 w-full rounded-control border border-input bg-card pr-2.5 pl-7 text-body text-foreground transition-colors placeholder:text-foreground-subtle hover:border-input-hover focus-visible:border-input-hover focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none"
      />
    </div>
  )
}

/**
 * A filter chip. Carries its own count, because "Disponíveis 1 106" answers
 * a question the label alone does not.
 */
export function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-7 rounded-full border px-3 text-meta font-medium whitespace-nowrap',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border-strong bg-transparent text-muted-foreground hover:bg-surface-sunken hover:text-foreground',
      )}
    >
      {children}
      {count !== undefined && <span className="tabular ml-1 opacity-60">{count}</span>}
    </button>
  )
}

/**
 * The screen title. Serif, once per screen — the only place besides the
 * printed contract where the app is allowed to look like a boutique.
 */
export function ScreenTitle({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1 className={cn('mb-3.5 flex-shrink-0 font-serif text-display', className)} {...props}>
      {children}
    </h1>
  )
}

/** The label step that names a group of fields or rows. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-label text-foreground-subtle uppercase', className)}>{children}</span>
  )
}
