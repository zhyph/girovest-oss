// Visual indicator for required form fields, rendered as generated CSS
// content rather than a real text node: a label's accessible name (and
// `getByLabelText` in tests) is computed from its text content, and a
// literal " *" there would turn "Nome" into "Nome *" for every matcher.
// The actual screen-reader signal is the `aria-required="true"` set on the
// field itself, not this mark.
export function RequiredMark() {
  return <span aria-hidden="true" className="after:ml-0.5 after:text-destructive after:content-['*']" />
}
