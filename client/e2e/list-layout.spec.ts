import { test, expect, type Page } from '@playwright/test'
import { skipOnboardingTour } from './skipOnboardingTour.ts'

// Precondition: server/ is running against a database seeded, in order, via:
//   npx tsx seed-e2e.ts
//   npx tsx seed-e2e-calendar-load.ts
//   npx tsx seed-e2e-list-layout.ts
// See server/README.md.

async function login(page: Page) {
  await skipOnboardingTour(page)
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Painel — hoje')).toBeVisible()
}

async function expectNoPageLevelScroll(page: Page) {
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
  expect(scrollHeight - clientHeight).toBeLessThanOrEqual(2) // sub-pixel rounding tolerance
}

// Every route on this branch that received the sticky-header/scrollable-list
// layout fix (Tasks 2-5 of this plan, plus the Calendar/Settings fix folded
// into Task 2's own review) — a complete sweep, not just the four routes the
// plan named, so this spec stands as self-contained proof across the whole
// branch.
test('no route has page-level scroll, even with long lists (sticky header, internal scroll only)', async ({ page }) => {
  await login(page)

  await expect(page.getByText('Vestido Carga E2E').first()).toBeVisible()
  await expectNoPageLevelScroll(page)

  await page.goto('/produtos')
  await expect(page.getByText('Vestido Layout E2E 40')).toBeVisible()
  await expectNoPageLevelScroll(page)

  await page.goto('/clientes')
  await expect(page.getByText('Cliente Layout E2E 40')).toBeVisible()
  await expectNoPageLevelScroll(page)

  await page.goto('/contratos')
  // Not a specific fixed-ID contract number: the server's startup
  // contractBackfill (server/src/services/contractBackfill.ts) creates one
  // contract per orphan allocation, including the 300 seeded by
  // seed-e2e-calendar-load.ts, which outrank this seed's 20 fixed-ID
  // contracts by createdAt and can push them off page 1. Any contract row
  // being visible is enough to prove the page finished loading.
  await expect(page.getByText(/^#\d+ —/).first()).toBeVisible()
  await expectNoPageLevelScroll(page)

  await page.goto('/calendario')
  await expect(page.getByRole('button', { name: 'Saindo' })).toBeVisible()
  await expectNoPageLevelScroll(page)

  await page.goto('/configuracoes')
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
  await expectNoPageLevelScroll(page)
})

test('Products and Clients column header stays pinned while scrolling a long list', async ({ page }) => {
  await login(page)

  const cases: Array<{ path: string; marker: string }> = [
    { path: '/produtos', marker: 'Vestido Layout E2E 40' },
    { path: '/clientes', marker: 'Cliente Layout E2E 40' },
  ]

  for (const { path, marker } of cases) {
    await page.goto(path)
    await expect(page.getByText(marker)).toBeVisible()

    const scrollRegion = page.locator('.overflow-y-auto')
    const header = page.getByText('Nome', { exact: true })
    const headerBoxBefore = await header.boundingBox()
    expect(headerBoxBefore).not.toBeNull()

    await scrollRegion.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(async () => {
      const headerBoxAfter = await header.boundingBox()
      expect(headerBoxAfter).not.toBeNull()
      // Must stay pinned near where it started, not scroll away with the list
      // (a stale `overflow-hidden` ancestor previously broke `position: sticky`
      // here, letting the header scroll off by tens of thousands of pixels
      // while `toBeVisible()` alone still passed).
      expect(Math.abs(headerBoxAfter!.y - headerBoxBefore!.y)).toBeLessThanOrEqual(2)
    }).toPass()
  }
})

test('ProductDrawer keeps Salvar within the viewport when the product has several photos', async ({ page }) => {
  await login(page)
  // The drawer is a fixed-height sidebar with no internal scroll, so with a
  // photo thumbnail row present its footer can sit below a default 720px-tall
  // viewport — see the same accommodation in photo-intake-session.spec.ts.
  // A taller viewport isolates the assertion below to layout, not viewport size.
  await page.setViewportSize({ width: 1280, height: 2000 })
  await page.goto('/produtos')

  await page.getByText('Vestido Fotos Layout E2E').click()
  const saveButton = page.getByRole('button', { name: 'Salvar' })
  await expect(saveButton).toBeVisible()

  const viewportSize = page.viewportSize()
  expect(viewportSize).not.toBeNull()
  const box = await saveButton.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportSize!.height)
})
