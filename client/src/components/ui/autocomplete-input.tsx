import { useId, useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'
import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import { Popover, PopoverAnchor, PopoverContent } from './popover.tsx'

type AutocompleteInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'> & {
  value: string
  onChange: (value: string) => void
  /** Values already in use elsewhere in the shop; never a closed set. */
  suggestions: string[]
}

/**
 * A text field that offers what the shop has typed before without ever
 * restricting the answer to it — categories, sizes and colours repeat
 * constantly, but a new one has to stay one keystroke away.
 *
 * Built on Popover rather than a plain absolutely-positioned list because
 * these fields sit inside scrolling drawers, where an in-flow panel gets
 * clipped; the portal also brings outside-click and Escape dismissal for free.
 * A native `<datalist>` would do the matching, but its popup is drawn by the
 * browser and ignores the app's styling.
 */
export function AutocompleteInput({
  className,
  value,
  onChange,
  suggestions,
  onFocus,
  onKeyDown,
  ...props
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const seen = new Set<string>()
    const unique = suggestions.filter((suggestion) => {
      const key = foldForSearch(suggestion)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    const query = foldForSearch(value)
    const filtered = query ? unique.filter((suggestion) => foldForSearch(suggestion).includes(query)) : unique
    // A suggestion identical to what's already typed is not worth showing —
    // the field already says it — but that shouldn't hide other, longer
    // suggestions that also match (e.g. typing "Festa" exactly still leaves
    // "Festa Junina" worth offering).
    const withoutExactMatch = query ? filtered.filter((suggestion) => foldForSearch(suggestion) !== query) : filtered
    return withoutExactMatch.sort((a, b) => a.localeCompare(b)).slice(0, 8)
  }, [suggestions, value])

  const showList = isOpen && matches.length > 0
  // `matches` can shrink under a held highlight: `suggestions` comes from the
  // products query, which refetches on window focus and on any mutation that
  // invalidates ['products']. Reading a stale index would commit `undefined`
  // and silently blank the field, so the index is clamped at read time rather
  // than only reset on keystrokes.
  const activeIndex = highlighted < matches.length ? highlighted : -1
  const optionId = (index: number) => `${listId}-option-${index}`

  function commit(suggestion: string) {
    onChange(suggestion)
    setIsOpen(false)
    setHighlighted(-1)
  }

  return (
    <Popover open={showList} onOpenChange={setIsOpen}>
      <PopoverAnchor asChild>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setIsOpen(true)
            setHighlighted(-1)
          }}
          onFocus={(event) => {
            setIsOpen(true)
            onFocus?.(event)
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (event.defaultPrevented) return
            if (event.key === 'ArrowDown' && matches.length > 0) {
              event.preventDefault()
              setIsOpen(true)
              setHighlighted((current) => (current + 1) % matches.length)
            } else if (event.key === 'ArrowUp' && matches.length > 0) {
              event.preventDefault()
              setIsOpen(true)
              setHighlighted((current) => (current <= 0 ? matches.length - 1 : current - 1))
            } else if (event.key === 'Enter' && showList && activeIndex >= 0) {
              // Only swallow Enter when a suggestion is actually highlighted;
              // otherwise it must still submit the form.
              event.preventDefault()
              commit(matches[activeIndex])
            }
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
      </PopoverAnchor>
      <PopoverContent
        id={listId}
        role="listbox"
        className="max-h-56 w-[var(--radix-popover-trigger-width)] overflow-y-auto"
        // Focus has to stay in the field: this is a text input that suggests,
        // not a menu that takes over.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // A press inside the panel must not blur the input before it lands.
        onMouseDown={(event) => event.preventDefault()}
      >
        {matches.map((suggestion, index) => (
          <button
            key={suggestion}
            id={optionId(index)}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => {
              commit(suggestion)
              inputRef.current?.focus()
            }}
            onMouseEnter={() => setHighlighted(index)}
            className={cn(
              'block w-full rounded-sm px-3 py-1.5 text-left text-sm text-foreground transition-colors',
              index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary',
            )}
          >
            {suggestion}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
