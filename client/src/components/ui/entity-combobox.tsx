import { useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import { Popover, PopoverAnchor, PopoverContent } from './popover.tsx'

const MAX_VISIBLE_ROWS = 20

export interface EntityComboboxRow {
  id: string
  label: string
  sublabel?: string
}

type EntityComboboxProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onSelect'> & {
  /**
   * Forwarded to the trigger button and merged with the internal ref this
   * component already needs for focus-restore-on-close. Callers pass RHF's
   * `field.ref` here so `shouldFocusError` has a real, focusable node to
   * land on — without it, a Controller-driven field is invisible to RHF's
   * error-focus walk and submit-with-errors silently focuses some other,
   * unrelated field instead.
   */
  ref?: Ref<HTMLButtonElement>
  rows: EntityComboboxRow[]
  value: string
  onSelect: (id: string) => void
  onCreateNew: (query: string) => void
  createLabel: (query: string) => string
  duplicateHint: (query: string) => string | undefined
  placeholder?: string
  /** Shown in the panel when there are zero rows and the search is still empty, so the panel is never completely blank. */
  emptyHint?: string
  /** Shown as a non-interactive footer line when a query matches more rows than are actually rendered. */
  moreResultsHint?: (shown: number, total: number) => string
}

/**
 * An id-based combobox: search-filters a list of rows and always offers a
 * trailing "create new" action, built on the same Popover + foldForSearch
 * pattern as AutocompleteInput. Unlike AutocompleteInput this is not
 * free-solo text — the trigger shows the selected row's label, and typing
 * only searches, it never becomes the field's value directly.
 *
 * ARIA note: role="combobox" lives on the trigger button and role="searchbox"
 * on the popover's input, unlike AutocompleteInput which puts role="combobox"
 * on the text field itself. That's deliberate, not an inconsistency: this is
 * a button-triggered id-picker (the trigger shows a selected row's label,
 * not free text the user is typing), so the two roles necessarily split
 * across the trigger and the search input instead of living on one element.
 */
export function EntityCombobox({
  className,
  ref,
  rows,
  value,
  onSelect,
  onCreateNew,
  createLabel,
  duplicateHint,
  placeholder = '—',
  emptyHint,
  moreResultsHint,
  ...props
}: EntityComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const listId = useId()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectedRow = rows.find((row) => row.id === value) ?? null

  const matches = useMemo(() => {
    const folded = foldForSearch(query)
    return folded
      ? rows.filter((row) => foldForSearch(`${row.label} ${row.sublabel ?? ''}`).includes(folded))
      : rows
  }, [rows, query])

  const filteredRows = useMemo(() => matches.slice(0, MAX_VISIBLE_ROWS), [matches])
  const isTruncated = matches.length > MAX_VISIBLE_ROWS

  const trimmedQuery = query.trim()
  const showCreateRow = trimmedQuery !== ''
  const optionCount = filteredRows.length + (showCreateRow ? 1 : 0)
  // Clamped at read time, not only reset on keystrokes: `rows` comes from a
  // query that can refetch (window focus, any mutation) while the popover
  // is open and a held highlight could otherwise point past the new end.
  const activeIndex = optionCount > 0 ? Math.min(highlighted, optionCount - 1) : -1
  const hint = showCreateRow ? duplicateHint(trimmedQuery) : undefined
  const optionId = (index: number) => `${listId}-option-${index}`

  function openFresh() {
    setQuery('')
    setHighlighted(0)
    setIsOpen(true)
  }

  function commitIndex(index: number) {
    if (index < filteredRows.length) {
      onSelect(filteredRows[index].id)
    } else if (showCreateRow) {
      onCreateNew(trimmedQuery)
    }
    setIsOpen(false)
    setQuery('')
  }

  return (
    <Popover open={isOpen} onOpenChange={(next) => !next && setIsOpen(false)}>
      <PopoverAnchor asChild>
        <button
          ref={(node) => {
            triggerRef.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          onClick={() => (isOpen ? setIsOpen(false) : openFresh())}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 text-sm transition-colors',
            'hover:border-input-hover',
            'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
            'aria-invalid:border-destructive aria-invalid:bg-destructive-subtle aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/30',
            className,
          )}
          {...props}
        >
          <span className={cn('truncate text-left', selectedRow ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedRow ? selectedRow.label : placeholder}
          </span>
          <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          // PopoverAnchor (not PopoverTrigger) is used above so the panel can
          // anchor to the whole field while typing stays in the search input,
          // but that means Radix never learns the trigger to restore focus to
          // on close — without this, focus would drop to <body> after every
          // pick, create, or Escape.
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <input
          ref={searchInputRef}
          type="text"
          role="searchbox"
          aria-label="Buscar"
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && optionCount > 0) {
              event.preventDefault()
              setHighlighted((current) => (current + 1) % optionCount)
            } else if (event.key === 'ArrowUp' && optionCount > 0) {
              event.preventDefault()
              setHighlighted((current) => (current <= 0 ? optionCount - 1 : current - 1))
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault()
              commitIndex(activeIndex)
            }
          }}
          placeholder={placeholder}
          className="mb-2 h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <div id={listId} role="listbox" className="max-h-56 overflow-y-auto">
          {filteredRows.length === 0 && trimmedQuery === '' && emptyHint && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{emptyHint}</p>
          )}
          {filteredRows.map((row, index) => (
            <button
              key={row.id}
              id={optionId(index)}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => commitIndex(index)}
              onMouseEnter={() => setHighlighted(index)}
              className={cn(
                'flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm text-foreground transition-colors',
                index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary',
              )}
            >
              <span>{row.label}</span>
              {row.sublabel && <span className="text-xs text-muted-foreground">{row.sublabel}</span>}
            </button>
          ))}
          {isTruncated && moreResultsHint && (
            // Non-interactive: sits between the visible rows and the always-present
            // create row so a search matching more than MAX_VISIBLE_ROWS never reads
            // as "nothing else matches" right above a "create new" affordance.
            <p className="px-2 py-1.5 text-xs text-muted-foreground" aria-live="polite">
              {moreResultsHint(filteredRows.length, matches.length)}
            </p>
          )}
          {showCreateRow && (
            <button
              id={optionId(filteredRows.length)}
              type="button"
              role="option"
              aria-selected={filteredRows.length === activeIndex}
              onClick={() => commitIndex(filteredRows.length)}
              onMouseEnter={() => setHighlighted(filteredRows.length)}
              className={cn(
                'flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors',
                filteredRows.length === activeIndex ? 'bg-secondary' : 'hover:bg-secondary',
              )}
            >
              <span>{createLabel(trimmedQuery)}</span>
              {hint && <span className="text-xs font-normal text-warning-foreground">{hint}</span>}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
