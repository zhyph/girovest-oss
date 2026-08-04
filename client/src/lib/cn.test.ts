import { describe, it, expect } from 'vitest'
import { cn } from './cn.ts'

// tailwind-merge resolves conflicts from a built-in table of Tailwind's own
// scale. Every step and radius declared in index.css is invisible to that
// table unless cn() is told about it, and anything unrecognised in the
// `text-*` namespace is assumed to be a colour. The failure is silent: the
// class is dropped and the element falls back to inherited type, which no
// rendering test notices because the text is still there.
describe('cn', () => {
  it('keeps a custom type step when it is combined with a text colour', () => {
    const result = cn('tabular text-metric', 'text-foreground')
    expect(result).toContain('text-metric')
    expect(result).toContain('text-foreground')
  })

  it.each(['display', 'metric', 'heading', 'body', 'meta', 'label'])(
    'keeps text-%s alongside a colour',
    (step) => {
      expect(cn(`text-${step}`, 'text-muted-foreground')).toContain(`text-${step}`)
    },
  )

  it('still lets one type step override another', () => {
    // The point is to teach it the scale, not to disable merging: two sizes
    // must still collapse to the last one.
    const result = cn('text-body', 'text-heading')
    expect(result).toContain('text-heading')
    expect(result).not.toContain('text-body')
  })

  it('still lets one colour override another', () => {
    const result = cn('text-foreground', 'text-muted-foreground')
    expect(result).toContain('text-muted-foreground')
    expect(result).not.toContain('text-foreground')
  })

  it('treats the custom radii as one group', () => {
    expect(cn('rounded-panel', 'rounded-dialog')).toBe('rounded-dialog')
    expect(cn('rounded-control', 'border')).toContain('rounded-control')
  })

  it('treats the custom elevations as one group', () => {
    expect(cn('shadow-panel', 'shadow-overlay')).toBe('shadow-overlay')
  })
})
