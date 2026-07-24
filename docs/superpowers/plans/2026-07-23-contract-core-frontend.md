# Contract Core — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend half of the Contract core — a booking form that creates a multi-item Contract in one submission, a `ContractsPage` that replaces `AllocationsPage` as the primary booking list, a small Location settings screen for editing the shop's phone/contract clauses, and retirement of the old single-item "New Allocation" flow, closing the gap Plan 3's final review flagged (a live path that could still create Contract-less Allocations).

**Architecture:** `NewContractForm` is a single wide drawer with all fields visible and scrollable — not a literal multi-screen wizard — matching this codebase's existing drawer patterns (`ClientDrawer`, the old `NewAllocationForm`), which are all single-scroll forms, not step wizards. Its client-selection section reuses `ClientDrawer` itself (opened in edit mode, stacked on top) for completing a client's missing required identity documents/address lines, rather than rebuilding that already-correct repeatable-list editor a second time. `ContractsPage` reuses `AllocationsPage`'s existing `RowActions` component unchanged for per-item checkout/return/cancel — only the outer structure changes from a flat Allocation list to Contracts-with-nested-items. The Location settings screen follows the exact full-replace-on-present-key pattern already established in `clientService.ts` for editing an ordered list of child rows.

**Tech Stack:** Existing stack only — React, react-hook-form (`useFieldArray`), Zod, TanStack Query, Express, Prisma, Vitest, Testing Library. No new dependencies.

## Global Constraints

