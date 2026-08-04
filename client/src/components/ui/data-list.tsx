import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'

export type DataListColumn<T> = {
  key: string
  /** Column header text. Omit for thumbnail / action columns. */
  header?: ReactNode
  /** A CSS grid track, e.g. '56px' or '1.5fr'. */
  width: string
  align?: 'left' | 'right' | 'center'
  cell: (row: T) => ReactNode
}

export type DataListGroup<T> = {
  key: string
  label: ReactNode
  /** Optional right-aligned figure on the group header (a count, a total). */
  meta?: ReactNode
  rows: T[]
}

export type DataListPagination = {
  /** Human-readable range, already formatted (e.g. "1–20 de 1 483"). */
  label: ReactNode
  onPrevious: () => void
  onNext: () => void
  hasPrevious: boolean
  hasNext: boolean
}

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right justify-end',
  center: 'text-center justify-center',
} as const

/**
 * The one list anatomy: a column header, optional sticky group headers,
 * 38px rows separated by a hairline, and a pagination footer.
 *
 * Deliberately not zebra-striped. The hairline already separates rows, and
 * striping consumed the only visual signal left for hover and selection —
 * which is what a master-detail split needs most, since the row you picked
 * has to stay identifiable while you read the panel beside it.
 *
 * Clients, Products and Contracts all render through this, so a list is a
 * column configuration rather than three hand-written two-column flex
 * layouts that drifted apart.
 */
export function DataList<T>({
  columns,
  groups,
  rowKey,
  onSelectRow,
  selectedKey,
  empty,
  pagination,
  className,
}: {
  columns: DataListColumn<T>[]
  groups: DataListGroup<T>[]
  rowKey: (row: T) => string
  onSelectRow?: (row: T) => void
  selectedKey?: string | null
  empty?: ReactNode
  pagination?: DataListPagination
  className?: string
}) {
  const { t } = useTranslation('common')
  const template = columns.map((column) => column.width).join(' ')
  const isEmpty = groups.every((group) => group.rows.length === 0)
  const hasHeaders = columns.some((column) => column.header !== undefined)

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {hasHeaders && (
        <div
          role="row"
          className="grid flex-shrink-0 items-center gap-3 border-b border-border-strong bg-surface-sunken px-4 text-label text-muted-foreground uppercase"
          style={{ gridTemplateColumns: template, height: 30 }}
        >
          {columns.map((column) => (
            <span key={column.key} className={ALIGN_CLASS[column.align ?? 'left']}>
              {column.header}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isEmpty
          ? empty
          : groups.map((group) => (
              <div key={group.key}>
                {group.label !== undefined && group.rows.length > 0 && (
                  // Sticky so the group you are scrolling through stays
                  // named — an alphabetical or date grouping is useless if
                  // its heading scrolls away.
                  <div
                    className="sticky top-0 z-1 flex items-center justify-between gap-2.5 border-b border-border bg-surface-sunken px-4 text-label text-foreground-subtle uppercase"
                    style={{ height: 26 }}
                  >
                    <span>{group.label}</span>
                    {group.meta !== undefined && <span className="tabular font-medium">{group.meta}</span>}
                  </div>
                )}
                {group.rows.map((row) => {
                  const key = rowKey(row)
                  const selected = selectedKey === key
                  const interactive = Boolean(onSelectRow)
                  return (
                    <div
                      key={key}
                      role={interactive ? 'button' : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      aria-current={selected ? true : undefined}
                      onClick={interactive ? () => onSelectRow?.(row) : undefined}
                      onKeyDown={
                        interactive
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                onSelectRow?.(row)
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        'grid items-center gap-3 border-b border-hairline px-4 text-left outline-none',
                        interactive && 'cursor-pointer hover:bg-surface-sunken focus-visible:bg-surface-sunken',
                        selected && 'bg-secondary outline-2 -outline-offset-2 outline-primary',
                      )}
                      style={{ gridTemplateColumns: template, minHeight: 38 }}
                    >
                      {columns.map((column) => (
                        <div
                          key={column.key}
                          className={cn('flex min-w-0 items-center', ALIGN_CLASS[column.align ?? 'left'])}
                        >
                          {column.cell(row)}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
      </div>

      {pagination && (
        <div className="flex h-10 flex-shrink-0 items-center justify-between gap-3 border-t border-border-strong bg-surface px-4">
          <span className="tabular text-meta text-muted-foreground">{pagination.label}</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={pagination.onPrevious}
              disabled={!pagination.hasPrevious}
              className="h-7 rounded-control border border-border-strong bg-surface px-2.5 text-[13px] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:border-border disabled:text-foreground-subtle disabled:hover:bg-surface"
            >
              {t('pagination.previous')}
            </button>
            <button
              type="button"
              onClick={pagination.onNext}
              disabled={!pagination.hasNext}
              className="h-7 rounded-control border border-border-strong bg-surface px-2.5 text-[13px] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:border-border disabled:text-foreground-subtle disabled:hover:bg-surface"
            >
              {t('pagination.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The single empty state. Says what was not found and offers the one action
 * that resolves it, rather than each screen inventing its own wording.
 */
export function DataListEmpty({
  title,
  hint,
  action,
}: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-8 text-center">
      <span className="size-10 rounded-panel border border-border bg-surface-sunken" aria-hidden="true" />
      <span className="text-body font-semibold">{title}</span>
      {hint && <span className="max-w-[36ch] text-meta text-muted-foreground">{hint}</span>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
