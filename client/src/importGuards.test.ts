import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Regression guard for the code-splitting work: the packages below are heavy
// enough that they must never be statically imported outside the explicit
// allowlist, or they silently creep back into chunks that load before they
// are needed (worst case: the initial bundle). Dynamic `import('pkg')` is
// allowed anywhere - that is the whole point.
//
// If this test fails on your change, either:
//   1. lazy-load the package via a dynamic import() (preferred), or
//   2. consciously extend the allowlist below, and say why in your PR -
//      you are adding the package's full weight to every consumer of the
//      importing module's chunk.
const GUARDED_STATIC_IMPORTS: Record<string, readonly string[]> = {
  // qrcode is only ever needed after a click inside the QR modals; both use
  // dynamic imports. No file may import it statically.
  qrcode: [],
  // react-big-calendar (plus its stylesheet) belongs only to the lazy
  // MonthView chunk.
  'react-big-calendar': ['features/calendar/MonthView.tsx'],
  // motion drives the CountUp spring only.
  motion: ['components/CountUp.tsx'],
  // driver.js (and its stylesheet) power the guided-walkthrough tours and
  // are only ever needed from the four already-lazy route chunks that use
  // them, via this one hook. buildDriverSteps.ts only imports driver.js's
  // `DriveStep` type (erased at compile time, zero runtime cost).
  'driver.js': ['features/onboarding/useSectionTour.ts', 'features/onboarding/buildDriverSteps.ts'],
}

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url))

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

// Matches STATIC imports of the package or any of its subpaths:
//   import x from 'pkg' | export { x } from 'pkg'   -> the `from 'pkg'` clause
//   import 'pkg/style.css'                          -> bare side-effect import
// Deliberately does NOT match dynamic `import('pkg')`, which has no `from`
// clause and never follows the `import` keyword with whitespace + a quote.
// Type-only imports (`import type { X } from 'pkg'`) trip the guard too;
// they are erased at compile time, so allowlist them freely if one appears.
function staticImportPattern(pkg: string): RegExp {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\\bfrom\\s*|^\\s*import\\s+)['"]${escaped}(?:/[^'"]*)?['"]`, 'm')
}

describe('heavy-library import guards', () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT)

  it('finds a plausible number of source files', () => {
    // Sanity check that the walker is looking at the real tree, so an empty
    // scan can never masquerade as a passing guard.
    expect(sourceFiles.length).toBeGreaterThan(50)
  })

  for (const [pkg, allowlist] of Object.entries(GUARDED_STATIC_IMPORTS)) {
    it(`statically imports '${pkg}' only from the allowlist`, () => {
      const pattern = staticImportPattern(pkg)
      const offenders = sourceFiles
        .filter((file) => pattern.test(readFileSync(file, 'utf-8')))
        .map((file) => path.relative(SRC_ROOT, file))
        .sort()

      const unexpected = offenders.filter((file) => !allowlist.includes(file))
      expect(
        unexpected,
        `'${pkg}' is statically imported outside the allowlist by: ${unexpected.join(', ')}. ` +
          `Lazy-load it with a dynamic import() instead, or consciously extend the allowlist ` +
          `in ${path.basename(fileURLToPath(import.meta.url))} and justify the bundle cost in your PR.`,
      ).toEqual([])

      const stale = allowlist.filter((file) => !offenders.includes(file))
      expect(
        stale,
        `Allowlist entries for '${pkg}' no longer statically import it: ${stale.join(', ')}. ` +
          `Remove them so the allowlist stays an accurate map of where the weight lives.`,
      ).toEqual([])
    })
  }
})
