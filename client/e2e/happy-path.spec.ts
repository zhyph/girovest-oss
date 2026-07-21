import { test, expect } from '@playwright/test'

// Precondition: server/ is running against a database that already has a
// Location and a Staff row (login: e2e-staff, password: e2e-password12).
// See server/README.md for how to seed one.

test('register client and product, allocate, check out, return', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByText('Painel — hoje')).toBeVisible()

  await page.getByRole('link', { name: 'Clientes' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  await page.getByLabel('Nome').fill('Cliente E2E')
  await page.getByLabel('Telefone').fill('11999999999')
  await page.getByLabel('E-mail').fill('e2e@example.com')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Cliente E2E')).toBeVisible()

  await page.getByRole('link', { name: 'Produtos' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  await page.getByLabel('Nome').fill('Vestido E2E')
  await page.getByLabel('Categoria').fill('festa')
  await page.getByLabel('Tamanho').fill('M')
  await page.getByLabel('Cor').fill('verde')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Vestido E2E')).toBeVisible()

  await page.getByRole('link', { name: 'Alocações' }).click()
  await page.getByRole('button', { name: 'Nova alocação' }).click()
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente E2E' })
  await page.getByLabel('Data de saída').fill('2027-01-10')
  await page.getByLabel('Data de devolução').fill('2027-01-15')
  await page.getByLabel('Produto').selectOption({ label: 'Vestido E2E' })
  await page.getByLabel('Valor cobrado').fill('200')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Reservado')).toBeVisible()

  await page.getByRole('button', { name: 'Check-out' }).click();
  await expect(page.getByText('Alugado')).toBeVisible()

  await page.getByRole('button', { name: 'Devolver' }).click();
  await expect(page.getByText('Devolvido')).toBeVisible()
})
