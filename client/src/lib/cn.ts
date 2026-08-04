import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The seven type steps declared in index.css. tailwind-merge has to be told
 * about them explicitly: it resolves conflicts from a built-in table of
 * Tailwind's own scale, and anything it does not recognise in the `text-*`
 * namespace it treats as a text *colour*.
 *
 * Without this, `cn('text-metric', 'text-foreground')` silently dropped the
 * size — the two looked like competing colours — and the dashboard's headline
 * numbers rendered at body size. Every custom step was one `cn()` call with a
 * colour away from the same fate.
 */
const TYPE_STEPS = ['display', 'metric', 'heading', 'body', 'meta', 'label'] as const

/**
 * The four radii, likewise: `rounded-panel` next to any other `rounded-*`
 * would otherwise be resolved by name-matching against Tailwind's own scale.
 */
const RADII = ['badge', 'control', 'panel', 'dialog'] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_STEPS] }],
      rounded: [{ rounded: [...RADII] }],
      shadow: [{ shadow: ['panel', 'overlay'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
