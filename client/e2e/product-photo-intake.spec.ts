import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Painel — hoje')).toBeVisible()
}

test('save and add another keeps the drawer open and prefills the next product', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Produtos' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()

  // Scoped to the drawer's <form> — ProductsPage's own search input
  // ("Buscar por nome, categoria ou cor...") is a bare <input> outside any
  // <form>, but its aria-label substring-matches "Nome"/"Categoria"/"Cor"
  // under Playwright's default non-exact getByLabel, causing a strict-mode
  // violation against the unscoped locator (pre-existing on master, also
  // reproduces against client/e2e/happy-path.spec.ts's "Clientes" flow —
  // unrelated to this plan's work, not fixed here since it's out of scope).
  const form = page.locator('form')
  await form.getByLabel('Nome').fill('Vestido Intake E2E 1')
  await form.getByLabel('Categoria').fill('festa')
  await form.getByLabel('Tamanho').fill('M')
  await form.getByLabel('Cor').fill('azul')
  await page.getByRole('button', { name: 'Salvar e adicionar outro' }).click()

  await expect(form.getByLabel('Nome')).toHaveValue('')
  await expect(form.getByLabel('Categoria')).toHaveValue('festa')
  await expect(form.getByLabel('Cor')).toHaveValue('azul')

  await form.getByLabel('Nome').fill('Vestido Intake E2E 2')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByText('Vestido Intake E2E 2')).toBeVisible()
})

// The former "remote photo intake: scanning the QR..." test that lived here
// exercised the per-product POST /api/products/:id/photo-token route and the
// AddPhotosRemotelyModal component — both removed by the session-based photo
// intake redesign (see docs/superpowers/plans/2026-07-24-photo-intake-session-redesign.md).
// Its scenario is now covered, more thoroughly, by
// client/e2e/photo-intake-session.spec.ts.
