import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * src/index.css claims, in its own header, that every foreground/background
 * pairing it declares clears 4.5:1 in both themes. Nothing enforced it, and
 * `--foreground-subtle` shipped at 3.36–4.12:1 across all 30-odd of its real
 * usage sites — including DataList's sticky group header — behind a "large
 * text only, so 3:1 is enough" comment that the 11px labels it actually
 * styles do not qualify for.
 *
 * This measures the claim instead of restating it. Pairings listed here are
 * the ones that really occur in the components (grepped for
 * `text-<token>` next to `bg-<surface>`), not every combination the palette
 * could theoretically produce.
 */
const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf-8')

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Reads a token's literal value out of index.css. Deliberately reads the file
 * rather than a hand-copied table: a copy would keep passing after someone
 * edited the stylesheet, which is the only way this test could ever matter.
 */
function tokenValue(name: string): string {
  const match = new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm').exec(CSS)
  if (!match) throw new Error(`No literal hex declared for --${name} in index.css`)
  return match[1].toLowerCase()
}

const AA_TEXT = 4.5

describe('index.css contrast invariants', () => {
  it('self-test: the ratio maths matches the known WCAG anchors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
  })

  // Every surface `text-foreground-subtle` is painted on today. The first
  // entry is DataList's group header, the densest and lowest-contrast of them.
  const LIGHT_SURFACES = {
    'surface-sunken (DataList group header, table header, hover)': 'surface-sunken',
    'background (nav rail)': 'background',
    surface: 'surface',
    'card (list rows, tiles)': 'card',
    secondary: 'secondary',
  } as const

  const DARK_SURFACES = {
    'surface-sunken (DataList group header, table header, hover)': 'palette-dark-surface-sunken',
    'background (nav rail)': 'palette-dark-background',
    surface: 'palette-dark-surface',
    'card (list rows, tiles)': 'palette-dark-card',
    secondary: 'palette-dark-secondary',
  } as const

  it('CRITICAL: --foreground-subtle clears AA on every surface it is used on, light', () => {
    const ink = tokenValue('foreground-subtle')
    for (const [where, token] of Object.entries(LIGHT_SURFACES)) {
      expect(contrastRatio(ink, tokenValue(token)), `${ink} on ${where}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('CRITICAL: --foreground-subtle clears AA on every surface it is used on, dark', () => {
    const ink = tokenValue('palette-dark-foreground-subtle')
    for (const [where, token] of Object.entries(DARK_SURFACES)) {
      expect(contrastRatio(ink, tokenValue(token)), `${ink} on ${where}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('keeps the body-text pairings the header already pins at AA', () => {
    const pairs: [string, string][] = [
      ['foreground', 'background'],
      ['foreground', 'surface'],
      ['card-foreground', 'card'],
      ['muted-foreground', 'muted'],
      ['secondary-foreground', 'secondary'],
      ['destructive-subtle-foreground', 'destructive-subtle'],
      ['success-foreground', 'success'],
      ['warning-foreground', 'warning'],
      ['palette-dark-foreground', 'palette-dark-background'],
      ['palette-dark-card-foreground', 'palette-dark-card'],
      ['palette-dark-muted-foreground', 'palette-dark-muted'],
      ['palette-dark-secondary-foreground', 'palette-dark-secondary'],
      ['palette-dark-destructive-subtle-foreground', 'palette-dark-destructive-subtle'],
      ['palette-dark-success-foreground', 'palette-dark-success'],
      ['palette-dark-warning-foreground', 'palette-dark-warning'],
    ]
    for (const [ink, surface] of pairs) {
      expect(
        contrastRatio(tokenValue(ink), tokenValue(surface)),
        `--${ink} on --${surface}`,
      ).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })
})
