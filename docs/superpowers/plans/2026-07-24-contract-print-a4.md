# Contract Print A4 Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the printed contract fit exactly one A4 page for the common case (the reported bug: a one-item contract spilling a lone signature onto page 2), while degrading cleanly (no split rows, no orphaned signature) for unusually long contracts.

**Architecture:** Print-only CSS changes to `ContractPrintView.tsx` (via Tailwind's existing `print:` variant) plus a real `@page` rule in `index.css`. No data/schema/component-structure changes. Verified end-to-end with a Playwright test that renders the print page to a real PDF and checks the page count with `pdfinfo`, using two fixed, seeded contracts (one matching the original bug report, one an intentional worst-case stress contract).

**Tech Stack:** React 19 + Tailwind CSS v4 (client), Prisma + SQLite (server), Vitest + React Testing Library (unit), Playwright (e2e), `pdfinfo` (poppler-utils) for PDF page counting.

## Global Constraints

- Contract must render on **exactly one A4 page** for the reported case (one rental item, a typical 3-installment payment plan, the Location's real clause set) — from `docs/superpowers/specs/2026-07-24-contract-print-a4-design.md`.
- Long contracts (many items/installments) may still spill to a second page — accepted for now; the e2e test only guards against a gross regression (5+ pages), not against exactly 1 vs 2, for that case.
- No split table rows and no orphaned signature block across a page break, regardless of contract length.
- No changes to on-screen (non-print) layout, and no data/schema changes.
- Running the new e2e test requires `pdfinfo` (part of `poppler-utils`) on PATH. It's already present in this project's dev environment; if missing elsewhere, install via the OS package manager (e.g. `apt install poppler-utils`, `brew install poppler`).

---

### Task 1: Seed fixed-ID contracts for print testing

**Files:**
- Create: `server/seed-e2e-contract-print.ts`
- Modify: `server/README.md:99-117` (document the new script alongside `seed-e2e.ts`)

**Interfaces:**
- Consumes: the `Location`/`Staff` row created by `server/seed-e2e.ts` (login `e2e-staff`), found via `prisma.staff.findUnique({ where: { login: 'e2e-staff' } })`.
- Produces: two fixed-ID `Contract` rows the e2e test in Task 2 navigates to directly — `e2e-print-short-contract` (number 9001, one allocation, 3 installments) and `e2e-print-stress-contract` (number 9002, 15 allocations, 8 installments). Also six fixed-ID `LocationContractClause` rows (the real `DEFAULT_CONTRACT_CLAUSES`) on the shared e2e `Location`.

- [ ] **Step 1: Write the seed script**

```ts
// server/seed-e2e-contract-print.ts
import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'
import { DEFAULT_CONTRACT_CLAUSES } from './src/constants/defaultContractClauses.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const staff = await prisma.staff.findUnique({ where: { login: 'e2e-staff' } })
if (!staff) {
  throw new Error('e2e-staff not found — run `npx tsx seed-e2e.ts` first.')
}

// Use the real production clause text (not shorter placeholders) — this is
// what actually reproduces the reported print overflow, verified directly
// during Task 2 (see the design spec for the root-cause note).
// SQLite doesn't support `skipDuplicates` on createMany, so upsert one at a time.
for (let i = 0; i < DEFAULT_CONTRACT_CLAUSES.length; i += 1) {
  // `update` syncs text/sortOrder on every run, not just `{}` — a dev.db seeded
  // by an older version of this script (shorter placeholder clause text) would
  // otherwise keep the stale text forever, since the id already exists.
  await prisma.locationContractClause.upsert({
    where: { id: `e2e-print-clause-${i + 1}` },
    update: { locationId: staff.locationId, sortOrder: i, text: DEFAULT_CONTRACT_CLAUSES[i] },
    create: { id: `e2e-print-clause-${i + 1}`, locationId: staff.locationId, sortOrder: i, text: DEFAULT_CONTRACT_CLAUSES[i] },
  })
}

const client = await prisma.client.upsert({
  where: { id: 'e2e-print-client' },
  update: {},
  create: {
    id: 'e2e-print-client',
    name: 'Cliente Impressão E2E',
    phone: '11999990010',
    email: 'print-e2e@example.com',
  },
})

// Short contract: the originally reported bug — one item, a typical 3-installment
// payment plan. Zero installments does NOT reproduce the overflow (verified
// directly) — a modest installment table is part of what tips a one-item
// contract onto a 2nd page, alongside the real clause text above.
const shortProduct = await prisma.product.upsert({
  where: { id: 'e2e-print-short-product' },
  update: {},
  create: {
    id: 'e2e-print-short-product',
    locationId: staff.locationId,
    name: 'Vestido Curto Impressão E2E',
    category: 'festa',
    size: 'M',
    color: 'azul',
    rentalPrice: 250,
    depositAmount: 150,
  },
})

const shortContract = await prisma.contract.upsert({
  where: { id: 'e2e-print-short-contract' },
  update: {},
  create: {
    id: 'e2e-print-short-contract',
    number: 9001,
    locationId: staff.locationId,
    clientId: client.id,
    staffId: staff.id,
    eventDate: new Date('2027-03-01'),
    paymentMethod: 'PIX',
  },
})

await prisma.allocation.upsert({
  where: { id: 'e2e-print-short-allocation' },
  update: {},
  create: {
    id: 'e2e-print-short-allocation',
    productId: shortProduct.id,
    clientId: client.id,
    staffId: staff.id,
    contractId: shortContract.id,
    checkoutDate: new Date('2027-02-27'),
    dueDate: new Date('2027-03-02'),
    status: 'reserved',
    priceCharged: 250,
  },
})

const shortInstallments = [
  { dueDate: new Date('2027-01-15'), amount: 100, paid: true },
  { dueDate: new Date('2027-02-01'), amount: 100, paid: false },
  { dueDate: new Date('2027-02-27'), amount: 50, paid: false },
]
for (let i = 0; i < shortInstallments.length; i += 1) {
  await prisma.installment.upsert({
    where: { id: `e2e-print-short-installment-${i + 1}` },
    update: shortInstallments[i],
    create: { id: `e2e-print-short-installment-${i + 1}`, contractId: shortContract.id, ...shortInstallments[i] },
  })
}

// Stress contract: worst case for the print layout — 15 items, 8 installments.
const stressContract = await prisma.contract.upsert({
  where: { id: 'e2e-print-stress-contract' },
  update: {},
  create: {
    id: 'e2e-print-stress-contract',
    number: 9002,
    locationId: staff.locationId,
    clientId: client.id,
    staffId: staff.id,
    eventDate: new Date('2027-03-01'),
    paymentMethod: 'Dinheiro',
  },
})

for (let i = 1; i <= 15; i += 1) {
  const product = await prisma.product.upsert({
    where: { id: `e2e-print-stress-product-${i}` },
    update: {},
    create: {
      id: `e2e-print-stress-product-${i}`,
      locationId: staff.locationId,
      name: `Vestido Stress E2E ${i}`,
      category: 'festa',
      size: 'M',
      color: 'azul',
      rentalPrice: 200 + i,
      depositAmount: 100,
    },
  })
  await prisma.allocation.upsert({
    where: { id: `e2e-print-stress-allocation-${i}` },
    update: {},
    create: {
      id: `e2e-print-stress-allocation-${i}`,
      productId: product.id,
      clientId: client.id,
      staffId: staff.id,
      contractId: stressContract.id,
      checkoutDate: new Date('2027-02-27'),
      dueDate: new Date('2027-03-02'),
      status: 'reserved',
      priceCharged: 200 + i,
    },
  })
}

for (let i = 1; i <= 8; i += 1) {
  await prisma.installment.upsert({
    where: { id: `e2e-print-stress-installment-${i}` },
    update: {},
    create: {
      id: `e2e-print-stress-installment-${i}`,
      contractId: stressContract.id,
      dueDate: new Date(2027, 1, 20 + i),
      amount: 150,
      paid: false,
    },
  })
}

console.log('Seeded e2e-print-short-contract (1 item, 3 installments) and e2e-print-stress-contract (15 items, 8 installments).')
await prisma.$disconnect()
```

- [ ] **Step 2: Run it and verify output**

Run (from `server/`, with the dev server's `.env` / `dev.db` already seeded via `npx tsx seed-e2e.ts`):

```bash
npx tsx seed-e2e-contract-print.ts
```

Expected: prints `Seeded e2e-print-short-contract (1 item, 3 installments) and e2e-print-stress-contract (15 items, 8 installments).` with no errors. Re-running it is safe (every write is an `upsert`).

- [ ] **Step 3: Document the script**

Add a short entry to `server/README.md` right after the existing `seed-e2e.ts` docs (around line 111), following the same style:

```markdown
​```bash
npx tsx seed-e2e-contract-print.ts
​```

Seeds two fixed-ID contracts on top of `seed-e2e.ts`'s Location/Staff, used by
`client/e2e/contract-print.spec.ts`: `e2e-print-short-contract` (one item, no
installments — the original reported print bug) and
`e2e-print-stress-contract` (15 items, 8 installments — a print worst case).
Requires `seed-e2e.ts` to have been run first.
```

- [ ] **Step 4: Commit**

```bash
git add server/seed-e2e-contract-print.ts server/README.md
git commit -m "test: seed fixed-ID contracts for print A4 e2e coverage"
```

---

### Task 2: Reproduce the bug with a Playwright print test

**Files:**
- Create: `client/e2e/contract-print.spec.ts`

**Interfaces:**
- Consumes: `e2e-print-short-contract` / `e2e-print-stress-contract` seeded by Task 1, at routes `/contratos/e2e-print-short-contract/imprimir` and `/contratos/e2e-print-stress-contract/imprimir` (`client/src/app/router.tsx:28`).
- Produces: nothing consumed by later tasks — this is the standalone verification test that Task 3 must make pass.

- [ ] **Step 1: Write the test**

```ts
// client/e2e/contract-print.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Precondition: server/ is running against a database seeded, in order, via:
//   npx tsx seed-e2e.ts
//   npx tsx seed-e2e-contract-print.ts
// See server/README.md.

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Painel — hoje')).toBeVisible()
}

function pdfPageCount(path: string): number {
  const output = execSync(`pdfinfo "${path}"`).toString()
  const match = output.match(/^Pages:\s+(\d+)/m)
  if (!match) {
    throw new Error(`Could not parse page count from pdfinfo output:\n${output}`)
  }
  return Number(match[1])
}

test('short contract (one rental item) prints on exactly one A4 page', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/contratos/e2e-print-short-contract/imprimir')
  await expect(page.getByText(/Contrato Nº 9001/)).toBeVisible()

  await page.emulateMedia({ media: 'print' })
  const pdfPath = join(mkdtempSync(join(tmpdir(), 'contract-print-')), 'short.pdf')
  // Explicit format + margin, matching the `@page { size: A4; margin: 12mm; }`
  // rule Task 3 adds to index.css. Playwright's page.pdf() defaults to 0mm
  // margins when none are given, which is far more forgiving than any real
  // print dialog (or our own @page rule) — that gap is exactly why the
  // client's real-world bug doesn't reproduce without setting this explicitly.
  await page.pdf({ path: pdfPath, format: 'A4', margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } })
  await testInfo.attach('short-contract.pdf', { path: pdfPath, contentType: 'application/pdf' })

  expect(pdfPageCount(pdfPath)).toBe(1)
})

test('stress contract (15 items, 8 installments) print page count is captured for review', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/contratos/e2e-print-stress-contract/imprimir')
  await expect(page.getByText(/Contrato Nº 9002/)).toBeVisible()

  await page.emulateMedia({ media: 'print' })
  const pdfPath = join(mkdtempSync(join(tmpdir(), 'contract-print-')), 'stress.pdf')
  await page.pdf({ path: pdfPath, format: 'A4', margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } })
  await testInfo.attach('stress-contract.pdf', { path: pdfPath, contentType: 'application/pdf' })

  const pageCount = pdfPageCount(pdfPath)
  console.log(`Stress contract printed on ${pageCount} page(s).`)
  // docs/superpowers/specs/2026-07-24-contract-print-a4-design.md accepts a
  // long contract spilling to a 2nd page — this only guards a gross regression.
  expect(pageCount).toBeLessThanOrEqual(2)
})
```

- [ ] **Step 2: Run it against the current (unfixed) code and confirm the first test fails**

With `server/` running (`npm run dev`) against a db seeded via both scripts from Task 1, run from `client/`:

```bash
npm run test:e2e -- contract-print.spec.ts
```

Expected: **`short contract ... prints on exactly one A4 page` FAILS** — `pdfinfo` reports 2 pages (`expect(pdfPageCount(pdfPath)).toBe(1)` fails with `Expected: 1, Received: 2`), reproducing the client-reported bug. The stress-contract test may pass or fail depending on current spacing; either is fine at this point — Task 3 is what needs to fix the short-contract case.

- [ ] **Step 3: Commit**

```bash
git add client/e2e/contract-print.spec.ts
git commit -m "test: reproduce contract print A4 overflow with a Playwright test"
```

---

### Task 3: Fix the print layout to fit one A4 page

**Files:**
- Modify: `client/src/features/contracts/ContractPrintView.tsx:19,20,60,93,118,121,131`
- Modify: `client/src/index.css` (append `@page` rule)
- Modify: `client/src/features/contracts/ContractPrintView.test.tsx` (add a unit test for break-avoidance)

**Interfaces:**
- Consumes: nothing new — same `ContractDetail` props `ContractPrintView` already takes.
- Produces: nothing consumed by later tasks — this is the last task in this plan.

- [ ] **Step 1: Write the failing unit test**

Add to `client/src/features/contracts/ContractPrintView.test.tsx`, inside the existing `describe('ContractPrintView', ...)` block:

```tsx
  it('marks item rows and the signature block to avoid splitting across a print page break', () => {
    const { container } = render(<ContractPrintView contract={baseContract} />)

    const row = container.querySelector('tbody tr')
    expect(row?.className).toContain('print:break-inside-avoid')

    const signatureBlock = screen.getByText('Assinatura do Cliente').closest('section')
    expect(signatureBlock?.className).toContain('print:break-inside-avoid')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/features/contracts/ContractPrintView.test.tsx`
Expected: FAIL — `row?.className` doesn't contain `'print:break-inside-avoid'` (class not added yet).

- [ ] **Step 3: Apply the print CSS changes**

In `client/src/features/contracts/ContractPrintView.tsx`:

```tsx
    <article className="flex flex-col gap-6 print:gap-3 text-sm print:text-xs text-ink">
      <header className="flex flex-col gap-1 border-b border-border-soft pb-4 print:pb-2">
```

```tsx
              <tr key={allocation.id} className="border-b border-border-soft print:break-inside-avoid">
```

```tsx
                    <tr key={installment.id} className="border-b border-border-soft print:break-inside-avoid">
```

```tsx
      <section className="mt-8 print:mt-4 flex flex-col items-center gap-2 print:break-inside-avoid">
        {contract.signatureImage ? (
          <>
            <img src={contract.signatureImage} alt={t('print.signatureLabel')} className="h-24 print:h-16" />
            <p>{t('print.signatureLabel')}</p>
            {contract.signedAt && (
              <p className="text-xs text-muted-text">
                {t('print.signedAt', { date: formatDate(new Date(contract.signedAt), locale, DATE_FORMAT_OPTIONS) })}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="h-24 w-64 print:h-16 border-b border-ink" />
            <p>{t('print.signatureLabel')}</p>
          </>
        )}
      </section>
```

In `client/src/index.css`, append:

```css
@page {
  size: A4;
  margin: 12mm;
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd client && npx vitest run src/features/contracts/ContractPrintView.test.tsx`
Expected: PASS, including the new test and both pre-existing tests in the file.

- [ ] **Step 5: Run the full client unit suite**

Run: `cd client && npm test`
Expected: PASS — `ContractPrintPage.test.tsx` and everything else unaffected (no content/structure changes, only className additions).

- [ ] **Step 6: Re-run the Task 2 e2e test to verify it now passes**

With `server/` still running against the seeded db, from `client/`:

```bash
npm run test:e2e -- contract-print.spec.ts
```

Expected: **both tests PASS** — the short contract now reports exactly 1 page from `pdfinfo`, and the stress contract reports at most 2. If the short-contract case still reports 2 pages, tighten the print spacing further (e.g. reduce `gap-6`/`print:gap-3` further, or shrink `print:text-xs` line-height) and re-run until it's 1 page — do not weaken the assertion.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/contracts/ContractPrintView.tsx client/src/index.css client/src/features/contracts/ContractPrintView.test.tsx
git commit -m "fix: fit printed contract on one A4 page"
```