- No new npm dependencies.
- Every new drawer/form with a repeatable list gets `overflow-y-auto` and an asymmetric label/value column split from the start — this session already hit and fixed a real bug (`ClientDrawer`'s Save button was unreachable, labels were truncated) from not doing this; do not reintroduce it.
- Follow existing test conventions exactly: Vitest, Testing Library, `mockClientHooks()`/`renderWithToast()`-style helpers where a component test needs them (check each target file's actual current conventions before writing tests against it — `ClientDrawer.test.tsx` already established these helpers this session), real-DB integration style for service tests, one `describe` per unit.
- TDD: write the failing test before the implementation in every task.
- The client-side "required identity document / address line" check (Task 5) is a UI-only concern — it never blocks the backend from accepting a Contract; the backend was deliberately built (Plan 3) to never validate this. The frontend enforces it only as a submit-time gate in `NewContractForm`.
- Required-field matching between a locale template entry and a client's stored row is done by **label text** (case-insensitive), not `maskKey` — `maskKey` (Plan 2) exists purely to drive input masking and is `null` for every address-line template entry, so it can't serve as a universal correlation key. This is a deliberate design decision made in this plan, not an oversight.
- `POST /api/allocations` (standalone Allocation creation) is removed in Task 8 of this plan — every Allocation from that point forward is created only via `POST /api/contracts`. The GET, check-out, return, cancel, and availability endpoints on `/api/allocations` are unaffected and stay exactly as they are, since individual Allocations (now always Contract members) still need those.

---

### Task 1: Payment method locale template

**Files:**
- Create: `client/src/lib/paymentMethodTemplate.ts`
- Create: `client/src/lib/paymentMethodTemplate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getPaymentMethods(locale: string | undefined): string[]`. Consumed by Task 6 (`NewContractForm`'s payment step).

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/paymentMethodTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getPaymentMethods } from './paymentMethodTemplate.ts'

describe('getPaymentMethods', () => {
  it('returns the pt-BR payment methods in order', () => {
    expect(getPaymentMethods('pt-BR')).toEqual(['Dinheiro', 'Cheque', 'PIX'])
  })

  it('falls back to pt-BR for an unregistered locale', () => {
    expect(getPaymentMethods('xx-YY')).toEqual(['Dinheiro', 'Cheque', 'PIX'])
  })

  it('falls back to pt-BR for undefined', () => {
    expect(getPaymentMethods(undefined)).toEqual(['Dinheiro', 'Cheque', 'PIX'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/paymentMethodTemplate.test.ts`
Expected: FAIL — `paymentMethodTemplate.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/paymentMethodTemplate.ts`:

```ts
const DEFAULT_LOCALE = 'pt-BR'

export const PAYMENT_METHOD_TEMPLATES: Record<string, string[]> = {
  'pt-BR': ['Dinheiro', 'Cheque', 'PIX'],
}

export function getPaymentMethods(locale: string | undefined): string[] {
  return PAYMENT_METHOD_TEMPLATES[locale ?? DEFAULT_LOCALE] ?? PAYMENT_METHOD_TEMPLATES[DEFAULT_LOCALE]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/paymentMethodTemplate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/paymentMethodTemplate.ts client/src/lib/paymentMethodTemplate.test.ts
git commit -m "feat: add payment method locale template"
```

---

### Task 2: Location settings — backend

**Files:**
- Create: `server/src/services/locationSettingsService.ts`
- Create: `server/src/services/locationSettingsService.test.ts`
- Create: `server/src/routes/locationSettings.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getLocationSettings(locationId: string): Promise<LocationSettingsDTO>`, `updateLocationSettings(locationId: string, data: UpdateLocationSettingsInput): Promise<LocationSettingsDTO>`, where:
  ```ts
  interface LocationSettingsDTO {
    id: string
    name: string
    phone: string | null
    clauses: { id: string; text: string; sortOrder: number }[]
  }
  interface UpdateLocationSettingsInput {
    phone?: string | null
    clauses?: { text: string }[]
  }
  ```
  `GET /api/settings` and `PATCH /api/settings` (scoped to the authenticated staff's own Location, no `:id` in the URL — mirrors how `GET /api/auth/me` resolves identity from the token, not a path param). Consumed by Task 3 (`useLocationSettings.ts`).

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/locationSettingsService.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { getLocationSettings, updateLocationSettings } from './locationSettingsService.js'

afterEach(async () => {
  await prisma.locationContractClause.deleteMany()
  await prisma.location.deleteMany()
})

describe('getLocationSettings', () => {
  it('returns the phone and clauses ordered by sortOrder', async () => {
    const location = await prisma.location.create({
      data: {
        name: 'L',
        address: 'A',
        phone: '11987654321',
        contractClauses: {
          create: [
            { text: 'Second clause', sortOrder: 1 },
            { text: 'First clause', sortOrder: 0 },
          ],
        },
      },
    })

    const settings = await getLocationSettings(location.id)

    expect(settings.phone).toBe('11987654321')
    expect(settings.clauses.map((clause) => clause.text)).toEqual(['First clause', 'Second clause'])
  })

  it('throws NOT_FOUND for a missing location', async () => {
    await expect(getLocationSettings('does-not-exist')).rejects.toThrow(AppError)
  })
})

describe('updateLocationSettings', () => {
  it('updates the phone without touching clauses when clauses is omitted', async () => {
    const location = await prisma.location.create({
      data: { name: 'L', address: 'A', contractClauses: { create: [{ text: 'Original', sortOrder: 0 }] } },
    })

    const updated = await updateLocationSettings(location.id, { phone: '11999998888' })

    expect(updated.phone).toBe('11999998888')
    expect(updated.clauses.map((clause) => clause.text)).toEqual(['Original'])
  })

  it('replaces all clauses, in the given order, when clauses is provided', async () => {
    const location = await prisma.location.create({
      data: { name: 'L', address: 'A', contractClauses: { create: [{ text: 'Old clause', sortOrder: 0 }] } },
    })

    const updated = await updateLocationSettings(location.id, {
      clauses: [{ text: 'New first' }, { text: 'New second' }],
    })

    expect(updated.clauses.map((clause) => clause.text)).toEqual(['New first', 'New second'])
    expect(updated.clauses.map((clause) => clause.sortOrder)).toEqual([0, 1])
  })

  it('clears all clauses when given an empty array', async () => {
    const location = await prisma.location.create({
      data: { name: 'L', address: 'A', contractClauses: { create: [{ text: 'Old', sortOrder: 0 }] } },
    })

    const updated = await updateLocationSettings(location.id, { clauses: [] })

    expect(updated.clauses).toEqual([])
  })

  it('throws NOT_FOUND for a missing location', async () => {
    await expect(updateLocationSettings('does-not-exist', { phone: '1' })).rejects.toThrow(AppError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- locationSettingsService.test.ts`
Expected: FAIL — `locationSettingsService.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/services/locationSettingsService.ts`:

```ts
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

export interface ClauseInput {
  text: string
}

export interface UpdateLocationSettingsInput {
  phone?: string | null
  clauses?: ClauseInput[]
}

export interface ClauseDTO {
  id: string
  text: string
  sortOrder: number
}

export interface LocationSettingsDTO {
  id: string
  name: string
  phone: string | null
  clauses: ClauseDTO[]
}

function toDTO(location: {
  id: string
  name: string
  phone: string | null
  contractClauses: ClauseDTO[]
}): LocationSettingsDTO {
  return {
    id: location.id,
    name: location.name,
    phone: location.phone,
    clauses: [...location.contractClauses].sort((a, b) => a.sortOrder - b.sortOrder),
  }
}

export async function getLocationSettings(locationId: string): Promise<LocationSettingsDTO> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { contractClauses: true },
  })
  if (!location) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Location ${locationId} not found`)
  }
  return toDTO(location)
}

export async function updateLocationSettings(
  locationId: string,
  data: UpdateLocationSettingsInput,
): Promise<LocationSettingsDTO> {
  await getLocationSettings(locationId)

  await prisma.$transaction(async (tx) => {
    if (data.phone !== undefined) {
      await tx.location.update({ where: { id: locationId }, data: { phone: data.phone } })
    }

    if (data.clauses !== undefined) {
      await tx.locationContractClause.deleteMany({ where: { locationId } })
      if (data.clauses.length > 0) {
        await tx.locationContractClause.createMany({
          data: data.clauses.map((clause, index) => ({ locationId, text: clause.text, sortOrder: index })),
        })
      }
    }
  })

  return getLocationSettings(locationId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- locationSettingsService.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 5: Write the route**

Create `server/src/routes/locationSettings.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/authMiddleware.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { prisma } from '../db/client.js'
import { getLocationSettings, updateLocationSettings } from '../services/locationSettingsService.js'

export const locationSettingsRouter = Router()
locationSettingsRouter.use(requireAuth)

async function resolveLocationId(staffId: string): Promise<string> {
  const staff = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } })
  return staff.locationId
}

locationSettingsRouter.get('/', async (req, res) => {
  const locationId = await resolveLocationId(req.staff!.staffId)
  res.json(await getLocationSettings(locationId))
})

const clauseSchema = z.object({ text: z.string().min(1) })

const updateSchema = z.object({
  phone: z.string().nullable().optional(),
  clauses: z.array(clauseSchema).optional(),
})

locationSettingsRouter.patch('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success || !req.staff) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid settings payload')
  }
  const locationId = await resolveLocationId(req.staff.staffId)
  res.json(await updateLocationSettings(locationId, parsed.data))
})
```

- [ ] **Step 6: Wire the router into `app.ts`**

Modify `server/src/app.ts` — add the import and mount it alongside the other routers, above the trailing `errorMiddleware` line:

```ts
import { locationSettingsRouter } from './routes/locationSettings.js'
```

```ts
app.use('/api/settings', locationSettingsRouter)
```

- [ ] **Step 7: Verify with a type-check and the full server suite**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

Run: `cd server && npm test`
Expected: PASS, all files.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/locationSettingsService.ts server/src/services/locationSettingsService.test.ts server/src/routes/locationSettings.ts server/src/app.ts
git commit -m "feat: add location settings service and route"
```

---

### Task 3: Location settings — frontend

**Files:**
- Create: `client/src/features/settings/settingsSchemas.ts`
- Create: `client/src/features/settings/useLocationSettings.ts`
- Create: `client/src/features/settings/SettingsPage.tsx`
- Create: `client/src/features/settings/SettingsPage.test.tsx`
- Create: `client/src/locales/pt-BR/settings.json`
- Modify: `client/src/i18n.ts`
- Modify: `client/src/app/router.tsx`
- Modify: `client/src/app/Sidebar.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/settings` (Task 2); `PhoneInput` (existing, locale-plumbing plan); `Button`/`Input` (existing).
- Produces: a new `/configuracoes` route reachable from a new "Configurações" sidebar entry, using a new lucide-react `Settings` icon (already available via the existing `lucide-react` dependency, same import style as the other Sidebar icons).

There's no existing page this naturally nests under — it's shop-level configuration, not scoped to clients/products/allocations/calendar — so it gets its own top-level nav entry, matching how every other distinct concern in this app already has one.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/settings/settingsSchemas.ts` first (needed by the test):

```ts
import { z } from 'zod'

export const clauseSchema = z.object({ text: z.string().min(1) })

export const locationSettingsSchema = z.object({
  phone: z.string(),
  clauses: z.array(clauseSchema),
})

export type LocationSettingsFormValues = z.infer<typeof locationSettingsSchema>

export interface Clause {
  id: string
  text: string
  sortOrder: number
}

export interface LocationSettings {
  id: string
  name: string
  phone: string | null
  clauses: Clause[]
}
```

Create `client/src/features/settings/SettingsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { SettingsPage } from './SettingsPage.tsx'
import * as useLocationSettingsModule from './useLocationSettings.ts'
import { Toaster } from '../../components/ui/sonner.tsx'
import type { LocationSettings } from './settingsSchemas.ts'

const settings: LocationSettings = {
  id: 'loc1',
  name: 'Priscila Moda Festa',
  phone: '11987654321',
  clauses: [
    { id: 'c1', text: 'Primeira cláusula', sortOrder: 0 },
    { id: 'c2', text: 'Segunda cláusula', sortOrder: 1 },
  ],
}

function renderWithToast(ui: React.ReactElement) {
  return render(<>{ui}<Toaster /></>)
}

function mockSettingsHooks(updateImpl: (...args: never[]) => Promise<unknown> = vi.fn()) {
  vi.spyOn(useLocationSettingsModule, 'useLocationSettings').mockReturnValue({
    data: settings,
    isLoading: false,
  } as never)
  vi.spyOn(useLocationSettingsModule, 'useUpdateLocationSettings').mockReturnValue({
    mutateAsync: updateImpl,
    isPending: false,
  } as never)
}

describe('SettingsPage', () => {
  it('shows the current phone and clause rows', () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    expect(screen.getByLabelText('Telefone')).toHaveValue('(11) 98765-4321')
    expect(screen.getByDisplayValue('Primeira cláusula')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Segunda cláusula')).toBeInTheDocument()
  })

  it('lets staff add a clause row', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar cláusula/i }))
    expect(screen.getAllByLabelText('Texto da cláusula')).toHaveLength(3)
  })

  it('lets staff remove a clause row', async () => {
    mockSettingsHooks()
    renderWithToast(<SettingsPage />)
    const removeButtons = screen.getAllByRole('button', { name: /remover cláusula/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('Primeira cláusula')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Segunda cláusula')).toBeInTheDocument()
  })

  it('saves the phone and clauses in order', async () => {
    const updateImpl = vi.fn().mockResolvedValue(settings)
    mockSettingsHooks(updateImpl)
    renderWithToast(<SettingsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(updateImpl).toHaveBeenCalledWith({
      phone: '11987654321',
      clauses: [{ text: 'Primeira cláusula' }, { text: 'Segunda cláusula' }],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/features/settings/SettingsPage.test.tsx`
Expected: FAIL — `useLocationSettings.ts` and `SettingsPage.tsx` don't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/features/settings/useLocationSettings.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { LocationSettings, LocationSettingsFormValues } from './settingsSchemas.ts'

const SETTINGS_KEY = ['settings']

export function useLocationSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<LocationSettings>('/api/settings'),
  })
}

export function useUpdateLocationSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: LocationSettingsFormValues) =>
      apiFetch<LocationSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  })
}
```

Create `client/src/locales/pt-BR/settings.json`:

```json
{
  "title": "Configurações",
  "fields": {
    "phone": "Telefone"
  },
  "clauses": {
    "title": "Cláusulas do Contrato",
    "textFieldAria": "Texto da cláusula",
    "add": "Adicionar cláusula",
    "remove": "Remover cláusula"
  },
  "saved": "Configurações salvas."
}
```

Modify `client/src/i18n.ts` — add the import and register it in the `pt-BR` resources bundle:

```ts
import settings from './locales/pt-BR/settings.json'
```

```ts
    'pt-BR': { common, auth, setup, dashboard, clients, products, allocations, calendarScreen, settings },
```

Create `client/src/features/settings/SettingsPage.tsx`. `phone` is a masked, controlled field, so it's driven through `Controller` the same way `ClientDrawer`/`NewAllocationForm` already drive their masked inputs; the plain `textarea` clause rows use `register` directly:

```tsx
import { useEffect } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { PhoneInput } from '../../components/ui/phone-input.tsx'
import { showErrorToast, showSuccessToast } from '../../lib/toast.ts'
import { locationSettingsSchema, type LocationSettingsFormValues } from './settingsSchemas.ts'
import { useLocationSettings, useUpdateLocationSettings } from './useLocationSettings.ts'

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { data: settings, isLoading } = useLocationSettings()
  const updateSettings = useUpdateLocationSettings()

  const { handleSubmit, control, register, reset } = useForm<LocationSettingsFormValues>({
    resolver: zodResolver(locationSettingsSchema),
    defaultValues: { phone: '', clauses: [] },
  })

  useEffect(() => {
    if (settings) {
      reset({
        phone: settings.phone ?? '',
        clauses: settings.clauses.map((clause) => ({ text: clause.text })),
      })
    }
  }, [settings, reset])

  const clauses = useFieldArray({ control, name: 'clauses' })

  async function onSubmit(values: LocationSettingsFormValues) {
    try {
      await updateSettings.mutateAsync(values)
      showSuccessToast(t('saved'))
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showErrorToast(t(`common:errors.${code}`, { ns: 'common', defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
    }
  }

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">{t('title')}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          {t('fields.phone')}
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneInput value={field.value} onChange={field.onChange} aria-label={t('fields.phone')} />
            )}
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('clauses.title')}</span>
          {clauses.fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <textarea
                {...register(`clauses.${index}.text`)}
                aria-label={t('clauses.textFieldAria')}
                rows={2}
                className="h-auto min-h-[3.5rem] w-full rounded-md border border-border-soft bg-white px-3 py-2 text-sm text-ink transition-colors hover:border-brand-300 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => clauses.remove(index)}
                aria-label={t('clauses.remove')}
              >
                <X size={16} />
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => clauses.append({ text: '' })}>
            {t('clauses.add')}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={updateSettings.isPending}>
            {t('common:actions.save', { ns: 'common' })}
          </Button>
        </div>
      </form>
    </div>
  )
}
```

`showSuccessToast` — check `client/src/lib/toast.ts` first: if it only currently exports `showErrorToast`, add a matching `showSuccessToast(message: string)` there (mirror `showErrorToast`'s implementation, swapping to whatever the underlying toast library's success/default variant is) as part of this step, since this is the first feature needing a positive-confirmation toast.

Modify `client/src/app/router.tsx` — add the import and a new protected route:

```tsx
import { SettingsPage } from '../features/settings/SettingsPage.tsx'
```

```tsx
          <Route path="/configuracoes" element={<SettingsPage />} />
