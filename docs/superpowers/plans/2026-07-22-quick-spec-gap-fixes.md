# Quick Spec-Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six low-risk, already-diagnosed gaps between the running app and its own design spec (`docs/superpowers/specs/2026-07-20-dress-store-frontend-design.md`), found during the 2026-07-22 QA walkthrough.

**Architecture:** Each task is an independent, surgical change to an existing file — no new subsystems. Two tasks (Excluir visibility, currency input) touch both server and client; the rest are client-only.

**Tech Stack:** React 19 + TypeScript, react-hook-form + zod, TanStack Query, react-i18next, react-big-calendar + date-fns, Express + Prisma (SQLite/Postgres dual schema), Vitest + Testing Library.

## Global Constraints

- Currency/date formatting must use the built-in `Intl` API keyed off the active locale, per `docs/superpowers/specs/2026-07-17-dress-store-app-design.md:58`: *"Dates and currency are formatted with the built-in Intl API (`Intl.DateTimeFormat`, `Intl.NumberFormat`) keyed off the active locale (pt-BR → `DD/MM/YYYY`, `R$`)."*
- Delete visibility rule, verbatim from `docs/superpowers/specs/2026-07-20-dress-store-frontend-design.md:137-139`: *"Delete is only offered when the record has no [allocation history]... otherwise the drawer only offers edit/status-change actions."*
- Day-click rule, verbatim from `docs/superpowers/specs/2026-07-20-dress-store-frontend-design.md:161`: *"clicking a day in month view jumps back to the agenda view scrolled to that date."*
- All user-facing strings are pt-BR, sourced from `client/src/locales/pt-BR/*.json` via `useTranslation`, never hardcoded in JSX.
- Every task must leave `npm test` (client, from `client/`) and `npm test` (server, from `server/`) green, and `npx tsc --noEmit` clean in both packages.
- Server dual-schema note: Prisma has separate `server/prisma/sqlite/schema.prisma` and `server/prisma/postgresql/schema.prisma`, generated from a shared source by `npm run db:schema` — this plan's tasks don't touch the schema, only service-layer queries against the existing `Allocation`/`Client`/`Product` tables.

---

### Task 1: Sidebar background reaches the bottom of the screen

