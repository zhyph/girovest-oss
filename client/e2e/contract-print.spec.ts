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