```

(placed as a sibling of the other protected routes inside `<Route element={<AppLayout />}>`).

Modify `client/src/app/Sidebar.tsx` — add the icon import and a new nav entry, at the end of the `links` array (after `/calendario`):

```tsx
import { LayoutDashboard, Users, Shirt, ClipboardList, Calendar, Settings } from 'lucide-react'
```

```tsx
const links = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/clientes', labelKey: 'nav.clients', icon: Users },
  { to: '/produtos', labelKey: 'nav.products', icon: Shirt },
  { to: '/alocacoes', labelKey: 'nav.allocations', icon: ClipboardList },
  { to: '/calendario', labelKey: 'nav.calendar', icon: Calendar },
  { to: '/configuracoes', labelKey: 'nav.settings', icon: Settings },
]
```

Add the new nav label key to `client/src/locales/pt-BR/common.json`'s existing `nav` object: `"settings": "Configurações"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/features/settings/SettingsPage.test.tsx`
Expected: PASS — all 4 tests.

Then run the full client suite (router/Sidebar were touched, and `AllocationsPage`'s route is still `/alocacoes` at this point in the plan — Task 8 is what points it at `ContractsPage`):

Run: `cd client && npx vitest run`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/settings client/src/locales/pt-BR/settings.json client/src/locales/pt-BR/common.json client/src/i18n.ts client/src/app/router.tsx client/src/app/Sidebar.tsx client/src/lib/toast.ts
git commit -m "feat: add location settings page (phone + contract clauses)"
```

---

### Task 4: Contract client-side schemas and hooks

**Files:**
- Create: `client/src/features/contracts/contractSchemas.ts`
- Create: `client/src/features/contracts/contractSchemas.test.ts`
- Create: `client/src/features/contracts/useContracts.ts`

**Interfaces:**
- Consumes: nothing new (mirrors `server/src/services/contractService.ts`'s `CreateContractInput`/`Contract` shapes and `client/src/features/allocations/useAllocations.ts`'s hook pattern).
- Produces: `newContractSchema`/`NewContractFormValues`, `Contract`/`ContractAllocation`/`ContractInstallment` types, `useContractsList()`, `useCreateContract()`, `useCancelContract()`. Consumed by Tasks 5–7.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/contracts/contractSchemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { newContractSchema } from './contractSchemas.ts'

