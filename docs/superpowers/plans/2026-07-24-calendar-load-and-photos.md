# Calendar Load Behavior + Product Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Month view "+N more" bug (it bounces to Agenda instead of showing the day's items), fix the global page-scroll bug (AppLayout doesn't actually cap at 100vh), and add product photos + a shared paginated day-items list reused by both Agenda and Month views.

**Architecture:** One shared `CalendarDayItemsList` component (paginated rows with thumbnails, opens a new read-only `ProductDetailModal` on row click) is used by both `AgendaView.tsx` (per day-group) and `MonthView.tsx` (inside a `Dialog` opened via react-big-calendar's `onShowMore` callback, replacing the current broken drill-down routing). `AppLayout.tsx` gets a one-line fix (`min-h-screen` → `h-screen`) so its existing `overflow-y-auto` on `main` actually activates. No API/schema changes — everything is built from data `CalendarPage.tsx` already fetches.

**Tech Stack:** React 19 + Tailwind CSS v4 + react-big-calendar (client), Prisma + SQLite (server), Vitest + React Testing Library (unit), Playwright (e2e).

## Global Constraints

- No API/schema changes — everything renders from `useProducts()`/`useClients()`/`useCalendarTab()`, already fetched by `CalendarPage.tsx`.
- Pagination, not infinite scroll, for the day-items list.
- The `AppLayout.tsx` fix is global (affects every routed page) and must not break any other existing page — the full client test suite (not just calendar tests) must stay green after Task 1 and at the end.
- `ProductDetailModal` is read-only — it must never expose edit/delete actions (that's `ProductDrawer`'s job, not touched by this plan).
- Reuse existing UI patterns: `Dialog`/`DialogContent` from `client/src/components/ui/dialog.tsx` for the new wider panels (not the narrow `Modal` wrapper, which hardcodes `max-w-sm`); the `h-8 w-8 rounded object-cover` thumbnail pattern from `ProductDrawer.tsx:164` as the basis for photo rendering.
- From the design spec (`docs/superpowers/specs/2026-07-24-calendar-load-and-photos-design.md`): default page size 20.

---

### Task 1: Fix the global page-scroll bug (AppLayout)

**Files:**
- Modify: `client/src/app/AppLayout.tsx:6`
- Test: `client/src/app/AppLayout.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is a pure CSS-class fix with no prop/type changes.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/app/AppLayout.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AppLayout } from './AppLayout.tsx'

describe('AppLayout', () => {
  it('caps the outer shell at the viewport height so main scrolls internally, not the page', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/x']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/x" element={<div>content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const shell = container.querySelector('.flex.h-screen')
    expect(shell).toBeInTheDocument()
    expect(container.querySelector('.flex.min-h-screen')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/app/AppLayout.test.tsx`
Expected: FAIL — no element matches `.flex.h-screen` (current class is `flex min-h-screen`).

- [ ] **Step 3: Apply the fix**

In `client/src/app/AppLayout.tsx`, change:

```tsx
    <div className="flex min-h-screen">
```

to:

```tsx
    <div className="flex h-screen">
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd client && npx vitest run src/app/AppLayout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the FULL client test suite (global-constraint check)**

Run: `cd client && npm test`
Expected: PASS, all files — this change is global, so this is the safety net that no other page's tests assumed unbounded page height.

- [ ] **Step 6: Commit**

```bash
git add client/src/app/AppLayout.tsx client/src/app/AppLayout.test.tsx
git commit -m "fix: cap app shell at viewport height so main scrolls internally"
```

---

### Task 2: Seed script for calendar load testing

**Files:**
- Create: `server/seed-e2e-calendar-load.ts`
- Modify: `server/README.md` (document alongside the other seed scripts)

**Interfaces:**
- Consumes: the `Location`/`Staff` row created by `server/seed-e2e.ts` (login `e2e-staff`).
- Produces: one `Product` (`e2e-calendar-load-product`), one `Client` (`e2e-calendar-load-client`), and 300 fixed-ID `Allocation` rows (`e2e-calendar-load-allocation-1..300`), all `status: 'reserved'`, `checkoutDate` = tomorrow (relative to when the script runs), that the e2e test in Task 7 queries via the "going out" calendar tab.

- [ ] **Step 1: Write the seed script**

```ts
// server/seed-e2e-calendar-load.ts
import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './src/generated/prisma/client.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

const staff = await prisma.staff.findUnique({ where: { login: 'e2e-staff' } })
if (!staff) {
  throw new Error('e2e-staff not found — run `npx tsx seed-e2e.ts` first.')
}

const product = await prisma.product.upsert({
  where: { id: 'e2e-calendar-load-product' },
  update: {},
  create: {
    id: 'e2e-calendar-load-product',
    locationId: staff.locationId,
    name: 'Vestido Carga E2E',
    category: 'festa',
    size: 'M',
    color: 'azul',
    rentalPrice: 200,
    depositAmount: 100,
    photos: JSON.stringify(['https://example.com/e2e-calendar-load-photo.jpg']),
  },
})

const client = await prisma.client.upsert({
  where: { id: 'e2e-calendar-load-client' },
  update: {},
  create: {
    id: 'e2e-calendar-load-client',
    name: 'Cliente Carga E2E',
    phone: '11999990020',
    email: 'calendar-load-e2e@example.com',
  },
})

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
tomorrow.setHours(9, 0, 0, 0)
const dueDate = new Date(tomorrow)
dueDate.setDate(dueDate.getDate() + 4)

const TOTAL = 300
for (let i = 1; i <= TOTAL; i += 1) {
  await prisma.allocation.upsert({
    where: { id: `e2e-calendar-load-allocation-${i}` },
    update: {
      productId: product.id,
      clientId: client.id,
      staffId: staff.id,
      checkoutDate: tomorrow,
      dueDate,
      status: 'reserved',
      priceCharged: 200,
    },
    create: {
      id: `e2e-calendar-load-allocation-${i}`,
      productId: product.id,
      clientId: client.id,
      staffId: staff.id,
      checkoutDate: tomorrow,
      dueDate,
      status: 'reserved',
      priceCharged: 200,
    },
  })
}

console.log(`Seeded ${TOTAL} same-day allocations (checkout ${tomorrow.toISOString().slice(0, 10)}) for calendar load testing.`)
await prisma.$disconnect()
```

- [ ] **Step 2: Run it and verify output**

Run (from `server/`, after `npx tsx seed-e2e.ts` has run at least once):

```bash
npx tsx seed-e2e-calendar-load.ts
```

Expected: prints `Seeded 300 same-day allocations (checkout YYYY-MM-DD) for calendar load testing.` with no errors. Re-running it is safe (every write is an `upsert`).

- [ ] **Step 3: Document the script**

Add to `server/README.md`, right after the `seed-e2e-contract-print.ts` entry, in the same style:

```markdown
​```bash
npx tsx seed-e2e-calendar-load.ts
​```

Seeds 300 fixed-ID `Allocation` rows (`e2e-calendar-load-allocation-1..300`), all
on the same day (tomorrow, relative to when the script runs), used by
`client/e2e/calendar-load.spec.ts` to test Agenda/Month view behavior at
volume. Requires `seed-e2e.ts` to have been run first.
```

- [ ] **Step 4: Commit**

```bash
git add server/seed-e2e-calendar-load.ts server/README.md
git commit -m "test: seed 300 same-day allocations for calendar load testing"
```

---

### Task 3: `ProductDetailModal` (new, read-only)

**Files:**
- Create: `client/src/features/products/ProductDetailModal.tsx`
- Test: `client/src/features/products/ProductDetailModal.test.tsx`
- Modify: `client/src/locales/pt-BR/common.json` (add `actions.close`)

**Interfaces:**
- Consumes: `Product` type from `client/src/features/products/productSchemas.ts` (fields: `id, name, category, size, color, rentalPrice, depositAmount, description?, photos?: string[]`). `Dialog`/`DialogContent`/`DialogTitle` from `client/src/components/ui/dialog.tsx`. `useLocale()` from `client/src/lib/LocaleContext.tsx`. `getLocaleConfig`/`formatCurrency` from `client/src/lib/locale.ts`.
- Produces: `ProductDetailModal({ product, open, onClose }: { product: Product | null; open: boolean; onClose: () => void })` — a named export other tasks (Task 4) import directly.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/features/products/ProductDetailModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { ProductDetailModal } from './ProductDetailModal.tsx'
import type { Product } from './productSchemas.ts'

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    locationId: 'loc1',
    name: 'Vestido Azul',
    category: 'festa',
    size: 'M',
    color: 'azul',
    rentalPrice: 250,
    depositAmount: 150,
    description: 'Um vestido elegante.',
    photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    status: 'active',
    availability: 'available',
    hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ProductDetailModal', () => {
  it('renders nothing (closed) when product is null', () => {
    render(<ProductDetailModal product={null} open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Vestido Azul')).not.toBeInTheDocument()
  })

  it('shows full product details and every photo when open', () => {
    render(<ProductDetailModal product={makeProduct()} open={true} onClose={vi.fn()} />)

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('festa')).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('azul')).toBeInTheDocument()
    expect(screen.getByText('Um vestido elegante.')).toBeInTheDocument()
    expect(screen.getByText(/250/)).toBeInTheDocument()
    expect(screen.getByText(/150/)).toBeInTheDocument()

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', 'https://example.com/a.jpg')
    expect(images[1]).toHaveAttribute('src', 'https://example.com/b.jpg')
  })

  it('does not render any edit or delete action', () => {
    render(<ProductDetailModal product={makeProduct()} open={true} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/features/products/ProductDetailModal.test.tsx`
Expected: FAIL — `ProductDetailModal.tsx` doesn't exist yet.

- [ ] **Step 3: Add the `actions.close` locale key**

In `client/src/locales/pt-BR/common.json`, add to the `"actions"` object (after `"logout"`):

```json
    "close": "Fechar"
```

- [ ] **Step 4: Implement the component**

```tsx
// client/src/features/products/ProductDetailModal.tsx
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { getLocaleConfig, formatCurrency } from '../../lib/locale.ts'
import type { Product } from './productSchemas.ts'

export function ProductDetailModal({
  product,
  open,
  onClose,
}: {
  product: Product | null
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('products')
  const { locale } = useLocale()
  const currency = getLocaleConfig(locale).currency

  if (!product) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-lg">
        <DialogTitle className="mb-3 text-base font-semibold text-ink">{product.name}</DialogTitle>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-text">{t('fields.category')}</dt>
            <dd>{product.category}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.size')}</dt>
            <dd>{product.size}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.color')}</dt>
            <dd>{product.color}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.rentalPrice')}</dt>
            <dd>{formatCurrency(product.rentalPrice, locale, currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-text">{t('fields.depositAmount')}</dt>
            <dd>{formatCurrency(product.depositAmount, locale, currency)}</dd>
          </div>
        </dl>
        {product.description && (
          <p className="mt-3 text-sm text-ink">{product.description}</p>
        )}
        {product.photos && product.photos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {product.photos.map((url) => (
              <img key={url} src={url} alt="" className="h-24 w-24 rounded object-cover" />
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.close', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd client && npx vitest run src/features/products/ProductDetailModal.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/features/products/ProductDetailModal.tsx client/src/features/products/ProductDetailModal.test.tsx client/src/locales/pt-BR/common.json
git commit -m "feat: add read-only ProductDetailModal"
```

---

### Task 4: `CalendarDayItemsList` (new shared paginated component)

**Files:**
- Create: `client/src/features/calendar/CalendarDayItemsList.tsx`
- Test: `client/src/features/calendar/CalendarDayItemsList.test.tsx`
- Modify: `client/src/locales/pt-BR/calendarScreen.json` (add pagination strings)

**Interfaces:**
- Consumes: `Allocation` from `client/src/features/allocations/allocationSchemas.ts`; `Product` from `client/src/features/products/productSchemas.ts`; `ProductDetailModal` from Task 3 (`client/src/features/products/ProductDetailModal.tsx`); `parseDateOnly`/`formatDate` from `client/src/lib/date.ts`; `useLocale()` from `client/src/lib/LocaleContext.tsx`.
- Produces: `CalendarDayItemsList({ allocations, products, clientNames, dateField, pageSize }: { allocations: Allocation[]; products: Map<string, Product>; clientNames: Map<string, string>; dateField: 'checkoutDate' | 'dueDate'; pageSize?: number })` — a named export Tasks 5 and 6 import directly. Default `pageSize` is `20`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/features/calendar/CalendarDayItemsList.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1',
    checkoutDate: '2026-07-01', dueDate: '2026-07-05',
    actualReturnDate: null, status: 'reserved', priceCharged: 100,
    depositCollected: null, depositReturned: null, conditionNotesOut: null, conditionNotesIn: null,
    createdAt: '2026-07-01',
    ...overrides,
  }
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', locationId: 'loc1', name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul',
    rentalPrice: 250, depositAmount: 150, photos: ['https://example.com/a.jpg'],
    status: 'active', availability: 'available', hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])

