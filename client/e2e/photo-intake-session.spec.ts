import { test, expect } from '@playwright/test'
import { skipOnboardingTour } from './skipOnboardingTour.ts'

// The product drawer is a fixed-height sidebar with no internal scroll, so
// with a photo thumbnail row present its Cancelar/Salvar buttons can sit
// below a default 720px-tall viewport. A taller viewport avoids that — it's
// an environment accommodation, not a weakening of any assertion below.
test.use({ viewport: { width: 1280, height: 2000 } })

// Precondition: server/ is running against a database seeded via
// `npx tsx seed-e2e.ts` (see server/README.md), started with HOST=127.0.0.1
// (the default for `npm run dev`) so the LAN-bound signingApp — which serves
// /product-photos/:token — actually starts. See server/README.md's "HOST
// binding and remote signing" section.

// A tiny valid 1x1 JPEG, reused for both product's uploads — the assertions
// below distinguish "which product got which photo" by the server-generated,
// product-scoped storage path (/api/products/<id>/photos/<uuid>.jpg), not by
// pixel content, so identical source bytes don't weaken the test.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='

async function login(page: import('@playwright/test').Page) {
  await skipOnboardingTour(page)
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Painel — hoje')).toBeVisible()
}

async function createProduct(page: import('@playwright/test').Page, name: string, category: string, size: string, color: string) {
  await page.getByRole('button', { name: 'Novo' }).click()
  const form = page.locator('form')
  await form.getByLabel('Nome').fill(name)
  await form.getByLabel('Categoria').fill(category)
  await form.getByLabel('Tamanho').fill(size)
  await form.getByLabel('Cor').fill(color)
  // rentalPrice defaults to 0, which fails the schema's .positive() check and
  // silently blocks submission (no request, no visible toast) if left unset.
  await form.getByLabel('Preço do aluguel').fill('100')
  await form.getByLabel('Caução').fill('50')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByText(name)).toBeVisible()
}