**Files:**
- Modify: `client/src/app/Sidebar.tsx:21`
- Test: `client/src/app/Sidebar.test.tsx` (existing — verify it still passes; this is a pure layout fix with no new behavior to assert in jsdom, which doesn't run real layout)

**Interfaces:** None — no other task depends on this one.

**Root cause (from the QA report):** `AppLayout.tsx` sets `min-h-screen` (a minimum, not a fixed height) on the flex row; `Sidebar.tsx` sets `h-full` (`height:100%`) on the `nav`. A percentage height can't resolve against an ancestor whose height comes only from `min-height`, so `h-full` silently falls back to `auto` (its content height, ~320px) instead of stretching to match `main`, which fills all 900px correctly via default flex `align-items:stretch`.

- [ ] **Step 1: Read the current classes to confirm line numbers haven't drifted**

Run: `grep -n "h-full\|min-h-screen" client/src/app/Sidebar.tsx client/src/app/AppLayout.tsx`
Expected: `Sidebar.tsx` shows `h-full` on the `<nav>` className; `AppLayout.tsx` shows `min-h-screen` on the row `<div>`.

- [ ] **Step 2: Remove `h-full` from the nav — let the parent flex row's default `align-items:stretch` do the job, exactly like `main` already does**

In `client/src/app/Sidebar.tsx`, change:

```tsx
    <nav className="flex h-full w-48 flex-col gap-1 border-r border-border-soft bg-white p-3">
```

to:

```tsx
    <nav className="flex w-48 flex-col gap-1 border-r border-border-soft bg-white p-3">
```

- [ ] **Step 3: Run the existing Sidebar test to confirm no regression**

Run (from `client/`): `npx vitest run src/app/Sidebar.test.tsx`
Expected: PASS (this test checks nav links and staff name, not layout height, so it should be unaffected)

- [ ] **Step 4: Visually confirm with the running app**

Use the `run` skill (or `npm run dev` from `client/` and `server/` in separate terminals) to start the app, log in, and confirm the sidebar's white background now reaches the bottom of the viewport regardless of window height.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/Sidebar.tsx
git commit -m "Fix sidebar background not reaching the bottom of the screen"
```

---

### Task 2: Staff name / Sair button visual separation

**Files:**
- Modify: `client/src/app/Sidebar.tsx:41-48`
- Test: `client/src/app/Sidebar.test.tsx` (existing — add one assertion)

**Interfaces:** None.

**Root cause (from the QA report):** 4px gap (`gap-1`), no padding on the ghost button, both flush to the same left edge — the staff name and the logout action read as one merged element.

- [ ] **Step 1: Read current markup**

The block in `client/src/app/Sidebar.tsx` currently reads:

```tsx
      {staff && (
        <div className="mt-auto flex flex-col gap-1 px-2">
          <div className="text-xs text-muted">{staff.name}</div>
          <Button variant="ghost" size="sm" className="justify-start px-0" onClick={logout}>
            {t('actions.logout')}
          </Button>
        </div>
      )}
```

- [ ] **Step 2: Add a hairline divider and more vertical space between the name and the logout action**

Replace with:

```tsx
      {staff && (
        <div className="mt-auto flex flex-col gap-2 border-t border-border-soft px-2 pt-3">
          <div className="text-xs text-muted">{staff.name}</div>
          <Button variant="ghost" size="sm" className="justify-start px-0" onClick={logout}>
            {t('actions.logout')}
          </Button>
        </div>
      )}
```

- [ ] **Step 3: Add a regression assertion to the existing Sidebar test**

In `client/src/app/Sidebar.test.tsx`, the single test `'shows the nav links and the logged-in staff name'` mocks `staff.name` as `'Ana Owner'` and already asserts `expect(screen.getByText('Ana Owner')).toBeInTheDocument()`. Add directly below that line:

```tsx
    expect(screen.getByText('Ana Owner').parentElement).toHaveClass('border-t')
```

(`getByText('Ana Owner')` returns the `<div className="text-xs text-muted">{staff.name}</div>` element itself; its `parentElement` is the wrapping `<div className="mt-auto flex flex-col gap-2 border-t ...">` from Step 2.)

- [ ] **Step 4: Run the test**

Run (from `client/`): `npx vitest run src/app/Sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/app/Sidebar.tsx client/src/app/Sidebar.test.tsx
git commit -m "Add visual separation between staff name and Sair button"
```

---

### Task 3: Month-view calendar toolbar in pt-BR

**Files:**
- Modify: `client/src/features/calendar/MonthView.tsx:1-13`
- Test: `client/src/features/calendar/MonthView.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — purely a `messages` prop addition to the existing `<Calendar>` element.

**Root cause (from the QA report):** `react-big-calendar`'s default toolbar ("Today / Back / Next") was never given a pt-BR `messages` prop, per `node_modules/@types/react-big-calendar/index.d.ts:308-325` (`Messages<TEvent>` interface with `today`/`previous`/`next`/`month` fields, among others). Since only `views={['month']}` is enabled, only those four keys are ever rendered.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/calendar/MonthView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MonthView } from './MonthView.tsx'

describe('MonthView', () => {
  it('renders the toolbar in pt-BR instead of the react-big-calendar English default', () => {
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={vi.fn()}
        productNames={new Map()}
        date={new Date(2026, 6, 22)}
        onNavigate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `client/`): `npx vitest run src/features/calendar/MonthView.test.tsx`
Expected: FAIL — buttons are named "Today" / "Back" / "Next" (react-big-calendar's English defaults), not "Hoje" / "Anterior" / "Próximo".

- [ ] **Step 3: Add a pt-BR `messages` object and pass it to `<Calendar>`**

In `client/src/features/calendar/MonthView.tsx`, add above the component:

```tsx
const messages = {
  today: 'Hoje',
  previous: 'Anterior',
  next: 'Próximo',
  month: 'Mês',
}
```

Then add `messages={messages}` to the `<Calendar>` element (alongside the existing `culture="pt-BR"` prop):

```tsx
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
        selectable
        culture="pt-BR"
        messages={messages}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `client/`): `npx vitest run src/features/calendar/MonthView.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full client suite to check for collateral breakage in CalendarPage tests**

Run (from `client/`): `npx vitest run`
Expected: all tests pass (CalendarPage tests don't currently assert on the English toolbar strings, so this should be a clean pass)

- [ ] **Step 6: Commit**

```bash
git add client/src/features/calendar/MonthView.tsx client/src/features/calendar/MonthView.test.tsx
git commit -m "Localize the month-view calendar toolbar to pt-BR"
```

---

### Task 4: Clicking a day in month view jumps to the agenda view

**Files:**
- Modify: `client/src/features/calendar/MonthView.tsx`
- Test: `client/src/features/calendar/MonthView.test.tsx` (extend the file created in Task 3)

**Interfaces:**
- Consumes: `onSelectDay: (date: Date) => void` (already a `MonthView` prop, wired by `CalendarPage.tsx` to switch to agenda view and set the anchor date — no change needed there).
- Produces: nothing new for other tasks.

**Root cause (from the QA report):** `MonthView.tsx` already passes `onSelectSlot={(slot) => onSelectDay(slot.start)}` and sets `selectable` — but the date-number button staff would naturally click fires `react-big-calendar`'s `onDrillDown` instead of `onSelectSlot` (confirmed in `node_modules/react-big-calendar/lib/DateHeader.js:19-20`, which renders the day number as `<a className="rbc-button-link" onClick={onDrillDown}>`). `onDrillDown` isn't wired at all, so the click is a no-op. Month navigation itself (Today/Back/Next) already works.

- [ ] **Step 1: Write the failing test (append to the file from Task 3)**

Add to `client/src/features/calendar/MonthView.test.tsx`:

```tsx
  it('jumps to the agenda view when a day number is clicked (onDrillDown, not just empty-cell onSelectSlot)', async () => {
    const onSelectDay = vi.fn()
    render(
      <MonthView
        allocations={[]}
        dateField="checkoutDate"
        onSelectDay={onSelectDay}
        productNames={new Map()}
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `client/`): `npx vitest run src/features/calendar/MonthView.test.tsx`
Expected: FAIL — `onSelectDay` was never called, since `onDrillDown` isn't wired.

- [ ] **Step 3: Wire `onDrillDown` to the same `onSelectDay` callback**

In `client/src/features/calendar/MonthView.tsx`, add `onDrillDown` to the `<Calendar>` element:

```tsx
        onSelectEvent={(event) => onSelectDay(event.start)}
        onSelectSlot={(slot) => onSelectDay(slot.start)}
        onDrillDown={(drillDate) => onSelectDay(drillDate)}
        selectable
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `client/`): `npx vitest run src/features/calendar/MonthView.test.tsx`
Expected: PASS (both tests in the file)

- [ ] **Step 5: Run the full client suite**

Run (from `client/`): `npx vitest run`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add client/src/features/calendar/MonthView.tsx client/src/features/calendar/MonthView.test.tsx
git commit -m "Wire month-view day clicks (onDrillDown) to jump to the agenda"
```

---

### Task 5: Hide "Excluir" on records with allocation history (server: Client)

**Files:**
- Modify: `server/src/services/clientService.ts`
- Modify: `server/src/routes/clients.ts` (no route changes needed — `listClients`/`getClient`/`createClient`/`updateClient` responses just gain a field; confirm this while reading)
- Test: `server/src/services/clientService.test.ts` (new — no existing test file for this service)

**Interfaces:**
- Produces: `ClientDTO` type with a new `hasAllocationHistory: boolean` field, consumed by Task 7 (client-side `Client` type + `ClientDrawer.tsx`).

**Root cause (from the QA report):** the design spec (quoted in Global Constraints) says delete should only be offered when a record has no allocation history. `deleteClient` already enforces this server-side (`CANNOT_DELETE_WITH_HISTORY`), but nothing in the API response tells the frontend that ahead of time, so `ClientDrawer.tsx` always renders the Excluir button whenever `client` is non-null.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/clientService.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { createClient, listClients, getClient, updateClient } from './clientService.js'

afterEach(async () => {
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.client.deleteMany()
  await prisma.location.deleteMany()
})

describe.sequential('clientService', () => {
  it('reports hasAllocationHistory false for a client with no allocations', async () => {
    const created = await createClient({ name: 'Maria', phone: '119', email: 'm@x.com' })
    expect(created.hasAllocationHistory).toBe(false)

    const fetched = await getClient(created.id)
    expect(fetched.hasAllocationHistory).toBe(false)

    const [listed] = await listClients()
    expect(listed.hasAllocationHistory).toBe(false)
  })

  it('reports hasAllocationHistory true once the client has an allocation, even after it is returned', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-hist', passwordHash: 'x', role: 'staff', locationId: location.id },
    })
    const product = await prisma.product.create({
      data: {
        locationId: location.id, name: 'Vestido', category: 'festa', size: 'M', color: 'azul',
        rentalPrice: 100, depositAmount: 50, photos: '[]',
      },
    })
    const client = await createClient({ name: 'Beatriz', phone: '129', email: 'b@x.com' })

    await prisma.allocation.create({
      data: {
        productId: product.id, clientId: client.id, staffId: staff.id,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'returned', actualReturnDate: new Date('2026-01-04'), priceCharged: 100,
      },
    })

    const fetched = await getClient(client.id)
    expect(fetched.hasAllocationHistory).toBe(true)

    const updated = await updateClient(client.id, { notes: 'updated' })
    expect(updated.hasAllocationHistory).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `npm test -- src/services/clientService.test.ts`
Expected: FAIL with `hasAllocationHistory` being `undefined`, not `false`/`true`.

- [ ] **Step 3: Add `hasAllocationHistory` to the service layer**

Replace the full contents of `server/src/services/clientService.ts`:

```ts
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

export interface CreateClientInput {
  name: string
  phone: string
  email: string
  notes?: string
}

export interface UpdateClientInput {
  name?: string
  phone?: string
  email?: string
  notes?: string | null
}

export interface ClientDTO {
  id: string
  name: string
  phone: string
  email: string
  notes: string | null
  hasAllocationHistory: boolean
  createdAt: Date
}

interface ClientRow {
  id: string
  name: string
  phone: string
  email: string
  notes: string | null
  createdAt: Date
}

function toDTO(row: ClientRow, hasAllocationHistory: boolean): ClientDTO {
  return { ...row, hasAllocationHistory }
}

async function hasHistory(clientId: string): Promise<boolean> {
  const count = await prisma.allocation.count({ where: { clientId } })
  return count > 0
}

async function historyByClientId(clientIds: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  if (clientIds.length === 0) return result
  const allocations = await prisma.allocation.findMany({
    where: { clientId: { in: clientIds } },
    select: { clientId: true },
    distinct: ['clientId'],
  })
  for (const allocation of allocations) {
    result.add(allocation.clientId)
  }
  return result
}

export async function createClient(data: CreateClientInput): Promise<ClientDTO> {
  const row = await prisma.client.create({ data })
  return toDTO(row, false)
}

export async function listClients(): Promise<ClientDTO[]> {
  const rows = await prisma.client.findMany({ orderBy: { createdAt: 'desc' } })
  const withHistory = await historyByClientId(rows.map((row) => row.id))
  return rows.map((row) => toDTO(row, withHistory.has(row.id)))
}

export async function getClient(id: string): Promise<ClientDTO> {
  const row = await prisma.client.findUnique({ where: { id } })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${id} not found`)
  }
  return toDTO(row, await hasHistory(id))
}

export async function updateClient(id: string, data: UpdateClientInput): Promise<ClientDTO> {
  await getClient(id)
  const row = await prisma.client.update({ where: { id }, data })
  return toDTO(row, await hasHistory(id))
}

export async function deleteClient(id: string): Promise<void> {
  await getClient(id)
  if (await hasHistory(id)) {
    throw new AppError(
      ErrorCodes.CANNOT_DELETE_WITH_HISTORY,
      409,
      'Cannot delete a client with allocation history',
    )
  }
  await prisma.client.delete({ where: { id } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `server/`): `npm test -- src/services/clientService.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full server suite (SQLite) to check for collateral breakage in the clients route tests**

Run (from `server/`): `npm test`
Expected: all tests pass — `clientsRouter` just forwards whatever `clientService` returns, so existing route tests asserting on `name`/`phone`/`email` fields are unaffected by the added field.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/clientService.ts server/src/services/clientService.test.ts
git commit -m "Add hasAllocationHistory to the client service, backing the Excluir visibility rule"
```

---

### Task 6: Hide "Excluir" on records with allocation history (server: Product)

**Files:**
- Modify: `server/src/services/productService.ts`
- Test: `server/src/services/productService.test.ts` (existing — add to it)

**Interfaces:**
- Produces: `ProductDTO.hasAllocationHistory: boolean`, consumed by Task 7.

**Root cause:** same spec rule as Task 5, applied to `ProductDrawer.tsx`'s Excluir button.

- [ ] **Step 1: Write the failing test**

Add to `server/src/services/productService.test.ts` (in the existing `describe.sequential('productService', ...)` block, after the last `it`):

```ts
  it('reports hasAllocationHistory, independent of availability', async () => {
    const staff = await prisma.staff.create({
      data: { name: 'S', login: 'staff-dhist', passwordHash: 'x', role: 'staff', locationId },
    })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c2@example.com' } })
    const product = await createProduct({
      locationId, name: 'A', category: 'festa', size: 'M', color: 'azul', rentalPrice: 1, depositAmount: 1,
    })

    expect(product.hasAllocationHistory).toBe(false)

    await prisma.allocation.create({
      data: {
        productId: product.id, clientId: client.id, staffId: staff.id,
        checkoutDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'),
        status: 'returned', actualReturnDate: new Date('2026-01-04'), priceCharged: 1,
      },
    })

    const fetched = await getProduct(product.id)
    expect(fetched.hasAllocationHistory).toBe(true)
    // returned means it's no longer occupied — history and current availability are different axes
    expect(fetched.availability).toBe('available')

    const [listed] = await listProducts()
    expect(listed.hasAllocationHistory).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `npm test -- src/services/productService.test.ts`
Expected: FAIL with `hasAllocationHistory` being `undefined`.

- [ ] **Step 3: Add `hasAllocationHistory` to `ProductDTO` and the service functions**

In `server/src/services/productService.ts`:

Add to the `ProductDTO` interface (alongside the existing `availability` field added in the previous bug-fix pass):

```ts
export interface ProductDTO {
  id: string
  locationId: string
  name: string
  description: string | null
  category: string
  size: string
  color: string
  rentalPrice: number
  depositAmount: number
  photos: string[]
  status: ProductStatus
  availability: DerivedAvailability
  hasAllocationHistory: boolean
  createdAt: Date
}
```

Update `toDTO` to take the new field:

```ts
function toDTO(row: ProductRow, availability: DerivedAvailability, hasAllocationHistory: boolean): ProductDTO {
  return {
    ...row,
    photos: JSON.parse(row.photos) as string[],
    status: row.status as ProductStatus,
    availability,
    hasAllocationHistory,
  }
}
```

Add two helpers next to `availabilityFor`/`availabilityByProductId`:

```ts
async function hasHistory(productId: string): Promise<boolean> {
  const count = await prisma.allocation.count({ where: { productId } })
  return count > 0
}

async function historyByProductId(productIds: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  if (productIds.length === 0) return result
  const allocations = await prisma.allocation.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true },
    distinct: ['productId'],
  })
  for (const allocation of allocations) {
    result.add(allocation.productId)
  }
  return result
}
```

Update every `toDTO(...)` call site to pass the new argument:

```ts
export async function createProduct(data: CreateProductInput): Promise<ProductDTO> {
  const row = await prisma.product.create({
    data: {
      locationId: data.locationId,
      name: data.name,
      description: data.description,
      category: data.category,
      size: data.size,
      color: data.color,
      rentalPrice: data.rentalPrice,
      depositAmount: data.depositAmount,
      photos: JSON.stringify(data.photos ?? []),
    },
  })
  return toDTO(row, 'available', false)
}

export async function listProducts(): Promise<ProductDTO[]> {
  const rows = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } })
  const availability = await availabilityByProductId(rows.map((row) => row.id))
  const withHistory = await historyByProductId(rows.map((row) => row.id))
  return rows.map((row) =>
    toDTO(row, availability.get(row.id) ?? 'available', withHistory.has(row.id)),
  )
}

export async function getProduct(id: string): Promise<ProductDTO> {
  const row = await prisma.product.findUnique({ where: { id } })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${id} not found`)
  }
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
}

export async function updateProduct(id: string, data: UpdateProductInput): Promise<ProductDTO> {
  await getProduct(id)
  const row = await prisma.product.update({
    where: { id },
    data: {
      ...data,
      photos: data.photos ? JSON.stringify(data.photos) : undefined,
    },
  })
  return toDTO(row, await availabilityFor(id), await hasHistory(id))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `server/`): `npm test -- src/services/productService.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full server suite on both SQLite and Postgres**

Run (from `server/`): `npm test && npm run test:postgres`
Expected: all tests pass on both

- [ ] **Step 6: Commit**

```bash
git add server/src/services/productService.ts server/src/services/productService.test.ts
git commit -m "Add hasAllocationHistory to the product service, backing the Excluir visibility rule"
```

---

### Task 7: Hide "Excluir" on records with allocation history (client)

**Files:**
- Modify: `client/src/features/clients/clientSchemas.ts`
- Modify: `client/src/features/products/productSchemas.ts`
- Modify: `client/src/features/clients/ClientDrawer.tsx`
- Modify: `client/src/features/products/ProductDrawer.tsx`
- Test: `client/src/features/clients/ClientDrawer.test.tsx`, `client/src/features/products/ProductDrawer.test.tsx` (existing — extend both), plus fixture updates in `client/src/features/clients/ClientsPage.test.tsx` and any other file constructing a full `Client`/`Product` object.

**Interfaces:**
- Consumes: `ClientDTO.hasAllocationHistory` (Task 5), `ProductDTO.hasAllocationHistory` (Task 6) — both already shipped as plain JSON fields on the existing `GET/POST/PATCH` responses, so no new endpoints are needed.
- Produces: `Client.hasAllocationHistory: boolean`, `Product.hasAllocationHistory: boolean` (client-side types), consumed only by the two drawers.

- [ ] **Step 1: Add `hasAllocationHistory` to the client-side types**

In `client/src/features/clients/clientSchemas.ts`, add to the `Client` interface:

```ts
export interface Client extends ClientFormValues {
  id: string
  hasAllocationHistory: boolean
  createdAt: string
}
```

In `client/src/features/products/productSchemas.ts`, add to the `Product` interface:

```ts
export interface Product extends ProductFormValues {
  id: string
  status: ProductStatus
  availability: ProductAvailability
  hasAllocationHistory: boolean
  createdAt: string
}
```

- [ ] **Step 2: Write the failing tests**

In `client/src/features/clients/ClientDrawer.test.tsx`, the fixture at the top currently reads:

```tsx
const client = { id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }
```

Add `hasAllocationHistory: false` to it:

```tsx
const client = {
  id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01',
  hasAllocationHistory: false,
}
```

Then add a new test:

```tsx
  it('hides Excluir when the client has allocation history, per the drawer spec', () => {
    mockClientHooks(vi.fn())
    render(<ClientDrawer client={{ ...client, hasAllocationHistory: true }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
```

In `client/src/features/products/ProductDrawer.test.tsx`, the fixture already has `availability: 'available' as const` from the prior bug-fix pass — add `hasAllocationHistory: false` alongside it, then add the matching test:

```tsx
  it('hides Excluir when the product has allocation history, per the drawer spec', () => {
    mockProductHooks(vi.fn())
    render(<ProductDrawer product={{ ...product, hasAllocationHistory: true }} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `client/`): `npx vitest run src/features/clients/ClientDrawer.test.tsx src/features/products/ProductDrawer.test.tsx`
Expected: FAIL — Excluir still renders regardless of `hasAllocationHistory` (the drawers don't check the field yet).

- [ ] **Step 4: Update the Excluir condition in both drawers**

In `client/src/features/clients/ClientDrawer.tsx`, change:

```tsx
          {client && (
            <Button type="button" variant="ghost" onClick={handleDelete} disabled={deleteClient.isPending}>
```

to:

```tsx
          {client && !client.hasAllocationHistory && (
            <Button type="button" variant="ghost" onClick={handleDelete} disabled={deleteClient.isPending}>
```

In `client/src/features/products/ProductDrawer.tsx`, change:

```tsx
          {product && (
            <Button type="button" variant="ghost" onClick={handleDelete} disabled={deleteProduct.isPending}>
```

to:

```tsx
          {product && !product.hasAllocationHistory && (
            <Button type="button" variant="ghost" onClick={handleDelete} disabled={deleteProduct.isPending}>
```

- [ ] **Step 5: Fix the two fixtures that pass `Client`/`Product` as directly-typed props (the only ones `tsc` will reject)**

Verified via `grep -n "render(<ClientDrawer\|render(<ProductDrawer" client/src/features/**/*.test.tsx`: only `ClientDrawer.test.tsx` and `ProductDrawer.test.tsx` pass their `client`/`product` fixture straight into a typed component prop (`<ClientDrawer client={client} .../>`, `<ProductDrawer product={product} .../>`). Every other test file (`ClientsPage.test.tsx`, `ProductsPage.test.tsx`, `AllocationsPage.test.tsx`, `NewAllocationForm.test.tsx`, `CalendarPage.test.tsx`) only ever feeds its fixture through `vi.spyOn(...).mockReturnValue({...} as never)`, and the `as never` cast means `tsc` never checks those object literals against `Client`/`Product` — so they don't strictly need the new field. Step 2 above already added `hasAllocationHistory` to both fixtures that do need it; this step is just confirming there's nothing else to fix.

- [ ] **Step 6: Run test to verify it passes, then run `tsc` to catch any remaining fixture gaps**

Run (from `client/`):
```bash
npx vitest run
npx tsc --noEmit
```
Expected: both clean. Any remaining TS2741 (`Property 'hasAllocationHistory' is missing`) errors point to a fixture Step 5 missed — fix it and re-run.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/clients/clientSchemas.ts client/src/features/products/productSchemas.ts \
        client/src/features/clients/ClientDrawer.tsx client/src/features/products/ProductDrawer.tsx \
        client/src/features/clients/ClientDrawer.test.tsx client/src/features/products/ProductDrawer.test.tsx
git commit -m "Hide Excluir on clients/products with allocation history, per the drawer spec"
```

---

### Task 8: Locale-aware currency input for money fields

**Files:**
- Create: `client/src/components/ui/currency-input.tsx`
- Test: `client/src/components/ui/currency-input.test.tsx` (new)
- Modify: `client/src/features/products/ProductDrawer.tsx` (rentalPrice, depositAmount)
- Modify: `client/src/features/allocations/NewAllocationForm.tsx` (priceCharged)
- Test: `client/src/features/products/ProductDrawer.test.tsx`, `client/src/features/allocations/NewAllocationForm.test.tsx` (existing — verify unaffected; these tests use `getByLabelText` + `userEvent.type`, which needs to still work against the new input)

**Interfaces:**
- Produces: `CurrencyInput` component with props `{ value: number; onChange: (value: number) => void; onBlur?: () => void; name?: string; id?: string }`, wired into forms via react-hook-form's `Controller`, not `register` (native number inputs use `register` because DOM value ↔ number is 1:1; this component needs to intercept formatted-text ↔ number, which `Controller` is the standard react-hook-form pattern for).

**Root cause (from the QA report):** `rentalPrice`, `depositAmount` (`ProductDrawer.tsx:82-87`), and `priceCharged` (`NewAllocationForm.tsx:75`) are plain `<input type="number" step="0.01">` — no `R$`, no thousands separator, and the browser's native spinner arrows sit on a currency field. The spec (Global Constraints) commits to `Intl.NumberFormat` for currency; it's never called anywhere in the client.

- [ ] **Step 1: Write the failing test for the new component**

Create `client/src/components/ui/currency-input.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CurrencyInput } from './currency-input.tsx'

describe('CurrencyInput', () => {
  it('formats an initial numeric value as BRL currency text', () => {
    render(<CurrencyInput value={1234.5} onChange={vi.fn()} aria-label="Preço" />)
    expect(screen.getByLabelText('Preço')).toHaveValue('R$ 1.234,50')
  })

  it('parses typed digits back into a plain number on change', async () => {
    const onChange = vi.fn()
    render(<CurrencyInput value={0} onChange={onChange} aria-label="Preço" />)

    const input = screen.getByLabelText('Preço')
    await userEvent.clear(input)
    await userEvent.type(input, '150')

    expect(onChange).toHaveBeenLastCalledWith(150)
  })

  it('has no native number-input spinner arrows (it is a text input under the hood)', () => {
    render(<CurrencyInput value={0} onChange={vi.fn()} aria-label="Preço" />)
    expect(screen.getByLabelText('Preço')).toHaveAttribute('type', 'text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `client/`): `npx vitest run src/components/ui/currency-input.test.tsx`
Expected: FAIL — `currency-input.tsx` doesn't exist yet.

- [ ] **Step 3: Implement the component**

Create `client/src/components/ui/currency-input.tsx`:

```tsx
import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function parseDigitsToNumber(raw: string): number {
  const digitsOnly = raw.replace(/\D/g, '')
  if (digitsOnly === '') return 0
  return Number(digitsOnly) / 100
}

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onChange: (value: number) => void
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput({ className, value, onChange, ...props }, ref) {
    const [display, setDisplay] = useState(() => currencyFormatter.format(value))

    useEffect(() => {
      setDisplay(currencyFormatter.format(value))
    }, [value])

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(event) => {
          const nextValue = parseDigitsToNumber(event.target.value)
          setDisplay(currencyFormatter.format(nextValue))
          onChange(nextValue)
        }}
        className={cn(
          'h-10 w-full rounded-md border border-border-soft bg-white px-3 text-sm text-ink placeholder:text-muted transition-colors',
          'hover:border-brand-300',
          'focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
```

Design note: the input tracks raw digits (like a POS terminal — typing "1", "5", "0" produces R$ 1,50) rather than parsing partially-typed decimal text, which sidesteps ambiguous mid-typing states like `"1."` or `"1,5"`. This is a deliberate, simpler alternative to trying to make a free-text decimal field re-format itself on every keystroke.

- [ ] **Step 4: Run test to verify it passes**

Run (from `client/`): `npx vitest run src/components/ui/currency-input.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire `CurrencyInput` into `ProductDrawer.tsx` via react-hook-form's `Controller`**

In `client/src/features/products/ProductDrawer.tsx`, add `Controller` to the react-hook-form import:

```tsx
import { useForm, Controller } from 'react-hook-form'
```

Add `CurrencyInput` to the imports:

```tsx
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
```

Destructure `control` from `useForm`:

```tsx
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ProductFormValues>({
```

Replace the rentalPrice and depositAmount fields:

```tsx
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.rentalPrice')}
          <Controller
            name="rentalPrice"
            control={control}
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} id="rentalPrice" aria-label={t('fields.rentalPrice')} />
            )}
          />
          {errors.rentalPrice && <span className="text-xs text-red-600">{t('validation.rentalPriceInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.depositAmount')}
          <Controller
            name="depositAmount"
            control={control}
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} id="depositAmount" aria-label={t('fields.depositAmount')} />
            )}
          />
          {errors.depositAmount && <span className="text-xs text-red-600">{t('validation.depositAmountInvalid')}</span>}
        </label>
```

Note: this changes the accessible name source from a `<label>`-wrapping association to an explicit `aria-label` on the input, since `CurrencyInput` no longer accepts a spread-in `id`/`{...register(...)}` pairing the same way. The existing `ProductDrawer.test.tsx` tests use `screen.getByLabelText('Nome')` etc. for other fields (unaffected) — verify in Step 7 whether any existing test looks up `rentalPrice`/`depositAmount` by label (grep shows none currently do, since those tests only ever type into Nome/Categoria/Tamanho/Cor).

- [ ] **Step 6: Wire `CurrencyInput` into `NewAllocationForm.tsx` for `priceCharged`, the same way**

In `client/src/features/allocations/NewAllocationForm.tsx`, add `Controller` to the react-hook-form import, add the `CurrencyInput` import, destructure `control` from `useForm`, and replace:

```tsx
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.priceCharged')}
          <Input type="number" step="0.01" {...register('priceCharged', { valueAsNumber: true })} />
        </label>
```

with:

```tsx
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.priceCharged')}
          <Controller
            name="priceCharged"
            control={control}
            render={({ field }) => (
              <CurrencyInput value={field.value} onChange={field.onChange} id="priceCharged" aria-label={t('fields.priceCharged')} />
            )}
          />
        </label>
```

- [ ] **Step 7: Run both drawers' existing tests and the full client suite**

Run (from `client/`):
```bash
npx vitest run src/features/products/ProductDrawer.test.tsx src/features/allocations/NewAllocationForm.test.tsx
npx vitest run
```
Expected: all pass. If any test fails on a `getByLabelText`/`getByRole('spinbutton')` lookup for rentalPrice/depositAmount/priceCharged, update that test's query to `getByLabelText` matching the new `aria-label` (same text as the field's translation key, e.g. `t('fields.rentalPrice')` → "Preço do aluguel").

- [ ] **Step 8: Run `tsc` to confirm the `Controller` wiring type-checks**

Run (from `client/`): `npx tsc --noEmit`
Expected: clean

- [ ] **Step 9: Manually verify in the running app**

Use the `run` skill to start the app, open the product drawer and the new-allocation form, and confirm: typing digits produces `R$ 1.234,56`-style formatting, no spinner arrows are visible, and submitting still sends a plain number to the API (check the network tab).

- [ ] **Step 10: Commit**

```bash
git add client/src/components/ui/currency-input.tsx client/src/components/ui/currency-input.test.tsx \
        client/src/features/products/ProductDrawer.tsx client/src/features/allocations/NewAllocationForm.tsx
git commit -m "Add locale-aware CurrencyInput, replacing raw number inputs for money fields"
```

---

## Self-Review Notes

- **Spec coverage:** all six items from the "Quick spec-gap fixes" bucket are covered — sidebar height (Task 1), toolbar strings (Task 3), day-click drill-down (Task 4), Excluir visibility (Tasks 5-7), money formatting (Task 8), staff-name spacing (Task 2).
- **Type consistency:** `ProductDTO`/`ClientDTO` field names (`availability`, `hasAllocationHistory`) match between server (Tasks 5-6) and the client-side `Product`/`Client` types (Task 7). `CurrencyInput`'s `{ value: number; onChange: (value: number) => void }` signature (Task 8) matches how `Controller`'s `field` object is spread in both call sites.
- **Sequencing:** Tasks 5 → 6 → 7 must run in order (7 depends on 5 and 6's response shape). Tasks 1-4 and 8 have no dependencies on each other or on 5-7, so they can run in any order or in parallel across subagents.