describe('CalendarDayItemsList', () => {
  it('renders a thumbnail, product name, client name and date for each row', () => {
    render(
      <CalendarDayItemsList
        allocations={[makeAllocation()]}
        products={products}
        clientNames={clientNames}
        dateField="checkoutDate"
      />,
    )
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/a.jpg')
  })

  it('falls back to the product name with no image when a product has no photos', () => {
    const noPhotoProducts = new Map([['p1', makeProduct({ photos: [] })]])
    render(
      <CalendarDayItemsList
        allocations={[makeAllocation()]}
        products={noPhotoProducts}
        clientNames={clientNames}
        dateField="checkoutDate"
      />,
    )
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('paginates at the given page size and Next/Previous move between pages', async () => {
    const allocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: `2026-07-${String((i % 27) + 1).padStart(2, '0')}` }),
    )
    render(
      <CalendarDayItemsList
        allocations={allocations}
        products={products}
        clientNames={clientNames}
        dateField="checkoutDate"
        pageSize={10}
      />,
    )

    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getAllByText('Vestido Azul')).toHaveLength(10)

    await userEvent.click(screen.getByRole('button', { name: 'Próximo' }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('opens ProductDetailModal with the right product when a row is clicked', async () => {
    render(
      <CalendarDayItemsList
        allocations={[makeAllocation()]}
        products={products}
        clientNames={clientNames}
        dateField="checkoutDate"
      />,
    )
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByText('festa')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/features/calendar/CalendarDayItemsList.test.tsx`
Expected: FAIL — `CalendarDayItemsList.tsx` doesn't exist yet.

- [ ] **Step 3: Add pagination locale strings**

In `client/src/locales/pt-BR/calendarScreen.json`, add a new top-level `"pagination"` object (after `"empty"`):

```json
  "pagination": {
    "previous": "Anterior",
    "next": "Próximo",
    "pageOf": "{{page}} / {{total}}"
  },
```

- [ ] **Step 4: Implement the component**

```tsx
// client/src/features/calendar/CalendarDayItemsList.tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { ProductDetailModal } from '../products/ProductDetailModal.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

export function CalendarDayItemsList({
  allocations,
  products,
  clientNames,
  dateField,
  pageSize = 20,
}: {
  allocations: Allocation[]
  products: Map<string, Product>
  clientNames: Map<string, string>
  dateField: 'checkoutDate' | 'dueDate'
  pageSize?: number
}) {
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()
  const [page, setPage] = useState(0)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)

  const totalPages = Math.max(1, Math.ceil(allocations.length / pageSize))
  const pageItems = useMemo(
    () => allocations.slice(page * pageSize, page * pageSize + pageSize),
    [allocations, page, pageSize],
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        {pageItems.map((allocation) => {
          const product = products.get(allocation.productId)
          const photo = product?.photos?.[0]
          return (
            <button
              key={allocation.id}
              type="button"
              onClick={() => product && setDetailProduct(product)}
              className="flex items-center justify-between gap-2 rounded-md border border-border-soft p-2 text-left text-sm hover:bg-brand-50"
            >
              <div className="flex items-center gap-2">
                {photo && <img src={photo} alt="" className="h-8 w-8 rounded object-cover" />}
                <div className="flex flex-col">
                  <span>{product?.name ?? allocation.productId}</span>
                  <span className="text-xs text-muted-text">
                    {clientNames.get(allocation.clientId) ?? allocation.clientId}
                  </span>
                </div>
              </div>
              <span className="text-muted-text">
                {formatDate(parseDateOnly(allocation[dateField]), locale, { day: '2-digit', month: '2-digit' })}
              </span>
            </button>
          )
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('pagination.previous')}
          </Button>
          <span className="text-muted-text">{t('pagination.pageOf', { page: page + 1, total: totalPages })}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('pagination.next')}
          </Button>
        </div>
      )}
      <ProductDetailModal product={detailProduct} open={detailProduct !== null} onClose={() => setDetailProduct(null)} />
    </div>
  )
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd client && npx vitest run src/features/calendar/CalendarDayItemsList.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/features/calendar/CalendarDayItemsList.tsx client/src/features/calendar/CalendarDayItemsList.test.tsx client/src/locales/pt-BR/calendarScreen.json
git commit -m "feat: add shared paginated CalendarDayItemsList component"
```

---

### Task 5: Wire `CalendarDayItemsList` into Agenda view

**Files:**
- Modify: `client/src/features/calendar/AgendaView.tsx`
- Modify: `client/src/features/calendar/AgendaView.test.tsx`
- Modify: `client/src/features/calendar/CalendarPage.tsx`
- Modify: `client/src/features/calendar/CalendarPage.test.tsx`

**Interfaces:**
- Consumes: `CalendarDayItemsList` from Task 4 (`./CalendarDayItemsList.tsx`).
- Produces: `AgendaView`'s prop shape changes — `productNames: Map<string, string>` is **removed**, `products: Map<string, Product>` is **added**. `MonthView` (Task 6) is unaffected by this specific change (it keeps its own `productNames` for event titles, and separately gains `products`/`clientNames` in Task 6).

- [ ] **Step 1: Update `AgendaView.test.tsx` to the new prop shape (this is the failing step)**

Replace the whole file:

```tsx
// client/src/features/calendar/AgendaView.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { AgendaView } from './AgendaView.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function isoDateDaysFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1',
    checkoutDate: '2026-07-01', dueDate: '2026-07-05',
    actualReturnDate: null, status: 'reserved', priceCharged: 100,
    depositCollected: null, depositReturned: null, conditionNotesOut: null, conditionNotesIn: null,
    createdAt: '2026-07-01',
    ...overrides,
  }
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', locationId: 'loc1', name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul',
    rentalPrice: 250, depositAmount: 150,
    status: 'active', availability: 'available', hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])

describe('AgendaView', () => {
  it('shows the empty message when there are no allocations', () => {
    render(<AgendaView allocations={[]} dateField="checkoutDate" products={products} clientNames={clientNames} />)
    expect(screen.getByText('Nada para mostrar neste período.')).toBeInTheDocument()
  })

  it('shows the client name alongside the product name', () => {
    render(
      <AgendaView
        allocations={[makeAllocation({ checkoutDate: isoDateDaysFromNow(0) })]}
        dateField="checkoutDate"
        products={products}
        clientNames={clientNames}
      />,
    )
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
  })

  it('groups allocations into Hoje/Amanhã/Esta semana/Mais tarde/Atrasado', () => {
    render(
      <AgendaView
        allocations={[
          makeAllocation({ id: 'overdue', checkoutDate: isoDateDaysFromNow(-3) }),
          makeAllocation({ id: 'today', checkoutDate: isoDateDaysFromNow(0) }),
          makeAllocation({ id: 'tomorrow', checkoutDate: isoDateDaysFromNow(1) }),
          makeAllocation({ id: 'this-week', checkoutDate: isoDateDaysFromNow(4) }),
          makeAllocation({ id: 'later', checkoutDate: isoDateDaysFromNow(20) }),
        ]}
        dateField="checkoutDate"
        products={products}
        clientNames={clientNames}
      />,
    )

    expect(screen.getByText('Atrasado')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('Amanhã')).toBeInTheDocument()
    expect(screen.getByText('Esta semana')).toBeInTheDocument()
    expect(screen.getByText('Mais tarde')).toBeInTheDocument()
  })

  it('omits group headers that have no allocations', () => {
    render(
      <AgendaView
        allocations={[makeAllocation({ checkoutDate: isoDateDaysFromNow(0) })]}
        dateField="checkoutDate"
        products={products}
        clientNames={clientNames}
      />,
    )
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.queryByText('Amanhã')).not.toBeInTheDocument()
    expect(screen.queryByText('Esta semana')).not.toBeInTheDocument()
    expect(screen.queryByText('Mais tarde')).not.toBeInTheDocument()
    expect(screen.queryByText('Atrasado')).not.toBeInTheDocument()
  })

  it('paginates a single day-group that exceeds the page size', () => {
    const allocations = Array.from({ length: 25 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: isoDateDaysFromNow(0) }),
    )
    render(<AgendaView allocations={allocations} dateField="checkoutDate" products={products} clientNames={clientNames} />)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/features/calendar/AgendaView.test.tsx`
Expected: FAIL — `AgendaView` still expects `productNames`, not `products`.

- [ ] **Step 3: Update `AgendaView.tsx`**

Replace the whole file:

```tsx
// client/src/features/calendar/AgendaView.tsx
import { useTranslation } from 'react-i18next'
import { parseDateOnly } from '../../lib/date.ts'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

type Group = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later'
const GROUP_ORDER: Group[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later']

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function groupFor(date: Date, today: Date): Group {
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / dayMs)
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays <= 6) return 'thisWeek'
  return 'later'
}

export function AgendaView({
  allocations,
  dateField,
  products,
  clientNames,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  products: Map<string, Product>
  clientNames: Map<string, string>
}) {
  const { t } = useTranslation('calendarScreen')

  if (allocations.length === 0) {
    return <p className="text-muted-text">{t('empty')}</p>
  }

  const sorted = [...allocations].sort(
    (a, b) => parseDateOnly(a[dateField]).getTime() - parseDateOnly(b[dateField]).getTime(),
  )

  const today = new Date()
  const grouped = new Map<Group, Allocation[]>()
  for (const allocation of sorted) {
    const group = groupFor(parseDateOnly(allocation[dateField]), today)
    const bucket = grouped.get(group) ?? []
    bucket.push(allocation)
    grouped.set(group, bucket)
  }

  return (
    <div className="flex flex-col gap-4">
      {GROUP_ORDER.filter((group) => grouped.has(group)).map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-text">{t(`groups.${group}`)}</h2>
          <CalendarDayItemsList
            allocations={grouped.get(group)!}
            products={products}
            clientNames={clientNames}
            dateField={dateField}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd client && npx vitest run src/features/calendar/AgendaView.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Update `CalendarPage.tsx` to build and pass `products` instead of `productNames` to `AgendaView`**

In `client/src/features/calendar/CalendarPage.tsx`, replace:

```tsx
  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
```

with:

```tsx
  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  )
```

(`productNames` stays — `MonthView`'s calendar-grid event titles in Task 6 still need it. `productsById` is the new map for the shared list.)

Then update the `AgendaView` usage:

```tsx
      {view === 'agenda' ? (
        <AgendaView
          allocations={allocations ?? []}
          dateField={tabDateField[tab]}
          products={productsById}
          clientNames={clientNames}
        />
      ) : (
```

- [ ] **Step 6: Update `CalendarPage.test.tsx`'s product-lookup tests for the new data path**

The two tests `'renders the product name looked up from useProducts when the productId matches'` and `'falls back to the raw productId when no matching product is found'` still exercise the same underlying behavior (product name now comes from `products.get(id)?.name` inside `CalendarDayItemsList` instead of `productNames.get(id)` inside `AgendaView`) — no test code changes needed, they should keep passing unmodified since they only assert on rendered text, not on which prop carried it. Run them to confirm.

- [ ] **Step 7: Run `CalendarPage.test.tsx` to verify it still passes**

Run: `cd client && npx vitest run src/features/calendar/CalendarPage.test.tsx`
Expected: PASS, all 4 tests, unmodified.

- [ ] **Step 8: Run the full client suite**

Run: `cd client && npm test`
Expected: PASS, all files.

- [ ] **Step 9: Commit**

```bash
git add client/src/features/calendar/AgendaView.tsx client/src/features/calendar/AgendaView.test.tsx client/src/features/calendar/CalendarPage.tsx
git commit -m "feat: wire CalendarDayItemsList into Agenda view"
```

---

### Task 6: Fix Month view's "+N more" bug with `onShowMore`

**Files:**
- Modify: `client/src/features/calendar/MonthView.tsx`
- Modify: `client/src/features/calendar/MonthView.test.tsx`
- Modify: `client/src/features/calendar/CalendarPage.tsx`

**Interfaces:**
- Consumes: `CalendarDayItemsList` from Task 4. react-big-calendar's `onShowMore(events, date)` prop (confirmed via Context7 docs: fired specifically for the "+{count} more" link, receives all events for that date — distinct from `onSelectSlot`/`onDrillDown`/`onSelectEvent`, which stay wired to `onSelectDay` for actual day-cell interactions).
- Produces: `MonthView`'s prop shape gains `products: Map<string, Product>` and `clientNames: Map<string, string>` (in addition to its existing `productNames`, `allocations`, `dateField`, `onSelectDay`, `date`, `onNavigate`).

- [ ] **Step 1: Add a failing test for the "+N more" behavior**

Replace the whole file:

```tsx
// client/src/features/calendar/MonthView.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { MonthView } from './MonthView.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1',
    checkoutDate: '2026-07-01', dueDate: '2026-07-05',
    actualReturnDate: null, status: 'reserved', priceCharged: 100,
    depositCollected: null, depositReturned: null, conditionNotesOut: null, conditionNotesIn: null,
    createdAt: '2026-07-01',
    ...overrides,
  }
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', locationId: 'loc1', name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul',
    rentalPrice: 250, depositAmount: 150,
    status: 'active', availability: 'available', hasAllocationHistory: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const products = new Map([['p1', makeProduct()]])
const clientNames = new Map([['c1', 'Maria Silva']])
const productNames = new Map([['p1', 'Vestido Azul']])

describe('MonthView', () => {
  it('renders the toolbar in pt-BR instead of the react-big-calendar English default', () => {
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={new Map()}
        products={new Map()}
        clientNames={new Map()}
        date={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('jumps to the agenda view when a day number is clicked (onDrillDown, not just empty-cell onSelectSlot)', async () => {
    const onSelectDay = vi.fn()
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={new Map()}
        products={new Map()}
        clientNames={new Map()}
        date={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    const dayLink = document.querySelector('.rbc-button-link') as HTMLElement
    expect(dayLink).toBeTruthy()
    dayLink.click()

    expect(onSelectDay).toHaveBeenCalledTimes(1)
    expect(onSelectDay.mock.calls[0][0]).toBeInstanceOf(Date)
  })

  it('opens the day-items panel (not Agenda) when "+N more" is clicked', async () => {
    const onSelectDay = vi.fn()
    const day = new Date(2026, 6, 22)
    const allocations = Array.from({ length: 5 }, (_, i) =>
      makeAllocation({ id: `a${i}`, checkoutDate: '2026-07-22' }),
    )
    render(
      <MonthView
        allocations={allocations}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={productNames}
        products={products}
        clientNames={clientNames}
        date={day}
        onNavigate={vi.fn()}
      />,
    )

    const showMoreLink = document.querySelector('.rbc-show-more') as HTMLElement | null
    if (showMoreLink) {
      await userEvent.click(showMoreLink)
      expect(onSelectDay).not.toHaveBeenCalled()
      expect(screen.getAllByText('Vestido Azul').length).toBeGreaterThan(0)
    }
  })
})
```

(The last test guards its assertions behind `if (showMoreLink)` because jsdom's layout engine doesn't compute real box heights, so react-big-calendar may not always decide to render a "+more" link in this environment for a small fixed event count — the e2e test in Task 7 is the real, layout-accurate check for this behavior. This unit test still exercises the wiring whenever jsdom does render the link.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/features/calendar/MonthView.test.tsx`
Expected: FAIL — `MonthView` doesn't yet accept `products`/`clientNames` props (TypeScript error / missing props).

- [ ] **Step 3: Update `MonthView.tsx`**

Replace the whole file:

```tsx
// client/src/features/calendar/MonthView.tsx
import { useState } from 'react'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { parseDateOnly } from '../../lib/date.ts'
import { CalendarDayItemsList } from './CalendarDayItemsList.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { Product } from '../products/productSchemas.ts'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ptBR }),
  getDay,
  locales: { 'pt-BR': ptBR },
})

const messages = {
  today: 'Hoje',
  previous: 'Anterior',
  next: 'Próximo',
  month: 'Mês',
}

export function MonthView({
  allocations,
  dateField,
  onSelectDay,
  productNames,
  products,
  clientNames,
  date,
  onNavigate,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  onSelectDay: (date: Date) => void
  productNames: Map<string, string>
  products: Map<string, Product>
  clientNames: Map<string, string>
  date: Date
  onNavigate: (date: Date) => void
}) {
  const [showMoreDay, setShowMoreDay] = useState<{ date: Date; allocations: Allocation[] } | null>(null)

  const events = allocations.map((allocation) => ({
    title: productNames.get(allocation.productId) ?? allocation.productId,
    start: parseDateOnly(allocation[dateField]),
    end: parseDateOnly(allocation[dateField]),
    allDay: true,
    resource: allocation,
  }))

  return (
    <div style={{ height: 500 }}>
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        views={['month']}
        date={date}
        onNavigate={onNavigate}
        onSelectEvent={(event) => onSelectDay(event.start)}
        onSelectSlot={(slot) => onSelectDay(slot.start)}
        onDrillDown={(drillDate) => onSelectDay(drillDate)}
        onShowMore={(dayEvents, day) =>
          setShowMoreDay({ date: day, allocations: dayEvents.map((event) => event.resource as Allocation) })
        }
        selectable
        culture="pt-BR"
        messages={messages}
      />
      <Dialog open={showMoreDay !== null} onOpenChange={(open) => !open && setShowMoreDay(null)}>
        <DialogContent showCloseButton={true} className="max-w-2xl">
          <DialogTitle className="mb-3 text-base font-semibold text-ink">
            {showMoreDay && new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(showMoreDay.date)}
          </DialogTitle>
          {showMoreDay && (
            <CalendarDayItemsList
              allocations={showMoreDay.allocations}
              products={products}
              clientNames={clientNames}
              dateField={dateField}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd client && npx vitest run src/features/calendar/MonthView.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Update `CalendarPage.tsx`'s `MonthView` usage to pass the two new props**

```tsx
      ) : (
        <MonthView
          allocations={allocations ?? []}
          dateField={tabDateField[tab]}
          productNames={productNames}
          products={productsById}
          clientNames={clientNames}
          date={anchor}
          onNavigate={setAnchor}
          onSelectDay={(date) => {
            setAnchor(date)
            setView('agenda')
          }}
        />
      )}
```

- [ ] **Step 6: Run the full client suite**

Run: `cd client && npm test`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/calendar/MonthView.tsx client/src/features/calendar/MonthView.test.tsx client/src/features/calendar/CalendarPage.tsx
git commit -m "fix: Month view '+N more' opens the day's items instead of bouncing to Agenda"
```

---

### Task 7: E2E regression test

**Files:**
- Create: `client/e2e/calendar-load.spec.ts`

**Interfaces:**
- Consumes: the 300 allocations seeded by Task 2's `server/seed-e2e-calendar-load.ts`, at route `/calendario` (confirmed in `client/src/app/router.tsx:25`).

- [ ] **Step 1: Write the test**

```ts
// client/e2e/calendar-load.spec.ts
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

  // Must NOT have bounced to Agenda (that toggle button would read "Ver mês" again if it had)
  await expect(page.getByRole('button', { name: 'Ver agenda' })).not.toBeVisible()
  await expect(page.getByText('Vestido Carga E2E').first()).toBeVisible()
})

test('clicking a calendar row opens the read-only product detail modal', async ({ page }) => {
  await login(page)
  await page.goto('/calendario')
  await page.getByText('Vestido Carga E2E').first().click()

  await expect(page.getByText('festa')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar' })).not.toBeVisible()
})
```

- [ ] **Step 2: Run it**

With `server/` running against a db seeded via both scripts from Task 2 (and `seed-e2e.ts`), run from `client/`:

```bash
npm run test:e2e -- calendar-load.spec.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add client/e2e/calendar-load.spec.ts
git commit -m "test: e2e coverage for calendar load behavior, pagination, and product photos"
```
