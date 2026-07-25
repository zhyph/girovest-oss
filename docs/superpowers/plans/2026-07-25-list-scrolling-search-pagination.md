# List Scrolling, Search, and Contracts Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the shared "scrolling loses the header/buttons" bug across Products, Clients, Contracts, Painel, and `ProductDrawer` by reusing the calendar's proven sticky-header/scrollable-middle layout pattern, and add real server-side pagination + search to Contracts (whose initial load, unlike Products/Clients, is genuinely slow because `listContracts` fetches every row unbounded).

**Architecture:** `AppLayout.tsx` stops owning page-level scroll (`main` drops `overflow-y-auto`, keeps `flex-1`, propagates height via `flex h-full flex-col` on its inner wrapper). Each affected page/drawer becomes `flex h-full min-h-0 flex-col` with a `flex-shrink-0` header/search region and a `min-h-0 flex-1 overflow-y-auto` list region — exactly `CalendarDayItemsList.tsx`'s existing pattern. Contracts additionally gets `page`/`pageSize`/`search` query params on `GET /api/contracts`, a `take`/`skip` + `contains` WHERE clause in `listContracts`, and client-side Previous/Next controls mirroring `CalendarDayItemsList`'s own pagination UI.

**Tech Stack:** React 19 + Tailwind CSS v4 (client), Prisma + SQLite/Postgres (server), Vitest + React Testing Library (unit), Playwright (e2e — required for the layout fixes, since jsdom doesn't compute real box overflow).

## Global Constraints

- Reuse `CalendarDayItemsList.tsx`'s exact CSS classes (`flex min-h-0 flex-1 flex-col`, `overflow-y-auto`, `flex-shrink-0`) for every sticky-header fix in this plan — do not invent a different pattern.
- Products/Clients keep their existing client-side search and data-fetching untouched — only their page-level layout changes.
- Painel (dashboard) gets the layout fix only — no search box is added (it's a stats view, nothing to search).
- Contracts' search and pagination must be server-side (query params), not client-side slicing of an already-fully-fetched list — that would not fix the reported slow initial load.
- Search must be case-insensitive under both SQLite and Postgres — reuse the exact `DB_PROVIDER === 'postgresql' ? { mode: 'insensitive' } : {}` pattern already used in `productService.ts`'s `listProductsForLocation`.
- No changes to `ProductDrawer`'s actual save/photo logic — only its dialog's layout (header/footer pinned, form fields scroll internally).

---

### Task 1: Server — Contracts pagination + search

**Files:**
- Modify: `server/src/services/contractService.ts:188-194` (`listContracts`)
- Modify: `server/src/routes/contracts.ts:35-39` (`GET /api/contracts`)
- Modify: `server/src/services/contractService.test.ts`
- Modify: `server/src/routes/contracts.test.ts`

**Interfaces:**
- Produces: `listContracts(locationId, { page, pageSize, search })` returns `{ contracts: Contract[], total: number, page: number, pageSize: number }`. Route accepts `?page=&pageSize=&search=` (defaults: `page=1`, `pageSize=20`).

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/contractService.test.ts`:

```ts
describe('listContracts pagination and search', () => {
  it('returns only pageSize contracts per page, newest first', async () => {
    const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `s-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: location.id } })
    const client = await prisma.client.create({ data: { name: 'C', phone: '1', email: 'c@e.com' } })
    for (let i = 0; i < 25; i++) {
      await prisma.contract.create({
        data: { number: i + 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
      })
    }
    const result = await listContracts(location.id, { page: 1, pageSize: 20, search: '' })
    expect(result.contracts).toHaveLength(20)
    expect(result.total).toBe(25)
    const page2 = await listContracts(location.id, { page: 2, pageSize: 20, search: '' })
    expect(page2.contracts).toHaveLength(5)
  })

  it('searches by client name, case-insensitive', async () => {
    const location = await prisma.location.create({ data: { name: 'L2', address: 'A' } })
    const staff = await prisma.staff.create({ data: { name: 'S', login: `s2-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: location.id } })
    const client = await prisma.client.create({ data: { name: 'Maria Silva', phone: '1', email: 'm@e.com' } })
    await prisma.contract.create({
      data: { number: 1, locationId: location.id, clientId: client.id, staffId: staff.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })
    const result = await listContracts(location.id, { page: 1, pageSize: 20, search: 'maria' })
    expect(result.contracts).toHaveLength(1)
    const noMatch = await listContracts(location.id, { page: 1, pageSize: 20, search: 'nobody' })
    expect(noMatch.contracts).toHaveLength(0)
  })

  it('never returns a contract from a different location', async () => {
    const locationA = await prisma.location.create({ data: { name: 'LA', address: 'A' } })
    const locationB = await prisma.location.create({ data: { name: 'LB', address: 'A' } })
    const staffA = await prisma.staff.create({ data: { name: 'S', login: `sa-${Date.now()}`, passwordHash: 'x', role: 'staff', locationId: locationA.id } })
    const clientA = await prisma.client.create({ data: { name: 'X', phone: '1', email: 'x@e.com' } })
    await prisma.contract.create({
      data: { number: 1, locationId: locationB.id, clientId: clientA.id, staffId: staffA.id, eventDate: new Date(), paymentMethod: 'PIX' },
    })
    const result = await listContracts(locationA.id, { page: 1, pageSize: 20, search: '' })
    expect(result.total).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npm test -- contractService.test.ts`
Expected: FAIL — `listContracts` doesn't accept a second argument yet, returns a bare array not `{ contracts, total, ... }`.

- [ ] **Step 3: Implement**

Replace `listContracts` in `server/src/services/contractService.ts`:

```ts
export async function listContracts(
  locationId: string,
  { page = 1, pageSize = 20, search = '' }: { page?: number; pageSize?: number; search?: string } = {},
) {
  const searchMode = process.env.DB_PROVIDER === 'postgresql' ? { mode: 'insensitive' as const } : {}
  const where = {
    locationId,
    ...(search
      ? { client: { name: { contains: search, ...searchMode } } }
      : {}),
  }
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { allocations: true, installments: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contract.count({ where }),
  ])
  return { contracts, total, page, pageSize }
}
```

Update `server/src/routes/contracts.ts`'s `GET /` handler:

```ts
contractsRouter.get('/', async (req, res) => {
  const locationId = await resolveLocationId(req)
  const page = Number(req.query.page ?? 1)
  const pageSize = Number(req.query.pageSize ?? 20)
  const search = typeof req.query.search === 'string' ? req.query.search : ''
  res.json(await listContracts(locationId, { page, pageSize, search }))
})
```

(Check `resolveLocationId`'s actual current name/shape in `contracts.ts` before this edit — reuse whatever the existing route already calls to resolve the authenticated staff's location; don't invent a new helper.)

- [ ] **Step 4: Run to verify pass, then full server suite**

Run: `cd server && npm test`
Expected: PASS, 0 failures. Update `server/src/routes/contracts.test.ts`'s existing `GET /` test(s) to expect `{ contracts, total, page, pageSize }` instead of a bare array.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/contractService.ts server/src/routes/contracts.ts server/src/services/contractService.test.ts server/src/routes/contracts.test.ts
git commit -m "feat: add server-side pagination and search to listContracts"
```

---

### Task 2: Client — AppLayout scroll delegation

**Files:**
- Modify: `client/src/app/AppLayout.tsx`
- Modify: `client/src/app/AppLayout.test.tsx`

**Interfaces:**
- Produces: `<main>` no longer scrolls itself; its inner wrapper is `flex h-full flex-col`, giving every routed page a bounded-height flex context to build its own `min-h-0 flex-1 overflow-y-auto` region within.

- [ ] **Step 1: Write the failing test**

Add to `client/src/app/AppLayout.test.tsx`:

```tsx
it('does not put overflow-y-auto on main (pages own their own scroll region now)', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><AppLayout /></MemoryRouter>
    </QueryClientProvider>,
  )
  const main = document.querySelector('main')
  expect(main?.className).not.toContain('overflow-y-auto')
  expect(main?.className).toContain('flex-1')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/app/AppLayout.test.tsx`
Expected: FAIL — `main` still has `overflow-y-auto`.

- [ ] **Step 3: Implement**

```tsx
export function AppLayout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1">
        <div className="mx-auto flex h-full max-w-4xl flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd client && npx vitest run src/app/AppLayout.test.tsx`
Expected: PASS.

**Note for Tasks 3-6**: after this change, every page rendered via `<Outlet />` sits inside a `flex h-full flex-col` parent. A page that does NOT opt into `flex h-full min-h-0 flex-col` itself will simply render at its natural content height with no scroll at all (content could get clipped if it's taller than the viewport, since nothing scrolls). This is intentional pressure — Tasks 3-6 must each update their page's root element, not just add content.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/AppLayout.tsx client/src/app/AppLayout.test.tsx
git commit -m "fix: AppLayout delegates scroll ownership to individual pages"
```

---

### Task 3: Client — ProductsPage and ClientsPage sticky layout

**Files:**
- Modify: `client/src/features/products/ProductsPage.tsx`
- Modify: `client/src/features/clients/ClientsPage.tsx`
- Modify: `client/src/features/products/ProductsPage.test.tsx`
- Modify: `client/src/features/clients/ClientsPage.test.tsx`

**Interfaces:**
- Consumes: Task 2's `flex h-full flex-col` parent from `AppLayout`.
- No prop/data changes — pure layout restructuring, existing search/filter logic untouched.

- [ ] **Step 1: Write the failing tests**

Add to both `ProductsPage.test.tsx` and `ClientsPage.test.tsx` (adjust import/component name per file):

```tsx
it('keeps the header and search pinned outside the scrollable list region', () => {
  mockHooks() // whatever this file's existing hook-mocking helper is called
  const { container } = render(<ProductsPage />)
  const root = container.firstElementChild as HTMLElement
  expect(root.className).toContain('min-h-0')
  expect(root.className).toContain('flex-1')
  const scrollRegion = container.querySelector('.overflow-y-auto')
  expect(scrollRegion).not.toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/features/products/ProductsPage.test.tsx src/features/clients/ClientsPage.test.tsx`
Expected: FAIL — neither page has these classes yet.

- [ ] **Step 3: Implement**

In `ProductsPage.tsx`, change the root `return (<div>...</div>)` wrapper and wrap the list section:

```tsx
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAddingPhotosRemotely(true)}>
            {t('photoIntake.sessionAction')}
          </Button>
          <Button onClick={() => setEditing(null)}>{t('common:actions.create')}</Button>
        </div>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="mb-3 flex-shrink-0"
        aria-label={t('searchPlaceholder')}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {products && products.length === 0 && <p className="text-muted-text">{t('empty')}</p>}
        {products && products.length > 0 && filteredProducts?.length === 0 && (
          <p className="text-muted-text">{t('noResults')}</p>
        )}
        {filteredProducts && filteredProducts.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border-soft">
            {/* ...existing header row + list .map(...) unchanged... */}
          </div>
        )}
      </div>
      {editing !== undefined && (/* ...unchanged... */)}
      <AddPhotosSessionModal open={addingPhotosRemotely} onClose={() => setAddingPhotosRemotely(false)} />
    </div>
  )
```

Apply the identical restructuring to `ClientsPage.tsx` (root `flex h-full min-h-0 flex-col`, header+search `flex-shrink-0`, list wrapper `min-h-0 flex-1 overflow-y-auto`) — its JSX shape is otherwise unchanged.

- [ ] **Step 4: Run to verify pass, then full client suite**

Run: `cd client && npm test`
Expected: PASS, 0 failures (aside from the pre-existing unrelated `AgendaView` flaky test if it happens to be a bad time of day — this was fixed in an earlier plan; if it still fails, that's a real regression to investigate, not expected).

- [ ] **Step 5: Commit**

```bash
git add client/src/features/products/ProductsPage.tsx client/src/features/clients/ClientsPage.tsx client/src/features/products/ProductsPage.test.tsx client/src/features/clients/ClientsPage.test.tsx
git commit -m "fix: pin header/search and scroll only the list on Products and Clients pages"
```

---

### Task 4: Client — ContractsPage sticky layout + pagination + search UI

**Files:**
- Modify: `client/src/features/contracts/ContractsPage.tsx`
- Modify: `client/src/features/contracts/useContracts.ts`
- Modify: `client/src/features/contracts/ContractsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1's `GET /api/contracts?page=&pageSize=&search=` returning `{ contracts, total, page, pageSize }`.
- `useContractsList` becomes `useContractsList({ page, pageSize, search })`.

- [ ] **Step 1: Write the failing test**

Add to `ContractsPage.test.tsx`:

```tsx
it('shows pagination controls and a search box, and searching resets to page 1', async () => {
  const listSpy = vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({
    data: { contracts: [makeContract()], total: 25, page: 1, pageSize: 20 },
    isLoading: false,
  } as never)
  render(<ContractsPage />)
  expect(screen.getByLabelText(/buscar/i)).toBeInTheDocument()
  expect(screen.getByText('1 / 2')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(/buscar/i), 'maria')
  expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'maria' }))
})
```

(Adjust the exact locale key/aria-label text to whatever `t('searchPlaceholder')` resolves to once you add it to `client/src/locales/pt-BR/contracts.json` — follow the same key name Products/Clients already use.)

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/features/contracts/ContractsPage.test.tsx`
Expected: FAIL — no search box, no pagination, `useContractsList` takes no args yet.

- [ ] **Step 3: Implement**

Update `useContractsList` in `useContracts.ts`:

```ts
export function useContractsList({ page = 1, pageSize = 20, search = '' }: { page?: number; pageSize?: number; search?: string } = {}) {
  return useQuery({
    queryKey: [...CONTRACTS_KEY, page, pageSize, search],
    queryFn: () =>
      apiFetch<{ contracts: Contract[]; total: number; page: number; pageSize: number }>(
        `/api/contracts?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`,
      ),
  })
}
```

Add `"searchPlaceholder": "Buscar por número ou cliente..."` to `client/src/locales/pt-BR/contracts.json`.

Restructure `ContractsPage.tsx`: add `page`/`search` state, pass to `useContractsList`, reset `page` to 1 when `search` changes, wrap root in `flex h-full min-h-0 flex-col` with header `flex-shrink-0`, add an `<Input>` search box (mirroring `ProductsPage.tsx`'s pattern) below the header and above the list, wrap the contract-list `.map()` in `min-h-0 flex-1 overflow-y-auto`, and add Previous/Next pagination controls below the scrollable list (mirroring `CalendarDayItemsList.tsx`'s `flex flex-shrink-0 items-center justify-between` pagination footer, using `data.total`/`data.pageSize` to compute total pages).

- [ ] **Step 4: Run to verify pass, then full client suite**

Run: `cd client && npm test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/contracts/ContractsPage.tsx client/src/features/contracts/useContracts.ts client/src/features/contracts/ContractsPage.test.tsx client/src/locales/pt-BR/contracts.json
git commit -m "feat: add pagination and search UI to Contracts page"
```

---

### Task 5: Client — DashboardPage (Painel) sticky layout

**Files:**
- Modify: `client/src/features/dashboard/DashboardPage.tsx`
- Modify: `client/src/features/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- No search box added — layout fix only, per Global Constraints.

- [ ] **Step 1: Write the failing test**

```tsx
it('scrolls the upcoming list internally instead of the whole page', () => {
  mockDashboardHooks() // existing helper
  const { container } = render(<DashboardPage />)
  const root = container.firstElementChild as HTMLElement
  expect(root.className).toContain('min-h-0')
  expect(container.querySelector('.overflow-y-auto')).not.toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/features/dashboard/DashboardPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
  return (
    <div className="flex h-full min-h-0 flex-col">
      <h1 className="mb-4 flex-shrink-0 text-xl font-semibold">{t('title')}</h1>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (/* ...unchanged... */)}
        {isError && (/* ...unchanged... */)}
        {!isLoading && !isError && (
          <>
            <div className="grid flex-shrink-0 grid-cols-3 gap-4">{/* ...stat tiles, unchanged... */}</div>
            <Card className="mt-4">{/* ...upcoming list, unchanged... */}</Card>
          </>
        )}
      </div>
    </div>
  )
```

- [ ] **Step 4: Run to verify pass, then full client suite**

Run: `cd client && npm test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/dashboard/DashboardPage.tsx client/src/features/dashboard/DashboardPage.test.tsx
git commit -m "fix: scroll Painel's upcoming list internally, keep stat tiles pinned"
```

---

### Task 6: Client — ProductDrawer footer fix + e2e coverage

**Files:**
- Modify: `client/src/features/products/ProductDrawer.tsx`
- Modify: `client/src/features/products/ProductDrawer.test.tsx`
- Create: `client/e2e/list-layout.spec.ts`

**Interfaces:**
- No data/prop changes — dialog layout only.

- [ ] **Step 1: Write the failing unit test**

```tsx
it('keeps the footer action buttons in a flex-shrink-0 region, form scrolls internally', () => {
  render(<ProductDrawer product={product} onClose={vi.fn()} />)
  const footer = screen.getByRole('button', { name: 'Salvar' }).closest('div')
  expect(footer?.className).toContain('flex-shrink-0')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/features/products/ProductDrawer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Read the current `DialogContent`/form structure in `ProductDrawer.tsx` first. Restructure so `DialogContent` is `flex max-h-[85vh] flex-col overflow-hidden` (mirroring `MonthView.tsx`'s day-items dialog fix), the form's field section becomes `min-h-0 flex-1 overflow-y-auto`, and the button row (`Cancelar`/`Salvar`/`Excluir`) becomes `flex-shrink-0`.

- [ ] **Step 4: Run to verify pass**

Run: `cd client && npx vitest run src/features/products/ProductDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suites + e2e**

Run: `cd client && npm test` (0 failures) and `cd server && npm test` (0 failures, sanity check nothing server-side broke).

Write `client/e2e/list-layout.spec.ts`: log in, for each of `/produtos`, `/clientes`, `/contratos`, and the dashboard route, assert `document.documentElement.scrollHeight` is within a couple pixels of `window.innerHeight` (no page-level scroll — same assertion style as the calendar's own e2e check). Seed enough products/clients (reuse `seed-e2e-calendar-load.ts`'s pattern or an existing bulk seed if one fits) to make the lists long enough that this would fail without the fix. Also open a product with 2+ photos and assert the Salvar button's bounding rect bottom is `<= ` the viewport height (the exact measurement that found the original bug).

Run: `cd client && npx playwright test list-layout.spec.ts --reporter=line` against a running app with seeded data. Confirm it passes.

- [ ] **Step 6: Commit**

```bash
git add client/src/features/products/ProductDrawer.tsx client/src/features/products/ProductDrawer.test.tsx client/e2e/list-layout.spec.ts
git commit -m "fix: pin ProductDrawer's action buttons, scroll the form internally; add e2e layout coverage"
```

## Self-Review

- Spec coverage: Task 1 covers Contracts pagination/search; Task 2 covers the shared `AppLayout` change every other task depends on; Tasks 3-5 cover Products/Clients/Contracts/Painel's sticky layout; Task 6 covers `ProductDrawer` plus end-to-end proof across all five surfaces. All spec decisions addressed.
- Placeholder scan: none found — every step has real code or a concrete run command.
- Type consistency: `listContracts`'s new second parameter and return shape (`{ contracts, total, page, pageSize }`) match exactly between Task 1 (server) and Task 4 (client's `useContractsList`/`ContractsPage`).