async function sendPhotoForProduct(
  phonePage: import('@playwright/test').Page,
  searchTerm: string,
  productName: string,
  photoName: string,
) {
  await phonePage.locator('#search-input').fill(searchTerm)
  await phonePage.getByRole('button', { name: new RegExp(productName) }).click()
  await expect(phonePage.locator('#capture-title')).toHaveText(productName)

  // The visible "Tirar Foto" button just forwards to this hidden native file
  // input (capture="environment"); setting files on it directly is the
  // standard way to drive a hidden camera-capture input under automation.
  await phonePage.locator('#camera-input').setInputFiles({
    name: photoName,
    mimeType: 'image/jpeg',
    buffer: Buffer.from(TINY_JPEG_BASE64, 'base64'),
  })
  await expect(phonePage.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  await phonePage.getByRole('button', { name: 'Enviar' }).click()

  // Tied to the real submit response: productPhotoPage.ts's submit handler
  // only ever writes this text after a 2xx from POST /product-photos/:token/submit
  // (see submit button's fetch handler) — a rejected/expired token or a
  // server error instead renders 'Erro ao enviar. Tente novamente.', so this
  // would fail if the token had been silently invalidated after a prior use.
  await expect(phonePage.getByText(/fotos adicionadas/)).toBeVisible()

  // The page auto-returns to the picker screen 2s after a successful submit
  // (see openPickerScreen in productPhotoPage.ts) — still on the exact same
  // token/page, without any navigation or re-issued token.
  await expect(phonePage.locator('#picker-screen')).toBeVisible({ timeout: 5_000 })
}

test('one session token serves two products end to end without rescanning', async ({ page, context }) => {
  await login(page)
  await page.getByRole('link', { name: 'Produtos' }).click()

  // Suffixed so reruns against a database that isn't reset between test runs
  // (this repo doesn't reset dev.db per e2e run) never collide with a
  // previous run's same-named products — collisions would break both the
  // exact-name UI assertions and the phone page's name search below.
  const runId = Date.now().toString(36)
  const productAName = `Vestido Sessao A E2E ${runId}`
  const productBName = `Vestido Sessao B E2E ${runId}`
  await createProduct(page, productAName, 'festa', 'M', 'azul')
  await createProduct(page, productBName, 'casual', 'P', 'verde')

  // Look up both products' real IDs and issue exactly ONE session token
  // through the real authenticated API — mirroring what AddPhotosSessionModal
  // itself calls (POST /api/products/photo-session) — never re-issued below.
  const { productAId, productBId, phoneUrl, authToken } = await page.evaluate(
    async ({ productAName, productBName }) => {
      const authToken = localStorage.getItem('dress-store-token')
      const headers = { Authorization: `Bearer ${authToken}` }
      const productsResponse = await fetch('http://localhost:3000/api/products', { headers })
      const products = await productsResponse.json()
      const productA = products.find((p: { name: string }) => p.name === productAName)
      const productB = products.find((p: { name: string }) => p.name === productBName)
      if (!productA || !productB) throw new Error('Seeded products not found via API')

      const tokenResponse = await fetch('http://localhost:3000/api/products/photo-session', {
        method: 'POST',
        headers,
      })
      const body = await tokenResponse.json()
      const candidate = body.candidates[0]
      if (!candidate) throw new Error('No LAN candidate reported — is the server running with HOST=127.0.0.1?')
      return {
        productAId: productA.id as string,
        productBId: productB.id as string,
        phoneUrl: `http://${candidate.address}:${body.port}/product-photos/${body.token}`,
        authToken: authToken as string,
      }
    },
    { productAName, productBName },
  )

  const phonePage = await context.newPage()
  await phonePage.goto(phoneUrl)
  await expect(phonePage.locator('#picker-screen')).toBeVisible()

  // Product A: search for it, tap it, capture + send a photo — no rescan yet needed.
  await sendPhotoForProduct(phonePage, productAName, productAName, 'photo-a.jpg')

  // Product B: still the exact same phonePage/token — no re-issuing, no re-navigating.
  await sendPhotoForProduct(phonePage, productBName, productBName, 'photo-b.jpg')

  // Independent, authenticated verification (not the polled/rendered UI state)
  // that each product ended up with exactly its own photo — this is the
  // assertion that would catch the redesign's feared failure modes: a token
  // silently invalidated after the first submit (photosB would be empty), or
  // the second product's photo actually landing on the first product by
  // mistake (photosA would have 2 entries, or the two paths would collide).
  const verification = await page.evaluate(
    async ({ productAId, productBId, authToken }) => {
      const headers = { Authorization: `Bearer ${authToken}` }
      const [productA, productB] = await Promise.all([
        fetch(`http://localhost:3000/api/products/${productAId}`, { headers }).then((r) => r.json()),
        fetch(`http://localhost:3000/api/products/${productBId}`, { headers }).then((r) => r.json()),
      ])
      return {
        photosA: productA.photos as string[],
        photosB: productB.photos as string[],
      }
    },
    { productAId, productBId, authToken },
  )
  expect(verification.photosA).toHaveLength(1)
  expect(verification.photosB).toHaveLength(1)
  expect(verification.photosA[0]).toMatch(new RegExp(`^/api/products/${productAId}/photos/`))
  expect(verification.photosB[0]).toMatch(new RegExp(`^/api/products/${productBId}/photos/`))
  expect(verification.photosA[0]).not.toBe(verification.photosB[0])

  // Switch back to the desktop tab, reload the products list, and confirm
  // each product's own drawer shows its own uploaded photo as a visible
  // thumbnail whose displayed path is scoped to that specific product's id
  // — not just "a modal opened" or "some photo count is nonzero somewhere".
  await page.reload()
  await page.getByText(productAName).click()
  const photoAPattern = new RegExp(`/api/products/${productAId}/photos/[0-9a-f-]+\\.jpg`)
  await expect(page.getByText(photoAPattern)).toBeVisible()
  await expect(page.locator('li', { hasText: photoAPattern })).toHaveCount(1)
  await expect(page.locator('li', { hasText: photoAPattern }).locator('img')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByText(productBName).click()
  const photoBPattern = new RegExp(`/api/products/${productBId}/photos/[0-9a-f-]+\\.jpg`)
  await expect(page.getByText(photoBPattern)).toBeVisible()
  await expect(page.locator('li', { hasText: photoBPattern })).toHaveCount(1)
  await expect(page.locator('li', { hasText: photoBPattern }).locator('img')).toBeVisible()
  // Product B's drawer must not also show product A's photo — proves the
  // two uploads stayed attached to their own products rather than merging.
  await expect(page.getByText(photoAPattern)).not.toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
})
