# Contract Print — Fit One A4 Page

Date: 2026-07-24
Status: Approved

## Goal

The client-reported issue: a contract with a single rented product overflows
onto a second page when printed, and that second page contains only the
signature block. The contract must print on exactly one A4 sheet for the
common case (a handful of items/clauses), and the layout must degrade
gracefully (no split table rows, no orphaned signature) if a contract is long
enough that one page genuinely isn't achievable.

## Decisions

- **Print-only compact layout.** `ContractPrintView.tsx` keeps its current
  on-screen spacing untouched; a print-specific style pass (via Tailwind's
  existing `print:` variant, already used for `print:hidden`) tightens
  section gaps, margins, font size, and line-height only when printing.
  Enforce this aggressively enough that a typical one-item contract fits a
  single A4 page — this is a client-visible correctness requirement, not a
  nice-to-have.
- **Real A4 page setup.** Add an `@page { size: A4; margin: 12mm; }` rule so
  print output uses A4 with controlled margins instead of the browser's
  default paper size/margins, which is currently unset anywhere in the app.
  The exact margin value can be tuned during implementation if 12mm proves
  too tight or too loose once tested against real output.
- **No orphaned rows or signature.** Apply break-avoidance (`break-inside:
  avoid` equivalents) to each table row and to the signature block, so if a
  contract does overflow, the break happens between sections/rows, never
  through the middle of one.
- **Long contracts may still spill to a second page.** This is accepted for
  now — the fix targets the reported case (short contract, unnecessary
  overflow from loose spacing). If stress-testing with long contracts (many
  items/clauses/installments) shows this is a real problem in practice, that
  becomes a follow-up design discussion, not something this fix needs to
  solve.
- **No data/schema changes.** This is styling-only; `ContractPrintPage.tsx`
  and `ContractPrintView.tsx`'s structure/content stay the same.

## Testing

- Render a representative short contract (one product, a few clauses, no
  installments — the reported failure case) through print preview and
  confirm it fits one A4 page with no orphaned content.
- Render a stress-test contract (many rental items, many clauses, several
  installments — generated via seed/fixture data) through print preview and
  confirm the layout still fits one page where reasonably possible, and
  degrades cleanly (no split rows/orphaned signature) if it doesn't.
- Existing `ContractPrintPage.test.tsx` / `ContractPrintView.test.tsx` keep
  passing unmodified (no structural/content changes).
