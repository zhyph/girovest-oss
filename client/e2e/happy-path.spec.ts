import { test, expect, type Page } from '@playwright/test'
import { skipOnboardingTour } from './skipOnboardingTour.ts'

// Precondition: server/ is running against a database that already has a
// Location and a Staff row (login: e2e-staff, password: e2e-password12).
// See server/README.md for how to seed one.

// For confirmation dialogs that only sometimes appear (depending on data
// state) — waits briefly rather than sampling once, since the dialog can
// take a moment to mount after the action that triggers it.
async function clickIfAppears(page: Page, name: string) {
  const button = page.getByRole('button', { name })
  try {
    await button.waitFor({ state: 'visible', timeout: 3000 })
    await button.click()
  } catch {
    // Didn't appear — nothing to confirm.
  }
}

test('register client and product, allocate, check out, return', async ({ page }) => {
  await skipOnboardingTour(page)
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByText('Painel — hoje')).toBeVisible()

  // Suffixed so reruns against a database that isn't reset between test runs
  // (this repo doesn't reset dev.db per e2e run — see server/README.md) never
  // collide with a previous run's same-named client/product, which would
  // otherwise make every getByText/selectOption below ambiguous.
  const runId = Date.now().toString(36)
  const clientName = `Cliente E2E ${runId}`
  const productName = `Vestido E2E ${runId}`

  await page.getByRole('link', { name: 'Clientes' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  {
    // Scoped to the drawer's <form>: ClientsPage's own search input
    // ("Buscar por nome, telefone ou e-mail...") substring-matches "Nome"
    // under Playwright's default non-exact getByLabel, causing a strict-mode
    // violation against the unscoped locator.
    const form = page.locator('form')
    await form.getByLabel('Nome').fill(clientName)
    await form.getByLabel('Telefone').fill('11999999999')
    await form.getByLabel('E-mail').fill('e2e@example.com')
  }
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText(clientName)).toBeVisible()

  await page.getByRole('link', { name: 'Produtos' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  {
    // Same substring-match hazard as above: ProductsPage's own search input
    // ("Buscar por nome, categoria ou cor...") matches "Nome"/"Categoria"/"Cor".
    const form = page.locator('form')
    await form.getByLabel('Nome').fill(productName)
    await form.getByLabel('Categoria').fill('festa')
    await form.getByLabel('Tamanho').fill('M')
    await form.getByLabel('Cor').fill('verde')
    // rentalPrice defaults to 0, which fails the schema's .positive() check
    // and silently blocks submission (no request, no visible toast).
    await form.getByLabel('Preço do aluguel').fill('100')
    await form.getByLabel('Caução').fill('50')
  }
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText(productName)).toBeVisible()

  // Allocations are created as part of a Contract now — there is no separate
  // "Alocações" nav item or plain <select> fields (see ContractsPage.tsx /
  // NewContractForm.tsx). Client/Product are custom EntityCombobox widgets:
  // a role="combobox" trigger opens a popover with a role="searchbox" filter
  // input and role="option" results.
  await page.getByRole('link', { name: 'Contratos' }).click()
  await page.getByRole('button', { name: 'Novo Contrato' }).click()

  await page.getByRole('combobox', { name: 'Cliente' }).click()
  await page.getByRole('searchbox', { name: 'Buscar' }).fill(clientName)
  // Anchored to the start: an unanchored match against clientName also
  // matches the always-present "Criar cliente "<query>"" row, since it
  // echoes the same query text — a strict-mode violation with just one
  // real result.
  await page.getByRole('option', { name: new RegExp(`^${clientName}`) }).click()

  // DateInput is a digit-masked DD/MM/AAAA field (see date-input.tsx /
  // locale.ts's isoToDigitsBR): it doesn't accept an ISO string via .fill(),
  // only raw day-month-year digits it formats itself as they're typed.
  await page.getByLabel('Data do Evento').fill('10012027') // 10/01/2027

  await page.getByRole('combobox', { name: 'Produto' }).click()
  await page.getByRole('searchbox', { name: 'Buscar' }).fill(productName)
  await page.getByRole('option', { name: new RegExp(`^${productName}`) }).click()
  await page.getByLabel('Retirada').fill('10012027') // 10/01/2027
  await page.getByLabel('Devolução').fill('15012027') // 15/01/2027

  await page.getByLabel('Forma de Pagamento').selectOption('PIX')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()

  // This run's client only has name/phone/email, missing the identity
  // document/address fields the pt-BR client template requires — that opens
  // a "Salvar contrato mesmo assim?" confirmation on submit (see
  // NewContractForm.tsx's clientReadiness check). Confirm it if present;
  // skip past it harmlessly if this client happens to already be complete.
  // waitFor (not isVisible, which samples once with no wait) since the
  // dialog can take a moment to mount after the click.
  await clickIfAppears(page, 'Salvar mesmo assim')

  // ContractsPage paginates server-side (see useContractsList), and this
  // same, never-reset database already has 20+ other seeded contracts — our
  // new one is not guaranteed to land on page 1. Search by client name (the
  // list supports "Buscar por número ou cliente...") to bring it into view,
  // then scope to its own row for the actions below. The product name's own
  // <span> sits two levels below the allocation row div that also holds its
  // action buttons (see ContractsPage.tsx).
  await page.getByPlaceholder('Buscar por número ou cliente...').fill(clientName)
  const row = page.getByText(productName, { exact: true }).locator('..').locator('..')

  // RowActions renders by allocation.status alone — there is no separate
  // "Reservado"/"Alugado"/"Devolvido" status text in this redesigned page
  // (allocations.json's `status` keys are unused leftovers from the old,
  // pre-contracts Allocations page). Check-out/Devolver each open a
  // confirmation modal rather than acting immediately.
  await expect(row.getByRole('button', { name: 'Check-out' })).toBeVisible()
  await row.getByRole('button', { name: 'Check-out' }).click()
  await page.getByRole('button', { name: 'Confirmar check-out' }).click()
  // The item's checkout date (2027-01-10) is in the future relative to
  // today, so confirming check-out now trips the "early pickup" guard
  // (checkOutDialog.earlyTitle) — a second confirmation, not an error.
  await clickIfAppears(page, 'Retirar mesmo assim')

  await expect(row.getByRole('button', { name: 'Devolver' })).toBeVisible()
  await row.getByRole('button', { name: 'Devolver' }).click()
  await page.getByRole('button', { name: 'Confirmar devolução' }).click()

  // Once returned, RowActions renders nothing for this allocation.
  await expect(row.getByRole('button', { name: 'Devolver' })).not.toBeVisible()
})
