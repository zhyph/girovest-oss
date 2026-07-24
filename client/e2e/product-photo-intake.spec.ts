import { test, expect } from '@playwright/test'

// Precondition: server/ is running against a database seeded via
// `npx tsx seed-e2e.ts` (see server/README.md), started with HOST=127.0.0.1
// (the default for `npm run dev`) so the LAN-bound signingApp — which serves
// /product-photos/:token — actually starts. See server/README.md's "HOST
// binding and remote signing" section.

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

test('remote photo intake: scanning the QR and submitting a photo updates the drawer', async ({ page, context }) => {
  await login(page)
  await page.getByRole('link', { name: 'Produtos' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  const form = page.locator('form')
  await form.getByLabel('Nome').fill('Vestido Foto E2E')
  await form.getByLabel('Categoria').fill('festa')
  await form.getByLabel('Tamanho').fill('M')
  await form.getByLabel('Cor').fill('azul')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Vestido Foto E2E').click()

  await page.getByRole('button', { name: 'Adicionar fotos remotamente' }).click()
  const qrImg = page.getByRole('img', { name: /fotos/i })
  await expect(qrImg).toBeVisible()

  // Extract the real LAN URL by issuing a token through the same authenticated
  // API the modal itself just called, rather than decoding the QR image pixel
  // data — mirrors how remote contract signing was manually verified. The
  // storage key here must match client/src/lib/auth.ts's TOKEN_KEY exactly
  // ('dress-store-token'), not a guessed generic 'token' key.
  const { productId, phoneUrl, authToken } = await page.evaluate(async () => {
    const authToken = localStorage.getItem('dress-store-token')
    const productsResponse = await fetch('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    const products = await productsResponse.json()
    const product = products.find((p: { name: string }) => p.name === 'Vestido Foto E2E')
    const tokenResponse = await fetch(`http://localhost:3000/api/products/${product.id}/photo-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    const body = await tokenResponse.json()
    // Build the URL exactly as AddPhotosRemotelyModal.tsx's buildPhotoUrl does:
    // the real detected LAN candidate address, not "localhost" — the LAN-bound
    // signingApp (which serves /product-photos/:token) never binds to the main
    // app's own loopback/host address, only to the other detected interfaces.
    const candidate = body.candidates[0]
    if (!candidate) throw new Error('No LAN candidate reported — is the server running with HOST=127.0.0.1?')
    return {
      productId: product.id as string,
      phoneUrl: `http://${candidate.address}:${body.port}/product-photos/${body.token}`,
      authToken: authToken as string,
    }
  })

  const phonePage = await context.newPage()
  await phonePage.goto(phoneUrl)
  await expect(phonePage.locator('input[type="file"]')).toBeVisible()

  // A tiny valid 1x1 JPEG for the file input.
  await phonePage.setInputFiles('input[type="file"]', {
    name: 'test.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
      'base64',
    ),
  })
  await expect(phonePage.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  await phonePage.getByRole('button', { name: 'Enviar' }).click()
  await expect(phonePage.getByText('Fotos enviadas!')).toBeVisible()

  // Back on the desktop, polling should surface the new photo count. This is
  // tied to the real photo array length rendered by AddPhotosRemotelyModal.tsx
  // (`{t('photoIntake.waiting')} ({product?.photos?.length ?? 0})`), not an
  // ambient/unrelated UI element — it would not read "(1)" if the photo array
  // on the server were still empty (i.e. if the token were never truly
  // consumed or the file never actually written).
  await expect(page.getByText(/\(1\)/)).toBeVisible({ timeout: 10_000 })

  // Strengthen further: independently confirm, via a fresh authenticated fetch
  // (not the polled UI state), that the product's photos array actually grew
  // and that the stored path is a real, fetchable, authenticated image — this
  // would fail against a broken implementation even if some unrelated counter
  // happened to read "(1)" by coincidence.
  const verification = await page.evaluate(
    async ({ productId, authToken }) => {
      const response = await fetch(`http://localhost:3000/api/products/${productId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const product = await response.json()
      const photoPath = product.photos[0] as string | undefined
      if (!photoPath) return { photoCount: product.photos.length, photoOk: false, contentType: null }
      const photoResponse = await fetch(`http://localhost:3000${photoPath}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      return {
        photoCount: product.photos.length,
        photoOk: photoResponse.ok,
        contentType: photoResponse.headers.get('content-type'),
      }
    },
    { productId, authToken },
  )
  expect(verification.photoCount).toBe(1)
  expect(verification.photoOk).toBe(true)
  expect(verification.contentType).toBe('image/jpeg')
})
