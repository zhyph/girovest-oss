# Contract Print View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a printable version of a Contract — Location header, client info, line items, installment table, legal clauses, and a signature area — reachable from `ContractsPage`, printed via the browser's native print (Electron's Chromium `window.print()`), matching the paper "Contrato de Compromisso" field-for-field.

**Architecture:** A new `GET /api/contracts/:id` endpoint returns a Contract with everything the document needs already nested (client + its identity documents/address lines, location + its sorted clauses, each allocation's product). A new route `/contratos/:id/imprimir`, mounted as a sibling of `AppLayout` (so it renders full-page with no sidebar chrome), fetches that data and renders a pure presentational `ContractPrintView` component. "Imprimir" navigates here from each contract row in `ContractsPage`; a print-only-hidden toolbar offers "Imprimir" (`window.print()`) and "Voltar".

**Tech Stack:** Express + Prisma (server), React + react-router + TanStack Query + react-i18next (client), Tailwind `print:` variant for hiding the toolbar when printing. No new dependencies.

## Global Constraints

- Every field on the paper contract must appear on the printed document: Location name/address/phone, contract number, event date, client name/phone/email/identity documents/address lines, each line item's product/checkout date/due date/price, VALOR TOTAL, payment method, installments (date/amount/paid), legal clauses, signature area.
- VALOR TOTAL is derived as `sum(allocations.priceCharged)` at render time — never stored, never computed server-side into a persisted field.
- If a Contract is already signed (`signatureStatus: 'signed'`, `signatureImage` set — not possible yet until Plan 6, but the view must already handle it), the captured signature image renders into the same signature line a hand-signed copy would leave blank — one document shape either way, not two.
- Printing uses the browser's native print (`window.print()`) — no new dependency, no PDF library.
- No hardcoded `pt-BR`/`BRL` — all dates and currency amounts on the print view are formatted via the Contract's own `location.locale`, reusing `formatDate` (`client/src/lib/date.ts`) and a new `formatCurrency` helper, exactly like every other locale-driven surface in this app.
- Follow the codebase's existing per-layer test pattern: service tests, route coverage via the existing integration test, component tests with `MemoryRouter` + mocked hooks (see `ContractsPage.test.tsx`).

---

### Task 1: `getContract` service + `GET /api/contracts/:id` route

**Files:**
- Modify: `server/src/services/contractService.ts`
- Modify: `server/src/routes/contracts.ts`
- Test: `server/src/services/contractService.test.ts`
- Test: `server/tests/integration/happyPath.test.ts`

**Interfaces:**
- Consumes: nothing new — uses the existing `prisma` client (`../db/client.js`), `AppError`/`ErrorCodes` (already imported in `contractService.ts`).
- Produces: `getContract(id: string)` — returns the Contract with `allocations[].product` (full Product), `installments`, `client.identityDocuments`, `client.addressLines` (sorted by `sortOrder`), and `location.contractClauses` (sorted by `sortOrder`). Throws `AppError(ErrorCodes.NOT_FOUND, 404, ...)` if the Contract doesn't exist. Route: `GET /api/contracts/:id` → 200 with that JSON shape, or the thrown 404.

- [ ] **Step 1: Write the failing service tests**

Add to `server/src/services/contractService.test.ts`. First update the import line at the top of the file:

```ts
import { createContract, cancelContract, listContracts, getContract } from './contractService.js'
```

Then add this new `describe` block at the end of the file (after the existing `describe` blocks, same file, same `beforeEach`/`afterEach` fixtures already declared above):

```ts
describe('getContract', () => {
  it('returns the contract with nested client, location, and product details', async () => {
    await prisma.location.update({ where: { id: locationId }, data: { phone: '1199999999' } })
    await prisma.locationContractClause.createMany({
      data: [
        { locationId, sortOrder: 1, text: 'Clause two' },
        { locationId, sortOrder: 0, text: 'Clause one' },
      ],
    })
    await prisma.clientIdentityDocument.create({ data: { clientId, label: 'CPF', value: '123.456.789-00' } })
    await prisma.clientAddressLine.createMany({
      data: [
        { clientId, label: 'Cidade', value: 'São Paulo', sortOrder: 1 },
        { clientId, label: 'Endereço', value: 'Rua A, 100', sortOrder: 0 },
      ],
    })
    const created = await createContract(baseInput())

    const detail = await getContract(created.id)

    expect(detail.location.contractClauses.map((clause) => clause.text)).toEqual(['Clause one', 'Clause two'])
    expect(detail.client.addressLines.map((line) => line.label)).toEqual(['Endereço', 'Cidade'])
    expect(detail.client.identityDocuments[0]).toMatchObject({ label: 'CPF', value: '123.456.789-00' })
    expect(detail.allocations[0].product.name).toBe('Vestido')
    expect(detail.location.phone).toBe('1199999999')
  })

  it('throws NOT_FOUND for a missing contract', async () => {
    await expect(getContract('missing-id')).rejects.toThrow(AppError)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npx vitest run src/services/contractService.test.ts`
Expected: FAIL — `getContract is not a function` (or a TypeScript error on the import).

- [ ] **Step 3: Implement `getContract`**

Add to `server/src/services/contractService.ts`, after `listContracts`:

```ts
export async function getContract(id: string) {
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      allocations: { include: { product: true } },
      installments: true,
      client: { include: { identityDocuments: true, addressLines: true } },
      location: { include: { contractClauses: true } },
    },
  })
  if (!contract) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Contract ${id} not found`)
  }
  return {
    ...contract,
    client: {
      ...contract.client,
      addressLines: [...contract.client.addressLines].sort((a, b) => a.sortOrder - b.sortOrder),
    },
    location: {
      ...contract.location,
      contractClauses: [...contract.location.contractClauses].sort((a, b) => a.sortOrder - b.sortOrder),
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npx vitest run src/services/contractService.test.ts`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Add the route**

Modify `server/src/routes/contracts.ts` — update the import line:

```ts
import { createContract, cancelContract, listContracts, getContract } from '../services/contractService.js'
```

Add this route right after the existing `contractsRouter.get('/', ...)` handler:

```ts
contractsRouter.get('/:id', async (req, res) => {
  res.json(await getContract(req.params.id))
})
```

- [ ] **Step 6: Add an integration assertion**

Modify `server/tests/integration/happyPath.test.ts` — right after the existing block that creates the contract and reads `allocationId` (after the line `const allocationId = contractResponse.body.allocations[0].id`), insert:

```ts
    const contractDetailResponse = await auth(request(app).get(`/api/contracts/${contractResponse.body.id}`))
    expect(contractDetailResponse.status).toBe(200)
    expect(contractDetailResponse.body.client.name).toBe('Camila Souza')
    expect(contractDetailResponse.body.location.name).toBe('Loja Feliz')
    expect(contractDetailResponse.body.allocations[0].product.name).toBe('Vestido de Festa Dourado')
```

- [ ] **Step 7: Run the full server test suite**

Run: `cd server && npx vitest run`
Expected: PASS, all tests including `contractService.test.ts` and `tests/integration/happyPath.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/contractService.ts server/src/routes/contracts.ts server/src/services/contractService.test.ts server/tests/integration/happyPath.test.ts
git commit -m "feat: add GET /api/contracts/:id with nested client/location/product data"
```

---

### Task 2: `formatCurrency` helper + client-side `ContractDetail` types + `useContract` hook

**Files:**
- Modify: `client/src/lib/locale.ts`
- Test: `client/src/lib/locale.test.ts`
- Modify: `client/src/features/contracts/contractSchemas.ts`
- Modify: `client/src/features/contracts/useContracts.ts`

**Interfaces:**
- Consumes: `apiFetch` (`../../lib/api.ts`), `useQuery` (`@tanstack/react-query`), existing `Contract`/`ContractAllocation` types from `contractSchemas.ts` (Task 1's section).
- Produces: `formatCurrency(value: number, locale: string, currency: string): string` from `client/src/lib/locale.ts`. `ContractDetail` type (Contract + nested `client`, `location`, per-allocation `product`) and `useContract(id: string | undefined)` hook, both consumed by Task 3 and Task 4.

- [ ] **Step 1: Write the failing `formatCurrency` test**

Add to `client/src/lib/locale.test.ts`, inside the existing top-level `describe('getLocaleConfig', ...)` block is fine, but since this is a new independent function, add a new top-level `describe` block at the end of the file instead. First update the import line at the top of the file:

```ts
import { DEFAULT_LOCALE, getLocaleConfig, formatCurrency } from './locale.ts'
```

Then append at the end of the file:

```ts
describe('formatCurrency', () => {
  it('formats a value using the given locale and currency', () => {
    const expected = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(1234.5)
    expect(formatCurrency(1234.5, 'pt-BR', 'BRL')).toBe(expected)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/lib/locale.test.ts`
Expected: FAIL — `formatCurrency is not a function`.

- [ ] **Step 3: Implement `formatCurrency`**

Add to `client/src/lib/locale.ts`, after `getLocaleConfig`:

```ts
export function formatCurrency(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/lib/locale.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `ContractDetail` types**

Add to `client/src/features/contracts/contractSchemas.ts`, after the existing `Contract` interface:

```ts
export interface ContractDetailIdentityDocument {
  id: string
  label: string
  value: string
}

export interface ContractDetailAddressLine {
  id: string
  label: string
  value: string
  sortOrder: number
}

export interface ContractDetailClient {
  id: string
  name: string
  phone: string
  email: string
  identityDocuments: ContractDetailIdentityDocument[]
  addressLines: ContractDetailAddressLine[]
}

export interface ContractDetailClause {
  id: string
  text: string
  sortOrder: number
}

export interface ContractDetailLocation {
  id: string
  name: string
  address: string
  phone: string | null
  locale: string
  contractClauses: ContractDetailClause[]
}

export interface ContractDetailAllocation extends ContractAllocation {
  product: { id: string; name: string }
}

export interface ContractDetail extends Omit<Contract, 'allocations'> {
  allocations: ContractDetailAllocation[]
  client: ContractDetailClient
  location: ContractDetailLocation
}
```

- [ ] **Step 6: Add the `useContract` hook**

Modify `client/src/features/contracts/useContracts.ts` — update the type import:

```ts
import type { Contract, ContractDetail, NewContractFormValues } from './contractSchemas.ts'
```

Add this new hook after `useContractsList`:

```ts
export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: [...CONTRACTS_KEY, id],
    queryFn: () => apiFetch<ContractDetail>(`/api/contracts/${id}`),
    enabled: id !== undefined,
  })
}
```

- [ ] **Step 7: Verify the client typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/locale.ts client/src/lib/locale.test.ts client/src/features/contracts/contractSchemas.ts client/src/features/contracts/useContracts.ts
git commit -m "feat: add formatCurrency, ContractDetail types, and useContract hook"
```

---

### Task 3: `ContractPrintView` presentational component

**Files:**
- Create: `client/src/features/contracts/ContractPrintView.tsx`
- Test: `client/src/features/contracts/ContractPrintView.test.tsx`
- Modify: `client/src/locales/pt-BR/contracts.json`

**Interfaces:**
- Consumes: `ContractDetail` type (Task 2), `formatDate`/`parseDateOnly` (`../../lib/date.ts`), `formatCurrency`/`getLocaleConfig` (`../../lib/locale.ts`).
- Produces: `ContractPrintView({ contract: ContractDetail })` — a pure presentational component, no hooks beyond `useTranslation`, no data fetching. Consumed by Task 4's `ContractPrintPage`.

- [ ] **Step 1: Add the print translation keys**

Modify `client/src/locales/pt-BR/contracts.json` — add a `"print"` key as a sibling of the existing `"cancelContract"` key:

```json
  "print": {
    "action": "Imprimir",
    "back": "Voltar",
    "contractNumber": "Contrato Nº {{number}}",
    "clientSection": "Cliente",
    "itemsSection": "Peças",
    "total": "Valor Total",
    "installmentsSection": "Parcelas",
    "installmentPaid": "Pago",
    "installmentPending": "Pendente",
    "clausesSection": "Termos e Condições",
    "signatureLabel": "Assinatura do Cliente",
    "signedAt": "Assinado em {{date}}"
  },
```

(Insert it directly before the closing brace of the existing `"cancelContract"` block's following comma, i.e. as a new top-level key in the JSON object — keep the file valid JSON.)

- [ ] **Step 2: Write the failing component test**

Create `client/src/features/contracts/ContractPrintView.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { ContractPrintView } from './ContractPrintView.tsx'
import type { ContractDetail } from './contractSchemas.ts'

const baseContract: ContractDetail = {
  id: 'ct1',
  number: 7,
  locationId: 'loc1',
  clientId: 'c1',
  staffId: 's1',
  eventDate: '2026-10-03',
  paymentMethod: 'PIX',
  signatureStatus: 'unsigned',
  signatureImage: null,
  signedAt: null,
  createdAt: '2026-09-01',
  location: {
    id: 'loc1',
    name: 'Priscila Moda Festa',
    address: 'Rua das Flores, 100',
    phone: '1199999999',
    locale: 'pt-BR',
    contractClauses: [
      { id: 'cl1', text: 'Primeira cláusula.', sortOrder: 0 },
      { id: 'cl2', text: 'Segunda cláusula.', sortOrder: 1 },
    ],
  },
  client: {
    id: 'c1',
    name: 'Maria Souza',
    phone: '11988887777',
    email: 'maria@example.com',
    identityDocuments: [{ id: 'd1', label: 'CPF', value: '123.456.789-00' }],
    addressLines: [{ id: 'a1', label: 'Endereço', value: 'Rua A, 100', sortOrder: 0 }],
  },
  allocations: [
    {
      id: 'al1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
      checkoutDate: '2026-10-02', dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
      product: { id: 'p1', name: 'Vestido Azul' },
    },
  ],
  installments: [{ id: 'i1', contractId: 'ct1', dueDate: '2026-09-20', amount: 380, paid: false, paidAt: null }],
}

describe('ContractPrintView', () => {
  it('renders every paper-contract field for an unsigned contract', () => {
    render(<ContractPrintView contract={baseContract} />)

    expect(screen.getByText('Priscila Moda Festa')).toBeInTheDocument()
    expect(screen.getByText(/Contrato Nº 7/)).toBeInTheDocument()
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    expect(screen.getByText(/CPF/)).toBeInTheDocument()
    expect(screen.getByText(/Rua A, 100/)).toBeInTheDocument()
    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Primeira cláusula.')).toBeInTheDocument()
    expect(screen.getByText('Segunda cláusula.')).toBeInTheDocument()

    const expectedTotal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(380)
    expect(screen.getAllByText(new RegExp(expectedTotal.replace('$', '\\$'))).length).toBeGreaterThan(0)

    expect(screen.queryByAltText('Assinatura do Cliente')).not.toBeInTheDocument()
  })

  it('renders the signature image when the contract is signed', () => {
    const signedContract: ContractDetail = {
      ...baseContract,
      signatureStatus: 'signed',
      signatureImage: 'data:image/png;base64,iVBORw0KGgo=',
      signedAt: '2026-09-02T14:30:00.000Z',
    }
    render(<ContractPrintView contract={signedContract} />)

    expect(screen.getByAltText('Assinatura do Cliente')).toBeInTheDocument()
    expect(screen.getByText(/Assinado em/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd client && npx vitest run src/features/contracts/ContractPrintView.test.tsx`
Expected: FAIL — cannot find module `./ContractPrintView.tsx`.

- [ ] **Step 4: Implement `ContractPrintView`**

Create `client/src/features/contracts/ContractPrintView.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { formatDate, parseDateOnly } from '../../lib/date.ts'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import type { ContractDetail } from './contractSchemas.ts'

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }

interface ContractPrintViewProps {
  contract: ContractDetail
}

export function ContractPrintView({ contract }: ContractPrintViewProps) {
  const { t } = useTranslation('contracts')
  const locale = contract.location.locale
  const currency = getLocaleConfig(locale).currency
  const total = contract.allocations.reduce((sum, allocation) => sum + allocation.priceCharged, 0)

  return (
    <article className="flex flex-col gap-6 text-sm text-ink">
      <header className="flex flex-col gap-1 border-b border-border-soft pb-4">
        <h1 className="text-lg font-semibold">{contract.location.name}</h1>
        <p>{contract.location.address}</p>
        {contract.location.phone && <p>{contract.location.phone}</p>}
        <p className="mt-2 font-medium">{t('print.contractNumber', { number: contract.number })}</p>
        <p>
          {t('fields.eventDate')}: {formatDate(parseDateOnly(contract.eventDate), locale, DATE_FORMAT_OPTIONS)}
        </p>
      </header>

      <section className="flex flex-col gap-1">
        <h2 className="font-medium">{t('print.clientSection')}</h2>
        <p>{contract.client.name}</p>
        <p>{contract.client.phone}</p>
        <p>{contract.client.email}</p>
        {contract.client.identityDocuments.map((doc) => (
          <p key={doc.id}>
            {doc.label}: {doc.value}
          </p>
        ))}
        {contract.client.addressLines.map((line) => (
          <p key={line.id}>
            {line.label}: {line.value}
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t('print.itemsSection')}</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="py-1">{t('fields.product')}</th>
              <th className="py-1">{t('fields.checkoutDate')}</th>
              <th className="py-1">{t('fields.dueDate')}</th>
              <th className="py-1">{t('fields.priceCharged')}</th>
            </tr>
          </thead>
          <tbody>
            {contract.allocations.map((allocation) => (
              <tr key={allocation.id} className="border-b border-border-soft">
                <td className="py-1">{allocation.product.name}</td>
                <td className="py-1">
                  {formatDate(parseDateOnly(allocation.checkoutDate), locale, DATE_FORMAT_OPTIONS)}
                </td>
                <td className="py-1">{formatDate(parseDateOnly(allocation.dueDate), locale, DATE_FORMAT_OPTIONS)}</td>
                <td className="py-1">{formatCurrency(allocation.priceCharged, locale, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-right font-medium">
          {t('print.total')}: {formatCurrency(total, locale, currency)}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          {t('fields.paymentMethod')}: {contract.paymentMethod}
        </h2>
        {contract.installments.length > 0 && (
          <>
            <h3 className="font-medium">{t('print.installmentsSection')}</h3>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border-soft">
                  <th className="py-1">{t('fields.installmentDueDate')}</th>
                  <th className="py-1">{t('fields.installmentAmount')}</th>
                  <th className="py-1">{t('print.installmentPaid')}</th>
                </tr>
              </thead>
              <tbody>
                {contract.installments.map((installment) => (
                  <tr key={installment.id} className="border-b border-border-soft">
                    <td className="py-1">
                      {formatDate(parseDateOnly(installment.dueDate), locale, DATE_FORMAT_OPTIONS)}
                    </td>
                    <td className="py-1">{formatCurrency(installment.amount, locale, currency)}</td>
                    <td className="py-1">
                      {installment.paid ? t('print.installmentPaid') : t('print.installmentPending')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t('print.clausesSection')}</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-4">
          {contract.location.contractClauses.map((clause) => (
            <li key={clause.id}>{clause.text}</li>
          ))}
        </ol>
      </section>

      <section className="mt-8 flex flex-col items-center gap-2">
        {contract.signatureImage ? (
          <>
            <img src={contract.signatureImage} alt={t('print.signatureLabel')} className="h-24" />
            <p>{t('print.signatureLabel')}</p>
            {contract.signedAt && (
              <p className="text-xs text-muted-text">
                {t('print.signedAt', { date: formatDate(new Date(contract.signedAt), locale, DATE_FORMAT_OPTIONS) })}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="h-24 w-64 border-b border-ink" />
            <p>{t('print.signatureLabel')}</p>
          </>
        )}
      </section>
    </article>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/features/contracts/ContractPrintView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/features/contracts/ContractPrintView.tsx client/src/features/contracts/ContractPrintView.test.tsx client/src/locales/pt-BR/contracts.json
git commit -m "feat: add ContractPrintView presentational component"
```

---

### Task 4: `ContractPrintPage` route + wiring from `ContractsPage`

**Files:**
- Create: `client/src/features/contracts/ContractPrintPage.tsx`
- Test: `client/src/features/contracts/ContractPrintPage.test.tsx`
- Modify: `client/src/app/router.tsx`
- Modify: `client/src/features/contracts/ContractsPage.tsx`
- Modify: `client/src/features/contracts/ContractsPage.test.tsx`

**Interfaces:**
- Consumes: `useContract` (Task 2), `ContractPrintView` (Task 3), `Button` (`../../components/ui/button.tsx`), `Link`/`useParams`/`useNavigate` (`react-router`).
- Produces: `ContractPrintPage` component, mounted at route `/contratos/:id/imprimir`.

- [ ] **Step 1: Write the failing route/page test**

Create `client/src/features/contracts/ContractPrintPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { ContractPrintPage } from './ContractPrintPage.tsx'
import * as useContractsModule from './useContracts.ts'
import type { ContractDetail } from './contractSchemas.ts'

const contract: ContractDetail = {
  id: 'ct1', number: 7, locationId: 'loc1', clientId: 'c1', staffId: 's1',
  eventDate: '2026-10-03', paymentMethod: 'PIX', signatureStatus: 'unsigned',
  signatureImage: null, signedAt: null, createdAt: '2026-09-01',
  location: {
    id: 'loc1', name: 'Priscila Moda Festa', address: 'Rua das Flores, 100',
    phone: '1199999999', locale: 'pt-BR', contractClauses: [],
  },
  client: { id: 'c1', name: 'Maria Souza', phone: '11988887777', email: 'maria@example.com', identityDocuments: [], addressLines: [] },
  allocations: [
    {
      id: 'al1', productId: 'p1', clientId: 'c1', staffId: 's1', contractId: 'ct1',
      checkoutDate: '2026-10-02', dueDate: '2026-10-06', actualReturnDate: null,
      status: 'reserved', priceCharged: 380, depositCollected: null, depositReturned: null,
      conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-09-01',
      product: { id: 'p1', name: 'Vestido Azul' },
    },
  ],
  installments: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/contratos/ct1/imprimir']}>
      <Routes>
        <Route path="/contratos/:id/imprimir" element={<ContractPrintPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ContractPrintPage', () => {
  beforeEach(() => {
    vi.spyOn(useContractsModule, 'useContract').mockReturnValue({ data: contract, isLoading: false } as never)
    vi.stubGlobal('print', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the contract document and an Imprimir action that calls window.print', async () => {
    renderPage()

    expect(screen.getByText('Priscila Moda Festa')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('shows a Voltar action', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/features/contracts/ContractPrintPage.test.tsx`
Expected: FAIL — cannot find module `./ContractPrintPage.tsx`.

- [ ] **Step 3: Implement `ContractPrintPage`**

Create `client/src/features/contracts/ContractPrintPage.tsx`:

```tsx
import { useParams, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useContract } from './useContracts.ts'
import { ContractPrintView } from './ContractPrintView.tsx'

export function ContractPrintPage() {
  const { t } = useTranslation('contracts')
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: contract, isLoading } = useContract(id)

  if (isLoading || !contract) {
    return <div className="p-6">{t('title')}</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {t('print.back')}
        </Button>
        <Button onClick={() => window.print()}>{t('print.action')}</Button>
      </div>
      <ContractPrintView contract={contract} />
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/features/contracts/ContractPrintPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the route**

Modify `client/src/app/router.tsx` — add the import:

```tsx
import { ContractPrintPage } from '../features/contracts/ContractPrintPage.tsx'
```

Change the router body from:

```tsx
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/contratos" element={<ContractsPage />} />
          <Route path="/calendario" element={<CalendarPage />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>
      </Route>
```

to:

```tsx
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/contratos" element={<ContractsPage />} />
          <Route path="/calendario" element={<CalendarPage />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>
        <Route path="/contratos/:id/imprimir" element={<ContractPrintPage />} />
      </Route>
```

(The print route sits outside `AppLayout` so it renders full-page, with no sidebar — it's still inside `ProtectedRoute` so it stays behind auth.)

- [ ] **Step 6: Add the "Imprimir" link to each contract row**

Modify `client/src/features/contracts/ContractsPage.tsx` — add the import:

```tsx
import { Link } from 'react-router'
```

Replace this line (the `ContractCancelAction` usage inside the contract row header):

```tsx
              <ContractCancelAction contract={contract} />
```

with:

```tsx
              <div className="flex items-center gap-2">
                <Link
                  to={`/contratos/${contract.id}/imprimir`}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-border-soft bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-brand-300 hover:bg-brand-50"
                >
                  {t('print.action')}
                </Link>
                <ContractCancelAction contract={contract} />
              </div>
```

- [ ] **Step 7: Update `ContractsPage.test.tsx` to wrap with a route matching the Link's target**

`ContractsPage` is already rendered inside a bare `<MemoryRouter>` (see `renderWithProviders` in `client/src/features/contracts/ContractsPage.test.tsx`), which is sufficient for a `<Link>` to render (it doesn't require a matching `<Route>` to render the anchor itself). Add this assertion to the existing `'shows the contract number, client, and its line item'` test in `client/src/features/contracts/ContractsPage.test.tsx`:

```tsx
    expect(screen.getByRole('link', { name: 'Imprimir' })).toHaveAttribute('href', '/contratos/ct1/imprimir')
```

(Add it as the last line inside that `it(...)` block, right after the existing three `expect` calls.)

- [ ] **Step 8: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS, all tests including `ContractsPage.test.tsx`, `ContractPrintView.test.tsx`, `ContractPrintPage.test.tsx`.

- [ ] **Step 9: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add client/src/features/contracts/ContractPrintPage.tsx client/src/features/contracts/ContractPrintPage.test.tsx client/src/app/router.tsx client/src/features/contracts/ContractsPage.tsx client/src/features/contracts/ContractsPage.test.tsx
git commit -m "feat: add contract print page, reachable from ContractsPage"
```

---

## Manual verification (after all tasks)

Start the app (dev server + Electron or `npm run dev` per this project's existing dev workflow), open a Contract with at least one item and one installment, click "Imprimir" from `ContractsPage`, confirm the print page shows every paper field, click the "Imprimir" button and confirm the browser/Electron print dialog opens with the toolbar hidden in the print preview, click "Voltar" and confirm it returns to `ContractsPage`.
