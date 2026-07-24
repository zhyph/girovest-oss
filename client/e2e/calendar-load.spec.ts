import { test, expect, type Page } from '@playwright/test'

// Precondition: server/ is running against a database seeded, in order, via:
//   npx tsx seed-e2e.ts
//   npx tsx seed-e2e-calendar-load.ts
// See server/README.md.

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Painel — hoje')).toBeVisible()
}

test('calendar page stays within the viewport with 300 same-day items (no page-level scroll)', async ({ page }) => {
  await login(page)
  await page.goto('/calendario')
  await expect(page.getByRole('button', { name: 'Saindo' })).toBeVisible()

  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
  expect(scrollHeight - clientHeight).toBeLessThanOrEqual(2) // sub-pixel rounding tolerance
})

test('Agenda view paginates a 300-item day-group', async ({ page }) => {
  await login(page)
  await page.goto('/calendario')
  await expect(page.getByText(/1 \/ \d+/)).toBeVisible()

  const firstPageCount = await page.getByText('Vestido Carga E2E').count()
  expect(firstPageCount).toBeLessThanOrEqual(20)

  await page.getByRole('button', { name: 'Próximo' }).first().click()
  await expect(page.getByText(/2 \/ \d+/)).toBeVisible()
})

test('Month view "+N more" opens the populated day-items panel, not Agenda', async ({ page }) => {
  await login(page)
  await page.goto('/calendario')
  await page.getByRole('button', { name: 'Ver mês' }).click()

  const showMoreLink = page.locator('.rbc-show-more').first()
  await expect(showMoreLink).toBeVisible()
  await showMoreLink.click()

  // Must NOT have bounced to Agenda: the month grid must still be mounted underneath the dialog.
  await expect(page.locator('.rbc-month-view')).toBeVisible()
  // Dialog itself must reflect the clicked day, not some agenda fallback.
  await expect(page.getByRole('dialog').getByText(/^\d{2}\/\d{2}\/\d{4}$/)).toBeVisible()
  await expect(page.getByText('Vestido Carga E2E').first()).toBeVisible()
})

test('clicking a calendar row opens the read-only product detail modal', async ({ page }) => {
  await login(page)
  await page.goto('/calendario')
  await page.getByText('Vestido Carga E2E').first().click()

  await expect(page.getByText('festa')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar' })).not.toBeVisible()
})
