import { forwardRef, useState, useEffect, useRef, useLayoutEffect, type InputHTMLAttributes } from 'react'
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

/** Letters and digits in any script — NOT `\w`, which is ASCII-only. */
const SIGNIFICANT = /[\p{L}\p{N}]/u

function countSignificant(value: string): number {
  let count = 0
  for (const char of value) {
    if (SIGNIFICANT.test(char)) count += 1
  }
  return count
}

export const MaskedTextInput = forwardRef<HTMLInputElement, MaskedTextInputProps>(
  function MaskedTextInput({ className, value, onChange, mask, ...props }, ref) {
    const format = mask ?? identityFormat
    const [display, setDisplay] = useState(() => format(value))
    const inputRef = useRef<HTMLInputElement | null>(null)
    /**
     * Where the caret should land after the mask has reformatted the text.
     *
     * Setting `value` on a controlled input moves the caret to the end, so
     * correcting one digit in the middle of a CPF threw the cursor past the
     * check digits — she deleted the lot and retyped all eleven. Counting
     * SIGNIFICANT characters rather than raw offsets is what makes this
     * survive the mask inserting or removing punctuation around the edit.
     */
    const caretTarget = useRef<number | null>(null)

    useEffect(() => {
      setDisplay(format(value))
    }, [value, format])

    useLayoutEffect(() => {
      const target = caretTarget.current
      caretTarget.current = null
      if (target === null || !inputRef.current) return
      inputRef.current.setSelectionRange(target, target)
    })

    return (
      <input
        ref={(node) => {
          inputRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="text"
        value={display}
        onChange={(event) => {
          const raw = event.target.value
          const cursor = event.target.selectionStart ?? raw.length
          const formatted = format(raw)

          if (format === identityFormat) {
            // No mask, so the browser's own caret is already right and there
            // is nothing to restore. Restoring anyway CORRUPTED typing: the
            // counting below is only meaningful for a mask that inserts
            // separators, and applying it to free text jumped the caret over
            // every character it did not count — "SSP/SP" came out "SSPSP/"
            // and "Certidão 2024" as "Certido2024 ã".
            caretTarget.current = null
          } else if (formatted === display) {
            // The mask swallowed the edit entirely (a letter typed into a
            // numeric field), so no render will commit and a target left here
            // would be applied to some LATER, unrelated render — yanking the
            // caret away from wherever she had since put it.
            caretTarget.current = null
          } else {
            // How many mask-significant characters sit before the caret.
            // Unicode-aware: an ASCII-only class would treat every accented
            // letter as a separator. The mask can add or drop punctuation on
            // either side of the edit, so the raw offset means nothing once it
            // has run — this count does.
            const significantBefore = countSignificant(raw.slice(0, cursor))
            let next = formatted.length
            let seen = 0
            for (let i = 0; i < formatted.length; i += 1) {
              if (SIGNIFICANT.test(formatted[i])) seen += 1
              if (seen >= significantBefore) {
                next = i + 1
                break
              }
            }
            caretTarget.current = significantBefore === 0 ? 0 : next
          }

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
