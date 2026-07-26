import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression guard for the theming migration: components must style
// themselves through the semantic tokens declared in src/index.css
// (background, foreground, card, primary, secondary, muted, accent,
// destructive[-subtle], success, warning[-border], border, input, ring,
// overlay, ...), never through raw palette literals. The migration was
// entirely a naming convention - no test would notice a reintroduced
// `bg-white`, so this one encodes the mapping table:
//
//   bg-white            -> bg-card (surfaces) or bg-background (page)
//   bg-cream            -> bg-background (usually just delete it: body paints it)
//   bg-gray-50          -> bg-muted
//   text-ink            -> text-foreground
//   text-muted-text     -> text-muted-foreground
//   border-border-soft  -> border-border
//   text-red-*          -> text-destructive
//   border-red-*/bg-red-* -> border-destructive/30 + bg-destructive-subtle
//                            (+ text-destructive-subtle-foreground)
//   amber-*             -> border-warning-border + bg-warning + text-warning-foreground
//   brand-50/100        -> secondary or accent; brand-500/600/700 -> primary /
//                          *-foreground pairings; focus rings -> ring-ring
//   bg-ink/40, bg-black/50 scrims -> bg-overlay (one token, both palettes)
//
// If this test fails on your change, either:
//   1. restyle with the semantic token from the table above (preferred), or
//   2. consciously extend ALLOWLISTED_FILES below and say why in your PR -
//      you are declaring the file a deliberate static-palette surface that
//      must NOT follow the user's light/dark theme.
const ALLOWLISTED_FILES: readonly string[] = [
  // The printed contract is a fixed "ink on cream paper" document, not a
  // themed UI surface; its static literals are the point. See the comments
  // in both files.
  'features/contracts/ContractPrintPage.tsx',
  'features/contracts/ContractPrintView.tsx',
]

// Color-accepting utility prefixes x legacy literals. The lookarounds keep
// `border-border-soft` matching while `text-muted-foreground` (which merely
// contains "muted") does not.
const UTILITY_PREFIX =
  '(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|divide(?:-[xy])?|outline|from|via|to|placeholder|fill|stroke|shadow|accent|caret|decoration)'
const NAMED_LITERALS = '(?:white|black|cream|ink|muted-text|border-soft)'
const RAMP_LITERALS =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|brand)-\\d{2,3}'
const LEGACY_PALETTE_PATTERN = new RegExp(
  `(?<![\\w-])${UTILITY_PREFIX}-(?:${NAMED_LITERALS}|${RAMP_LITERALS})(?:/\\d{1,3})?(?![\\w-])`,
)

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (/\.(ts|tsx)$/.test(entry.name) && fullPath !== SELF) {
      // This file is excluded from its own scan: the mapping table above
      // has to be allowed to spell out the forbidden literals.
      files.push(fullPath)
    }
  }
  return files
}

describe('legacy palette literal guard', () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT)

  it('finds a plausible number of source files', () => {
    // Sanity check that the walker is looking at the real tree, so an empty
    // scan can never masquerade as a passing guard.
    expect(sourceFiles.length).toBeGreaterThan(50)
  })

  it('recognizes representative legacy literals (self-test of the pattern)', () => {
    for (const sample of [
      'className="bg-white"',
      "'text-ink p-2'",
      'hover:bg-brand-50',
      'border-border-soft',
      'focus-visible:ring-offset-cream',
      'bg-gray-50/50',
      'text-red-600',
    ]) {
      expect(sample, `pattern should catch: ${sample}`).toMatch(LEGACY_PALETTE_PATTERN)
    }
    for (const sample of [
      'text-muted-foreground',
      'bg-destructive-subtle',
      'border-border',
      'bg-overlay',
      'ring-offset-background',
    ]) {
      expect(sample, `pattern must not flag the token class: ${sample}`).not.toMatch(
        LEGACY_PALETTE_PATTERN,
      )
    }
  })

  it('uses legacy palette literals only in the allowlisted static-palette files', () => {
    const offenders = sourceFiles
      .filter((file) => LEGACY_PALETTE_PATTERN.test(readFileSync(file, 'utf-8')))
      .map((file) => path.relative(SRC_ROOT, file))
      .sort()

    const unexpected = offenders.filter((file) => !ALLOWLISTED_FILES.includes(file))
    expect(
      unexpected,
      `Legacy palette literals (white/black/cream/ink/gray-*/red-*/amber-*/brand-*/muted-text/` +
        `border-soft/...) found outside the allowlist in: ${unexpected.join(', ')}. ` +
        `Use the semantic tokens instead - see the mapping table at the top of ` +
        `${path.basename(SELF)} (e.g. bg-white -> bg-card, text-ink -> text-foreground, ` +
        `text-red-600 -> text-destructive, scrims -> bg-overlay). Only deliberate ` +
        `static-palette surfaces (like the printed contract) may extend ALLOWLISTED_FILES, ` +
        `with the reasoning in your PR.`,
    ).toEqual([])

    const stale = ALLOWLISTED_FILES.filter((file) => !offenders.includes(file))
    expect(
      stale,
      `Allowlist entries no longer contain legacy palette literals: ${stale.join(', ')}. ` +
        `Remove them so the allowlist stays an accurate map of the deliberate exceptions.`,
    ).toEqual([])
  })
})