describe('newContractSchema', () => {
  it('accepts a valid multi-item contract with installments', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [
        { productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 },
        { productId: 'p2', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 150 },
      ],
      installments: [{ dueDate: '2026-09-20', amount: 125 }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts zero installments', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a contract with no items', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: 'client1',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [],
      installments: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing clientId', () => {
    const result = newContractSchema.safeParse({
      locationId: 'loc1',
      clientId: '',
      eventDate: '2026-10-03',
      paymentMethod: 'PIX',
      items: [{ productId: 'p1', checkoutDate: '2026-10-02', dueDate: '2026-10-05', priceCharged: 100 }],
      installments: [],
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/features/contracts/contractSchemas.test.ts`
Expected: FAIL — `contractSchemas.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/features/contracts/contractSchemas.ts`:

```ts
import { z } from 'zod'

export const contractItemSchema = z.object({
  productId: z.string().min(1),
  checkoutDate: z.string().min(1),
  dueDate: z.string().min(1),
  priceCharged: z.number().nonnegative(),
})

export const contractInstallmentSchema = z.object({
  dueDate: z.string().min(1),
  amount: z.number().nonnegative(),
})

export const newContractSchema = z.object({
  locationId: z.string().min(1),
  clientId: z.string().min(1),
  eventDate: z.string().min(1),
  paymentMethod: z.string().min(1),
  items: z.array(contractItemSchema).min(1),
  installments: z.array(contractInstallmentSchema),
})

export type NewContractFormValues = z.infer<typeof newContractSchema>

export type ContractSignatureStatus = 'unsigned' | 'signed'
export type ContractAllocationStatus = 'reserved' | 'checked_out' | 'returned' | 'cancelled'

export interface ContractAllocation {
  id: string
  productId: string
  clientId: string
  staffId: string
  contractId: string
  checkoutDate: string
  dueDate: string
  actualReturnDate: string | null
  status: ContractAllocationStatus
  priceCharged: number
  depositCollected: number | null
  depositReturned: number | null
  conditionNotesOut: string | null
  conditionNotesIn: string | null
  createdAt: string
}

export interface ContractInstallment {
  id: string
  contractId: string
  dueDate: string
  amount: number
  paid: boolean
  paidAt: string | null
}

export interface Contract {
  id: string
  number: number
  locationId: string
  clientId: string
  staffId: string
  eventDate: string
  paymentMethod: string
  signatureStatus: ContractSignatureStatus
  signatureImage: string | null
  signedAt: string | null
  createdAt: string
  allocations: ContractAllocation[]
  installments: ContractInstallment[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/features/contracts/contractSchemas.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Write the hooks (no separate test file — mirrors `useAllocations.ts`, which is likewise only exercised indirectly through the pages that use it)**

Create `client/src/features/contracts/useContracts.ts`:

```ts
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Contract, NewContractFormValues } from './contractSchemas.ts'

const CONTRACTS_KEY = ['contracts']

export function useContractsList() {
  return useQuery({
    queryKey: CONTRACTS_KEY,
    queryFn: () => apiFetch<Contract[]>('/api/contracts'),
  })
}

function invalidateAfterMutation(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY })
  queryClient.invalidateQueries({ queryKey: ['calendar'] })
  queryClient.invalidateQueries({ queryKey: ['products'] })
}

export function useCreateContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: NewContractFormValues) =>
      apiFetch<Contract>('/api/contracts', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useCancelContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/contracts/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}
```

- [ ] **Step 6: Type-check**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/contracts/contractSchemas.ts client/src/features/contracts/contractSchemas.test.ts client/src/features/contracts/useContracts.ts
git commit -m "feat: add client-side contract schemas and hooks"
```

---

### Task 5: Client-readiness check + `NewContractForm` (client, event date, items)

**Files:**
- Create: `client/src/lib/clientReadiness.ts`
- Create: `client/src/lib/clientReadiness.test.ts`
- Create: `client/src/features/contracts/NewContractForm.tsx`
- Create: `client/src/features/contracts/NewContractForm.test.tsx`
- Create: `client/src/locales/pt-BR/contracts.json`
- Modify: `client/src/i18n.ts`

**Interfaces:**
- Consumes: `getClientFieldTemplate` (Plan 2, `client/src/lib/clientFieldTemplates.ts`); `Client` type (Plan 2, `client/src/features/clients/clientSchemas.ts`); `ClientDrawer` (Plan 2, reused as-is for completing missing client fields); `useClients` (existing); `useProducts` (existing); `useProductAvailability` (existing, `client/src/features/allocations/useAllocations.ts` — unaffected by this plan's later removal of allocation *creation*, since availability stays a live endpoint); `useLocale` (locale-plumbing plan); `newContractSchema`/`NewContractFormValues` (Task 4).
- Produces: `getMissingRequiredFields(client: Client, locale: string | undefined): string[]`. `NewContractForm`'s client-selection, event-date, and line-items sections (payment/installments/submit complete in Task 6 — this task's version is not yet wired to `useCreateContract`, since there's no valid payload without a payment method; Task 6 finishes `onSubmit`).

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/clientReadiness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getMissingRequiredFields } from './clientReadiness.ts'
import type { Client } from '../features/clients/clientSchemas.ts'

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    name: 'Maria',
    phone: '1',
    email: 'a@example.com',
    notes: '',
    identityDocuments: [],
    addressLines: [],
    hasAllocationHistory: false,
    createdAt: '2026-01-01',
    ...overrides,
  }
}

describe('getMissingRequiredFields', () => {
  it('lists every required pt-BR field when the client has none of them', () => {
    const missing = getMissingRequiredFields(makeClient(), 'pt-BR')
    expect(missing).toEqual(['CPF', 'RG', 'Endereço', 'Bairro', 'Cidade', 'Estado'])
  })

  it('excludes fields that are present with a non-empty value', () => {
    const client = makeClient({
      identityDocuments: [
        { id: 'd1', label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' },
        { id: 'd2', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' },
      ],
      addressLines: [
        { id: 'a1', label: 'Endereço', value: 'Rua X, 1', sortOrder: 0, maskKey: null },
      ],
    })
    expect(getMissingRequiredFields(client, 'pt-BR')).toEqual(['Bairro', 'Cidade', 'Estado'])
  })

  it('still counts a field as missing when the row exists but its value is blank', () => {
    const client = makeClient({
      identityDocuments: [{ id: 'd1', label: 'CPF', value: '', maskKey: 'br-cpf' }],
    })
    expect(getMissingRequiredFields(client, 'pt-BR')).toContain('CPF')
  })

  it('returns an empty list when every required field is present and filled', () => {
    const client = makeClient({
      identityDocuments: [
        { id: 'd1', label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' },
        { id: 'd2', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' },
      ],
      addressLines: [
        { id: 'a1', label: 'Endereço', value: 'Rua X, 1', sortOrder: 0, maskKey: null },
        { id: 'a2', label: 'Bairro', value: 'Centro', sortOrder: 1, maskKey: null },
        { id: 'a3', label: 'Cidade', value: 'Piedade', sortOrder: 2, maskKey: null },
        { id: 'a4', label: 'Estado', value: 'SP', sortOrder: 3, maskKey: null },
      ],
    })
    expect(getMissingRequiredFields(client, 'pt-BR')).toEqual([])
  })
})
```

Create `client/src/features/contracts/NewContractForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { NewContractForm } from './NewContractForm.tsx'
import * as useClientsModule from '../clients/useClients.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useAllocationsModule from '../allocations/useAllocations.ts'
import * as useContractsModule from './useContracts.ts'
import { Toaster } from '../../components/ui/sonner.tsx'
import type { Client } from '../clients/clientSchemas.ts'

const readyClient: Client = {
  id: 'c1', name: 'Maria Completa', phone: '11999999999', email: 'm@example.com', notes: '',
  identityDocuments: [
    { id: 'd1', label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' },
    { id: 'd2', label: 'RG', value: '12.345.678-9', maskKey: 'br-rg' },
  ],
  addressLines: [
    { id: 'a1', label: 'Endereço', value: 'Rua X, 1', sortOrder: 0, maskKey: null },
    { id: 'a2', label: 'Bairro', value: 'Centro', sortOrder: 1, maskKey: null },
    { id: 'a3', label: 'Cidade', value: 'Piedade', sortOrder: 2, maskKey: null },
    { id: 'a4', label: 'Estado', value: 'SP', sortOrder: 3, maskKey: null },
  ],
  hasAllocationHistory: false, createdAt: '2026-01-01',
}

const incompleteClient: Client = {
  id: 'c2', name: 'Joana Incompleta', phone: '11988888888', email: 'j@example.com', notes: '',
  identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-01-01',
}

const product = {
  id: 'p1', locationId: 'loc1', name: 'Vestido Azul', description: '', category: 'festa', size: 'M',
  color: 'azul', rentalPrice: 100, depositAmount: 50, photos: [], status: 'active' as const,
  createdAt: '2026-01-01', availability: 'available' as const, hasAllocationHistory: false,
}

function renderWithToast(ui: React.ReactElement) {
  return render(<>{ui}<Toaster /></>)
}

function mockHooks() {
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [readyClient, incompleteClient] } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product] } as never)
  vi.spyOn(useAllocationsModule, 'useProductAvailability').mockReturnValue({ data: { available: true } } as never)
  vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
}

describe('NewContractForm', () => {
  it('shows no missing-fields warning for a client with every required field filled', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c1')
    expect(screen.queryByText(/CPF, RG/)).not.toBeInTheDocument()
  })

  it('shows a missing-fields warning with a completion button for an incomplete client', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c2')
    expect(screen.getByRole('button', { name: /completar cadastro/i })).toBeInTheDocument()
  })

  it('opens ClientDrawer for the selected client when "complete registration" is clicked', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c2')
    await userEvent.click(screen.getByRole('button', { name: /completar cadastro/i }))
    expect(screen.getByDisplayValue('Joana Incompleta')).toBeInTheDocument()
  })

  it('lets staff add a second line item', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar peça/i }))
    expect(screen.getAllByLabelText(/produto/i)).toHaveLength(2)
  })

  it('lets staff remove a line item', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar peça/i }))
    const removeButtons = screen.getAllByRole('button', { name: /remover peça/i })
    await userEvent.click(removeButtons[0])
    expect(screen.getAllByLabelText(/produto/i)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/lib/clientReadiness.test.ts src/features/contracts/NewContractForm.test.tsx`
Expected: FAIL — neither `clientReadiness.ts` nor `NewContractForm.tsx` exists yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/clientReadiness.ts`. Required-field matching is done by **label text** (case-insensitive), not `maskKey` — see this plan's Global Constraints for why:

```ts
import type { Client } from '../features/clients/clientSchemas.ts'
import { getClientFieldTemplate } from './clientFieldTemplates.ts'

export function getMissingRequiredFields(client: Client, locale: string | undefined): string[] {
  const template = getClientFieldTemplate(locale)
  const missing: string[] = []

  for (const entry of template.identityDocuments) {
    if (!entry.required) continue
    const match = client.identityDocuments.find(
      (doc) => doc.label.toLowerCase() === entry.label.toLowerCase(),
    )
    if (!match || match.value.trim() === '') missing.push(entry.label)
  }

  for (const entry of template.addressLines) {
    if (!entry.required) continue
    const match = client.addressLines.find(
      (line) => line.label.toLowerCase() === entry.label.toLowerCase(),
    )
    if (!match || match.value.trim() === '') missing.push(entry.label)
  }

  return missing
}
```

Create `client/src/locales/pt-BR/contracts.json`:

```json
{
  "newContract": "Novo Contrato",
  "fields": {
    "client": "Cliente",
    "eventDate": "Data do Evento",
    "product": "Produto",
    "checkoutDate": "Retirada",
    "dueDate": "Devolução",
    "priceCharged": "Valor"
  },
  "items": {
    "title": "Peças",
    "add": "Adicionar peça",
    "remove": "Remover peça"
  },
  "clientReadiness": {
    "missing": "Faltam campos obrigatórios: {{fields}}",
    "complete": "Completar cadastro"
  },
  "validation": {
    "clientRequired": "Cliente é obrigatório",
    "eventDateRequired": "Data do evento é obrigatória"
  },
  "unavailableProduct": "Este produto não está disponível para essas datas."
}
```

Modify `client/src/i18n.ts` — add the import and register it:

```ts
import contracts from './locales/pt-BR/contracts.json'
```

```ts
    'pt-BR': { common, auth, setup, dashboard, clients, products, allocations, calendarScreen, settings, contracts },
```

Create `client/src/features/contracts/NewContractForm.tsx`:

```tsx
import { useState } from 'react'
import { useForm, Controller, useFieldArray, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { DateInput } from '../../components/ui/date-input.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { getMissingRequiredFields } from '../../lib/clientReadiness.ts'
import { useClients } from '../clients/useClients.ts'
import { ClientDrawer } from '../clients/ClientDrawer.tsx'
import type { Client } from '../clients/clientSchemas.ts'
import { useProducts } from '../products/useProducts.ts'
import { useProductAvailability } from '../allocations/useAllocations.ts'
import { newContractSchema, type NewContractFormValues } from './contractSchemas.ts'
import { useCreateContract } from './useContracts.ts'

function ItemRow({
  index,
  control,
  register,
  activeProducts,
  onRemove,
  showRemove,
}: {
  index: number
  control: ReturnType<typeof useForm<NewContractFormValues>>['control']
  register: ReturnType<typeof useForm<NewContractFormValues>>['register']
  activeProducts: { id: string; name: string }[]
  onRemove: () => void
  showRemove: boolean
}) {
  const { t } = useTranslation('contracts')
  const productId = useWatchField(control, `items.${index}.productId`)
  const checkoutDate = useWatchField(control, `items.${index}.checkoutDate`)
  const dueDate = useWatchField(control, `items.${index}.dueDate`)
  const availability = useProductAvailability(productId, checkoutDate, dueDate)

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-soft p-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.product')}
          <select
            {...register(`items.${index}.productId`)}
            aria-label={t('fields.product')}
            className="h-10 rounded-md border border-border-soft px-2"
          >
            <option value="">—</option>
            {activeProducts.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </label>
        {showRemove && (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={t('items.remove')}>
            <X size={16} />
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.checkoutDate')}
          <Controller
            name={`items.${index}.checkoutDate`}
            control={control}
            render={({ field }) => (
              <DateInput value={field.value} onChange={field.onChange} aria-label={t('fields.checkoutDate')} />
            )}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('fields.dueDate')}
          <Controller
            name={`items.${index}.dueDate`}
            control={control}
            render={({ field }) => (
              <DateInput value={field.value} onChange={field.onChange} aria-label={t('fields.dueDate')} />
            )}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {t('fields.priceCharged')}
        <Controller
          name={`items.${index}.priceCharged`}
          control={control}
          render={({ field }) => (
            <CurrencyInput value={field.value} onChange={field.onChange} aria-label={t('fields.priceCharged')} />
          )}
        />
      </label>
      {productId && checkoutDate && dueDate && availability.data?.available === false && (
        <span className="text-xs text-red-600">{t('unavailableProduct')}</span>
      )}
    </div>
  )
}

function useWatchField(control: ReturnType<typeof useForm<NewContractFormValues>>['control'], name: string) {
  return useWatch({ control, name }) as string
}

export function NewContractForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const { data: clients } = useClients()
  const { data: products } = useProducts()
  const createContract = useCreateContract()
  const [completingClient, setCompletingClient] = useState<Client | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<NewContractFormValues>({
    resolver: zodResolver(newContractSchema),
    defaultValues: {
      locationId: '',
      clientId: '',
      eventDate: '',
      paymentMethod: '',
      items: [{ productId: '', checkoutDate: '', dueDate: '', priceCharged: 0 }],
      installments: [],
    },
  })

  const items = useFieldArray({ control, name: 'items' })
  const selectedClientId = watch('clientId')
  const selectedClient = clients?.find((client) => client.id === selectedClientId) ?? null
  const missingFields = selectedClient ? getMissingRequiredFields(selectedClient, locale) : []

  async function onSubmit(values: NewContractFormValues) {
    try {
      await createContract.mutateAsync(values)
      onClose()
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showErrorToast(t(`errors.${code}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) }))
    }
  }

  const activeProducts = products?.filter((product) => product.status === 'active') ?? []

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40 opacity-100 transition-opacity duration-200 starting:opacity-0" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 w-[36rem] translate-x-0 overflow-y-auto border-l border-border-soft bg-white p-4 shadow-lg transition-transform duration-200 ease-out starting:translate-x-full">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.client')}
            <select {...register('clientId')} aria-label={t('fields.client')} className="h-10 rounded-md border border-border-soft px-2">
              <option value="">—</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            {errors.clientId && <span className="text-xs text-red-600">{t('validation.clientRequired')}</span>}
          </label>
          {selectedClient && missingFields.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
              <span>{t('clientReadiness.missing', { fields: missingFields.join(', ') })}</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setCompletingClient(selectedClient)}>
                {t('clientReadiness.complete')}
              </Button>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.eventDate')}
            <Controller
              name="eventDate"
              control={control}
              render={({ field }) => (
                <DateInput value={field.value} onChange={field.onChange} aria-label={t('fields.eventDate')} />
              )}
            />
            {errors.eventDate && <span className="text-xs text-red-600">{t('validation.eventDateRequired')}</span>}
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('items.title')}</span>
            {items.fields.map((field, index) => (
              <ItemRow
                key={field.id}
                index={index}
                control={control}
                register={register}
                activeProducts={activeProducts}
                onRemove={() => items.remove(index)}
                showRemove={items.fields.length > 1}
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => items.append({ productId: '', checkoutDate: '', dueDate: '', priceCharged: 0 })}
            >
              {t('items.add')}
            </Button>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common:actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={createContract.isPending}>
              {t('common:actions.save', { ns: 'common' })}
            </Button>
          </div>
        </form>
      </div>
      {completingClient && <ClientDrawer client={completingClient} onClose={() => setCompletingClient(null)} />}
    </>
  )
}
```

This task's version of `onSubmit`/the submit button intentionally omits `paymentMethod`/`installments` UI — the form's `defaultValues` already includes empty values for both so `newContractSchema` can still validate structurally, but `paymentMethod: ''` will always fail the schema's `.min(1)` until Task 6 adds the field. Submitting in this task's state is expected to show a validation-blocked, non-functional save button; Task 6 completes it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/lib/clientReadiness.test.ts src/features/contracts/NewContractForm.test.tsx`
Expected: PASS — all 9 tests (4 + 5).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/clientReadiness.ts client/src/lib/clientReadiness.test.ts client/src/features/contracts/NewContractForm.tsx client/src/features/contracts/NewContractForm.test.tsx client/src/locales/pt-BR/contracts.json client/src/i18n.ts
git commit -m "feat: add NewContractForm client/event/items sections and client-readiness check"
```

---

### Task 6: `NewContractForm` — payment method and installments

**Files:**
- Modify: `client/src/features/contracts/NewContractForm.tsx`
- Modify: `client/src/features/contracts/NewContractForm.test.tsx`
- Modify: `client/src/locales/pt-BR/contracts.json`

**Interfaces:**
- Consumes: `getPaymentMethods` (Task 1).
- Produces: a completed, submittable `NewContractForm` — payment method select + installment rows (date + amount, add/remove), wired into the existing `onSubmit`.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/features/contracts/NewContractForm.test.tsx`, inside the existing `describe('NewContractForm', ...)` block:

```tsx
  it('lets staff add and remove installment rows', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /adicionar parcela/i }))
    expect(screen.getAllByLabelText(/valor da parcela/i)).toHaveLength(1)
    const removeButtons = screen.getAllByRole('button', { name: /remover parcela/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryAllByLabelText(/valor da parcela/i)).toHaveLength(0)
  })

  it('submits the full payload including payment method and installments', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    mockHooks()
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c1')
    await userEvent.type(screen.getByLabelText(/data do evento/i), '03102026')
    await userEvent.selectOptions(screen.getByLabelText(/produto/i), 'p1')
    await userEvent.type(screen.getByLabelText(/retirada/i), '02102026')
    await userEvent.type(screen.getByLabelText(/devolução/i), '05102026')
    await userEvent.selectOptions(screen.getByLabelText(/forma de pagamento/i), 'PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].paymentMethod).toBe('PIX')
    expect(createImpl.mock.calls[0][0].clientId).toBe('c1')
    expect(onClose).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/features/contracts/NewContractForm.test.tsx`
Expected: FAIL — no payment method / installment UI exists yet, so the new selectors can't be found and the full submit produces a validation error instead of calling `createImpl`.

- [ ] **Step 3: Write minimal implementation**

In `client/src/features/contracts/NewContractForm.tsx`, add the import:

```tsx
import { getPaymentMethods } from '../../lib/paymentMethodTemplate.ts'
```

Add the `installments` field array next to the existing `items` one:

```tsx
  const items = useFieldArray({ control, name: 'items' })
  const installments = useFieldArray({ control, name: 'installments' })
```

Add `const paymentMethods = getPaymentMethods(locale)` next to `const activeProducts = ...`.

Insert the payment method and installments sections into the JSX, between the closing `</div>` of the items section and the final action-buttons `<div className="mt-2 flex justify-end gap-2">`:

```tsx
          <label className="flex flex-col gap-1 text-sm">
            {t('fields.paymentMethod')}
            <select
              {...register('paymentMethod')}
              aria-label={t('fields.paymentMethod')}
              className="h-10 rounded-md border border-border-soft px-2"
            >
              <option value="">—</option>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
            {errors.paymentMethod && <span className="text-xs text-red-600">{t('validation.paymentMethodRequired')}</span>}
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('installments.title')}</span>
            {installments.fields.map((field, index) => (
              <div key={field.id} className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  {t('fields.installmentDueDate')}
                  <Controller
                    name={`installments.${index}.dueDate`}
                    control={control}
                    render={({ field: dateField }) => (
                      <DateInput value={dateField.value} onChange={dateField.onChange} aria-label={t('fields.installmentDueDate')} />
                    )}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  {t('fields.installmentAmount')}
                  <Controller
                    name={`installments.${index}.amount`}
                    control={control}
                    render={({ field: amountField }) => (
                      <CurrencyInput value={amountField.value} onChange={amountField.onChange} aria-label={t('fields.installmentAmount')} />
                    )}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => installments.remove(index)}
                  aria-label={t('installments.remove')}
                >
                  <X size={16} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => installments.append({ dueDate: '', amount: 0 })}
            >
              {t('installments.add')}
            </Button>
          </div>
```

Update `client/src/locales/pt-BR/contracts.json`, merging these keys into the existing object (add `paymentMethod`/`installmentDueDate`/`installmentAmount` to `fields`, add `paymentMethodRequired` to `validation`, add a new top-level `installments` object):

```json
  "fields": {
    "client": "Cliente",
    "eventDate": "Data do Evento",
    "product": "Produto",
    "checkoutDate": "Retirada",
    "dueDate": "Devolução",
    "priceCharged": "Valor",
    "paymentMethod": "Forma de Pagamento",
    "installmentDueDate": "Vencimento da Parcela",
    "installmentAmount": "Valor da Parcela"
  },
  "installments": {
    "title": "Parcelas",
    "add": "Adicionar parcela",
    "remove": "Remover parcela"
  },
```

(merge `paymentMethodRequired` into the existing `validation` object as `"paymentMethodRequired": "Forma de pagamento é obrigatória"`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/features/contracts/NewContractForm.test.tsx`
Expected: PASS — all 7 tests.

Then run the full client suite and type-check, since this completes the form:

Run: `cd client && npx vitest run`
Run: `cd client && npx tsc --noEmit`
Expected: both PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/contracts/NewContractForm.tsx client/src/features/contracts/NewContractForm.test.tsx client/src/locales/pt-BR/contracts.json
git commit -m "feat: complete NewContractForm with payment method and installments"
```

---

### Task 7: `ContractsPage`

**Files:**
- Create: `client/src/features/contracts/ContractsPage.tsx`
- Create: `client/src/features/contracts/ContractsPage.test.tsx`
- Modify: `client/src/locales/pt-BR/contracts.json`

**Interfaces:**
- Consumes: `useContractsList`, `useCancelContract` (Task 4); `RowActions` — read `client/src/features/allocations/AllocationsPage.tsx`'s current `RowActions` component first and reuse it unchanged by importing it (export it from `AllocationsPage.tsx` if it isn't already exported — check before assuming); `useClients`, `useProducts` (existing); `useLocale`, `formatDate`, `parseDateOnly` (locale-plumbing plan).
- Produces: `ContractsPage` — lists Contracts (newest first), each showing its client, event date, contract number, and its line items with the existing per-item `RowActions`.

- [ ] **Step 1: Write the failing test**

Create `client/src/features/contracts/ContractsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ContractsPage } from './ContractsPage.tsx'
import * as useContractsModule from './useContracts.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useClientsModule from '../clients/useClients.ts'
import type { Contract } from './contractSchemas.ts'

const contract: Contract = {
  id: 'ct1', number: 3, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  allocations: [
    {
      id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
      checkoutDate: '2026-10-02', dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
    },
  ],
  installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-09-20', amount: 380, paid: false, paidAt: null }],
}

function mockHooks() {
  vi.spyOn(useContractsModule, 'useContractsList').mockReturnValue({ data: [contract], isLoading: false } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [{ id: 'p1', name: 'Vestido Azul' }] } as never)
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [{ id: 'c1', name: 'Maria' }] } as never)
}

describe('ContractsPage', () => {
  it('shows the contract number, client, and its line item', () => {
    mockHooks()
    render(<ContractsPage />)
    expect(screen.getByText(/#3/)).toBeInTheDocument()
    expect(screen.getByText('Maria')).toBeInTheDocument()
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
  })

  it('shows the New Contract button and opens the form', async () => {
    mockHooks()
    render(<ContractsPage />)
    await userEvent.click(screen.getByRole('button', { name: /novo contrato/i }))
    expect(screen.getByLabelText(/cliente/i)).toBeInTheDocument()
  })

  it('shows the reserved item\'s check-out action', () => {
    mockHooks()
    render(<ContractsPage />)
    expect(screen.getByRole('button', { name: 'Check-out' })).toBeInTheDocument()
  })
})
```

(Confirm the exact `actions.checkOut` translation string in `client/src/locales/pt-BR/allocations.json` before finalizing the last assertion above — use whatever it actually says, rather than assuming "Check-out" verbatim.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/features/contracts/ContractsPage.test.tsx`
Expected: FAIL — `ContractsPage.tsx` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

First, check whether `RowActions` in `client/src/features/allocations/AllocationsPage.tsx` is exported. If it's declared as a private `function RowActions(...)` without `export`, add `export` to its declaration — this is the only change needed in that file for this task; do not otherwise modify `AllocationsPage.tsx` here (Task 8 replaces its role entirely).

Add to `client/src/locales/pt-BR/contracts.json` (merge into the existing object):

```json
  "title": "Contratos",
  "newContract": "Novo Contrato",
  "empty": "Nenhum contrato cadastrado ainda.",
```

(the `newContract` key already exists from Task 5 — keep it, just add `title` and `empty` alongside it.)

Create `client/src/features/contracts/ContractsPage.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { RowActions } from '../allocations/AllocationsPage.tsx'
import { useContractsList } from './useContracts.ts'
import { NewContractForm } from './NewContractForm.tsx'

export function ContractsPage() {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const { data: contracts, isLoading } = useContractsList()
  const { data: products } = useProducts()
  const { data: clients } = useClients()
  const [showForm, setShowForm] = useState(false)

  const productNames = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product.name])),
    [products],
  )
  const clientNames = useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name])),
    [clients],
  )

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setShowForm(true)}>{t('newContract')}</Button>
      </div>
      {contracts && contracts.length === 0 && <p className="text-muted-text">{t('empty')}</p>}
      <div className="flex flex-col gap-3">
        {contracts?.map((contract) => (
          <div key={contract.id} className="rounded-md border border-border-soft p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-medium">
                  #{contract.number} — {clientNames.get(contract.clientId) ?? contract.clientId}
                </span>
                <span className="text-xs text-muted-text">
                  {formatDate(parseDateOnly(contract.eventDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {contract.allocations.map((allocation) => (
                <div
                  key={allocation.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-soft p-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">
                      {productNames.get(allocation.productId) ?? allocation.productId}
                    </span>
                    <span className="text-xs text-muted-text">
                      {formatDate(parseDateOnly(allocation.checkoutDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })} –{' '}
                      {formatDate(parseDateOnly(allocation.dueDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="shrink-0">
                    <RowActions allocation={allocation} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {showForm && <NewContractForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
```

`RowActions` expects an `Allocation` (from `client/src/features/allocations/allocationSchemas.ts`) with a `status` union that must match `ContractAllocation`'s `status` field exactly (`'reserved' | 'checked_out' | 'returned' | 'cancelled'`) — it already does, per Task 4's `contractSchemas.ts`, so no adapter is needed between `ContractAllocation` and the `Allocation` type `RowActions` was written against. If TypeScript flags a structural mismatch when this compiles, the two types have drifted and need reconciling — check the diff between `allocationSchemas.ts`'s `Allocation` and `contractSchemas.ts`'s `ContractAllocation` field-by-field before adding an adapter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/features/contracts/ContractsPage.test.tsx`
Expected: PASS — all 3 tests.

Run: `cd client && npx tsc --noEmit`
Expected: no errors (this specifically verifies the `RowActions`/`ContractAllocation` type compatibility called out above).

- [ ] **Step 5: Commit**

```bash
git add client/src/features/contracts/ContractsPage.tsx client/src/features/contracts/ContractsPage.test.tsx client/src/features/allocations/AllocationsPage.tsx client/src/locales/pt-BR/contracts.json
git commit -m "feat: add ContractsPage"
```

---

### Task 8: Retire the standalone allocation-creation path

**Files:**
- Delete: `client/src/features/allocations/NewAllocationForm.tsx`, `client/src/features/allocations/NewAllocationForm.test.tsx`
- Modify: `client/src/features/allocations/AllocationsPage.tsx` (or delete it — see Step 1)
- Modify: `client/src/app/router.tsx`
- Modify: `client/src/app/Sidebar.tsx`
- Modify: `server/src/routes/allocations.ts`
- Modify: `server/tests/integration/happyPath.test.ts`

**Interfaces:**
- Consumes: `ContractsPage` (Task 7).
- Produces: `/alocacoes` route and "Alocações" nav entry replaced by `/contratos`/"Contratos" pointing at `ContractsPage`; `POST /api/allocations` removed (GET, check-out, return, cancel, availability endpoints unchanged); `createAllocation`/`useCreateAllocation` become dead code, removed.

This is the task that closes the gap Plan 3's final review flagged: after this task, the only way to create an Allocation is through `POST /api/contracts`, so "every Allocation has a Contract" becomes a live invariant, not just a boot-restored one.

- [ ] **Step 1: Decide `AllocationsPage.tsx`'s fate and act on it**

`ContractsPage` (Task 7) fully replaces `AllocationsPage`'s user-facing role. Delete `client/src/features/allocations/AllocationsPage.tsx` and `client/src/features/allocations/AllocationsPage.test.tsx` — **but first**, re-check Task 7: if `RowActions` was exported *from* `AllocationsPage.tsx` (as Task 7 instructed), deleting this file breaks that import. Move `RowActions` (and its `resolveErrorCode`/`STATUS_TONE` helpers it depends on — read the current file to get the exact set) into `ContractsPage.tsx` itself as part of this step, then delete `AllocationsPage.tsx`/its test file, then update `ContractsPage.tsx`'s import of `RowActions` from `'../allocations/AllocationsPage.tsx'` to a local reference (no import needed, since it now lives in the same file).

- [ ] **Step 2: Delete `NewAllocationForm`**

```bash
rm client/src/features/allocations/NewAllocationForm.tsx client/src/features/allocations/NewAllocationForm.test.tsx
```

`useCreateAllocation` in `client/src/features/allocations/useAllocations.ts` is now unused — remove it (and its import of `NewAllocationFormValues` if nothing else in the file needs that type; check `allocationSchemas.ts` usage elsewhere before removing the type itself — `Allocation` and `AllocationStatus` are still used by `ContractsPage`'s `RowActions`, only `NewAllocationFormValues`/`newAllocationSchema` become dead).

- [ ] **Step 3: Remove `POST /` from the allocations route**

In `server/src/routes/allocations.ts`, remove the `createAllocation` import, the `createSchema` Zod object, and the `allocationsRouter.post('/', ...)` handler. Keep everything else (`GET /`, `check-out`, `return`, `cancel`, `products/:productId/availability`) exactly as they are.

- [ ] **Step 4: Remove `createAllocation` from `allocationService.ts` — or don't, and say why**

`allocationService.ts`'s `createAllocation` function becomes unused once Step 3 removes its only caller. Removing it is the correct default (dead code). But `allocationService.test.ts` has direct unit tests against `createAllocation` (real-DB, exercising the occupancy-check/retry logic) that are NOT redundant with `contractService.test.ts`'s tests — the two functions independently duplicate similar retry/occupancy logic (this predates this plan; `contractService.createContract` was written to mirror `createAllocation`, not replace it internally). Removing `createAllocation` and its tests here is safe (nothing calls it), but do it as an explicit, separate decision: delete the function from `allocationService.ts` and its corresponding tests from `allocationService.test.ts`, then re-run the full server suite to confirm nothing else referenced it.

- [ ] **Step 5: Point the router and sidebar at `ContractsPage`**

Modify `client/src/app/router.tsx` — replace the `AllocationsPage` import and route:

```tsx
import { ContractsPage } from '../features/contracts/ContractsPage.tsx'
```

```tsx
          <Route path="/contratos" element={<ContractsPage />} />
```

(remove the old `import { AllocationsPage } from '../features/allocations/AllocationsPage.tsx'` and the old `<Route path="/alocacoes" element={<AllocationsPage />} />`.)

Modify `client/src/app/Sidebar.tsx` — update the `links` array entry:

```tsx
  { to: '/contratos', labelKey: 'nav.contracts', icon: ClipboardList },
```

(replacing the old `{ to: '/alocacoes', labelKey: 'nav.allocations', icon: ClipboardList }` — same icon, new path and label key.)

Update `client/src/locales/pt-BR/common.json`'s `nav` object: replace `"allocations": "Alocações"` with `"contracts": "Contratos"`.

- [ ] **Step 6: Update the integration test**

In `server/tests/integration/happyPath.test.ts`, the allocation-creation step currently goes through `POST /api/allocations` directly. Read the current file (it's shown in full in this plan's exploration, reproduced here for reference — but re-read it live before editing, in case an earlier task's server-side changes touched it) and replace the allocation-creation section with a contract-creation call, adapting the rest of the flow (check-out/return/availability assertions) to operate on the resulting Contract's first Allocation:

```ts
    const contractResponse = await auth(request(app).post('/api/contracts')).send({
      locationId,
      clientId,
      eventDate: '2020-01-03',
      paymentMethod: 'PIX',
      items: [
        { productId, checkoutDate: '2020-01-01', dueDate: '2020-01-05', priceCharged: 350 },
      ],
      installments: [],
    })
    expect(contractResponse.status).toBe(201)
    const allocationId = contractResponse.body.allocations[0].id
```

Replace the `allocationResponse`/`allocationId` block with the above. The second-attempt double-booking check should now go through `POST /api/contracts` too, asserting the same `409`/`PRODUCT_UNAVAILABLE`:

```ts
    const secondAttempt = await auth(request(app).post('/api/contracts')).send({
      locationId,
      clientId,
      eventDate: '2020-01-04',
      paymentMethod: 'PIX',
      items: [
        { productId, checkoutDate: '2020-01-02', dueDate: '2020-01-06', priceCharged: 350 },
      ],
      installments: [],
    })
    expect(secondAttempt.status).toBe(409)
    expect(secondAttempt.body.code).toBe('PRODUCT_UNAVAILABLE')
```

The check-out/return/availability assertions after this stay exactly as they are — they operate on `allocationId`, which is unaffected by the switch from `POST /api/allocations` to `POST /api/contracts`.

- [ ] **Step 7: Run everything**

Run: `cd server && npx tsc --noEmit`
Run: `cd server && npm test`
Run: `cd client && npx tsc --noEmit`
Run: `cd client && npx vitest run`

Expected: all clean, all passing — this is the last task in the plan.

- [ ] **Step 8: Commit**

```bash
git add -A client/src/features/allocations client/src/features/contracts client/src/app/router.tsx client/src/app/Sidebar.tsx client/src/locales/pt-BR/common.json server/src/routes/allocations.ts server/src/services/allocationService.ts server/src/services/allocationService.test.ts server/tests/integration/happyPath.test.ts
git commit -m "feat: retire standalone allocation-creation path, Contract is now the sole booking entry point"
```

---

## Plan complete

After Task 8, Contract is the only way to book a rental — `NewAllocationForm` and standalone `POST /api/allocations` are gone, `ContractsPage` is the sidebar's primary entry, and the "every Allocation has a Contract" guarantee Plan 3 could only make boot-restored is now live and structural. Staff can also edit the shop's phone number and contract clause text from a new Settings page. This unblocks the next plan in the sequence (Print view), which renders a `Contract` — client info, line items, installment table, `Location.contractClauses` — into a printable document.
