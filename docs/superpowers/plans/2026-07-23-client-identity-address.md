# Client Identity Documents & Address Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the paper contract's fixed CPF/RG/address fields with fully generic, repeatable `{label, value}` lists on `Client` — `ClientIdentityDocument` and `ClientAddressLine` — so no country-specific document or address shape is ever hardcoded into the schema or backend, while still letting the pt-BR locale pre-seed and mask the specific fields (CPF, RG, Endereço, Bairro, Cidade, Estado) staff actually need today.

**Architecture:** Two new Prisma models hang off `Client` with cascade delete, each row carrying a human-editable `label`, a `value`, and an optional stable `maskKey` (independent of the label text) that drives input masking. A per-locale template (`client/src/lib/clientFieldTemplates.ts`) pre-seeds `ClientDrawer`'s two new repeatable-list sections with the labels/maskKeys a locale expects; a small mask registry (`client/src/lib/clientFieldMasks.ts`) maps `maskKey` to a formatter function, consumed by a new generic `MaskedTextInput` component. `Client` creation stays lightweight — these fields are never required to save a Client, only (in a later plan) to finalize a Contract.

**Tech Stack:** Existing stack only — Prisma, Express, Zod, React, react-hook-form (`useFieldArray`), Vitest, Testing Library. No new dependencies.

## Global Constraints

- No CPF/RG-specific (or any other country's document type) logic, validation, or column names anywhere in the schema or backend — `label`/`value`/`maskKey` are the only fields; what a label *means* is a locale-level UI concern only.
- `maskKey` is a stable identifier separate from the editable `label` — renaming a row's label must never break its masking.
- Neither identity documents nor address lines are required to create or update a `Client` — both arrays may be empty.
- No new npm dependencies.
- Follow existing test conventions exactly: Vitest, Testing Library, one `describe` per unit, `vi.fn()`/`vi.spyOn()` for mocks, Prisma-integration `clientService.test.ts` style for the service layer (real DB, `afterEach` cleanup).
- TDD: write the failing test before the implementation in every task.
- This project's route layer (`server/src/routes/clients.ts`) currently has no dedicated test file of its own — validation is exercised through `clientService.test.ts` (data layer) and the existing `happyPath.test.ts` integration test. Follow that existing convention; do not introduce a new route test file for this plan.

---

### Task 1: Prisma schema — `ClientIdentityDocument` and `ClientAddressLine`

**Files:**
- Modify: `server/prisma/models.prisma`
- Generated (do not hand-edit): `server/prisma/sqlite/schema.prisma`, `server/prisma/postgresql/schema.prisma`
- Generated: new migration under `server/prisma/sqlite/migrations/`

**Interfaces:**
- Consumes: nothing.
- Produces: `ClientIdentityDocument { id, clientId, label, value, maskKey }` and `ClientAddressLine { id, clientId, label, value, sortOrder, maskKey }`, both cascade-deleted with their `Client`; `Client.identityDocuments` and `Client.addressLines` relations. Consumed by Task 2 (`clientService.ts`).

This is a purely additive migration — two brand-new tables, no changes to existing columns — so no backfill is needed (unlike a later plan's `Allocation.contractId` migration).

- [ ] **Step 1: Edit the schema**

In `server/prisma/models.prisma`, add the `identityDocuments` and `addressLines` relations to the existing `Client` model:

```prisma
model Client {
  id        String   @id @default(uuid())
  name      String
  phone     String
  email     String
  notes     String?
  createdAt DateTime @default(now())

  allocations       Allocation[]
  identityDocuments ClientIdentityDocument[]
  addressLines      ClientAddressLine[]
}
```

Then add two new models anywhere after `Client` in the same file:

```prisma
model ClientIdentityDocument {
  id       String  @id @default(uuid())
  clientId String
  label    String
  value    String
  maskKey  String?

  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

model ClientAddressLine {
  id        String  @id @default(uuid())
  clientId  String
  label     String
  value     String
  sortOrder Int
  maskKey   String?

  client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Regenerate both provider schemas**

Run: `cd server && npm run db:schema`
Expected output: `Wrote prisma/sqlite/schema.prisma` (the script runs once per invocation, defaulting to sqlite since `DB_PROVIDER` isn't set — this is fine, the postgresql variant is regenerated the same way in Step 3's `db:migrate` isn't needed for postgres since postgres tests use `prisma db push`, not tracked migrations. Still, regenerate it explicitly for consistency):

Run: `cd server && DB_PROVIDER=postgresql npm run db:schema`
Expected output: `Wrote prisma/postgresql/schema.prisma`

Confirm both files now contain the `ClientIdentityDocument`/`ClientAddressLine` models by checking:
Run: `grep -c "model ClientIdentityDocument" server/prisma/sqlite/schema.prisma server/prisma/postgresql/schema.prisma`
Expected: `1` for both files.

- [ ] **Step 3: Create and apply the sqlite migration**

Run: `cd server && npm run db:schema && npx prisma migrate dev --name add_client_identity_and_address --schema prisma/sqlite/schema.prisma`

(`prisma migrate dev` prompts for a migration name if one isn't passed on the command line — passing `--name` here avoids that interactive prompt.)

Expected: a new directory appears under `server/prisma/sqlite/migrations/` (timestamp-prefixed, ending in `_add_client_identity_and_address`) containing a `migration.sql` that creates the two new tables; command reports the migration applied successfully and the Prisma client was regenerated.

- [ ] **Step 4: Verify the test database picks up the new schema**

Run: `cd server && npm test -- clientService.test.ts`
Expected: PASS (existing tests unaffected — `npm test`'s `pretest` hook runs `db:schema` + `prisma db push` against the sqlite test database automatically, picking up the new tables even though no test yet exercises them).

- [ ] **Step 5: Commit**

```bash
git add server/prisma/models.prisma server/prisma/sqlite/schema.prisma server/prisma/postgresql/schema.prisma server/prisma/sqlite/migrations
git commit -m "feat: add ClientIdentityDocument and ClientAddressLine models"
```

---

### Task 2: `clientService.ts` — nested read/write for identity documents and address lines

**Files:**
- Modify: `server/src/services/clientService.ts`
- Modify: `server/src/services/clientService.test.ts`

**Interfaces:**
- Consumes: `ClientIdentityDocument`, `ClientAddressLine` Prisma models (Task 1).
- Produces:
  - `ClientDTO` gains `identityDocuments: { id: string; label: string; value: string; maskKey: string | null }[]` and `addressLines: { id: string; label: string; value: string; sortOrder: number; maskKey: string | null }[]` (address lines ordered by `sortOrder`).
  - `CreateClientInput` gains optional `identityDocuments?: { label: string; value: string; maskKey?: string | null }[]` and `addressLines?: { label: string; value: string; sortOrder: number; maskKey?: string | null }[]`.
  - `UpdateClientInput` gains the same two optional fields, with **full-replace** semantics: if the key is present in the update payload (including an empty array), all existing rows of that kind are deleted and replaced with the payload's rows; if the key is absent (`undefined`), existing rows are left untouched.
  - Consumed by Task 3 (`clients.ts` route) and Task 6+ (client-side `Client`/`ClientFormValues` types).

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/clientService.test.ts`, inside the existing `describe('clientService', ...)` block (after the existing tests, before the closing `})`):

```ts
  it('creates a client with identity documents and address lines', async () => {
    const created = await createClient({
      name: 'Maria Silva',
      phone: '11999990000',
      email: 'maria@example.com',
      identityDocuments: [{ label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' }],
      addressLines: [
        { label: 'Endereço', value: 'Rua Dr. Sebastião Pereira, 47', sortOrder: 0 },
        { label: 'Cidade', value: 'Piedade', sortOrder: 1 },
      ],
    })

    expect(created.identityDocuments).toEqual([
      expect.objectContaining({ label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' }),
    ])
    expect(created.addressLines).toEqual([
      expect.objectContaining({ label: 'Endereço', value: 'Rua Dr. Sebastião Pereira, 47', sortOrder: 0 }),
      expect.objectContaining({ label: 'Cidade', value: 'Piedade', sortOrder: 1 }),
    ])
  })

  it('creates a client with no identity documents or address lines when omitted', async () => {
    const created = await createClient({ name: 'Joana', phone: '1', email: 'a@example.com' })
    expect(created.identityDocuments).toEqual([])
    expect(created.addressLines).toEqual([])
  })

  it('returns address lines ordered by sortOrder regardless of insertion order', async () => {
    const created = await createClient({
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      addressLines: [
        { label: 'Cidade', value: 'Piedade', sortOrder: 1 },
        { label: 'Endereço', value: 'Rua X', sortOrder: 0 },
      ],
    })
    const fetched = await getClient(created.id)
    expect(fetched.addressLines.map((line) => line.label)).toEqual(['Endereço', 'Cidade'])
  })

  it('replaces all identity documents on update when the field is provided', async () => {
    const created = await createClient({
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'old-value' }],
    })

    const updated = await updateClient(created.id, {
      identityDocuments: [{ label: 'CPF', value: 'new-value' }, { label: 'RG', value: '00.000.000-0' }],
    })

    expect(updated.identityDocuments).toHaveLength(2)
    expect(updated.identityDocuments.map((doc) => doc.value)).toEqual(['new-value', '00.000.000-0'])
  })

  it('clears all identity documents on update when given an empty array', async () => {
    const created = await createClient({
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'x' }],
    })

    const updated = await updateClient(created.id, { identityDocuments: [] })

    expect(updated.identityDocuments).toEqual([])
  })

  it('leaves identity documents untouched when the field is omitted from an update', async () => {
    const created = await createClient({
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'x' }],
    })

    const updated = await updateClient(created.id, { phone: '2' })

    expect(updated.identityDocuments).toEqual([expect.objectContaining({ label: 'CPF', value: 'x' })])
  })

  it('deletes identity documents and address lines when the client is deleted', async () => {
    const created = await createClient({
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      identityDocuments: [{ label: 'CPF', value: 'x' }],
      addressLines: [{ label: 'Cidade', value: 'Piedade', sortOrder: 0 }],
    })

    await deleteClient(created.id)

    const remainingDocs = await prisma.clientIdentityDocument.findMany({ where: { clientId: created.id } })
    const remainingLines = await prisma.clientAddressLine.findMany({ where: { clientId: created.id } })
    expect(remainingDocs).toEqual([])
    expect(remainingLines).toEqual([])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- clientService.test.ts`
Expected: FAIL — `createClient`/`updateClient`/`getClient` don't yet handle `identityDocuments`/`addressLines`, and `ClientDTO` doesn't include those fields (TypeScript errors and/or `undefined` values causing assertion failures).

- [ ] **Step 3: Write minimal implementation**

Replace `server/src/services/clientService.ts` in full:

```ts
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'

export interface IdentityDocumentInput {
  label: string
  value: string
  maskKey?: string | null
}

export interface AddressLineInput {
  label: string
  value: string
  sortOrder: number
  maskKey?: string | null
}

export interface CreateClientInput {
  name: string
  phone: string
  email: string
  notes?: string
  identityDocuments?: IdentityDocumentInput[]
  addressLines?: AddressLineInput[]
}

export interface UpdateClientInput {
  name?: string
  phone?: string
  email?: string
  notes?: string | null
  identityDocuments?: IdentityDocumentInput[]
  addressLines?: AddressLineInput[]
}

export interface IdentityDocumentDTO {
  id: string
  label: string
  value: string
  maskKey: string | null
}

export interface AddressLineDTO {
  id: string
  label: string
  value: string
  sortOrder: number
  maskKey: string | null
}

export interface ClientDTO {
  id: string
  name: string
  phone: string
  email: string
  notes: string | null
  hasAllocationHistory: boolean
  createdAt: Date
  identityDocuments: IdentityDocumentDTO[]
  addressLines: AddressLineDTO[]
}

interface ClientRow {
  id: string
  name: string
  phone: string
  email: string
  notes: string | null
  createdAt: Date
  identityDocuments: IdentityDocumentDTO[]
  addressLines: AddressLineDTO[]
}

const CLIENT_INCLUDE = {
  identityDocuments: true,
  addressLines: { orderBy: { sortOrder: 'asc' as const } },
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
  const row = await prisma.client.create({
    data: {
      name: data.name,
      phone: data.phone,
      email: data.email,
      notes: data.notes,
      identityDocuments: data.identityDocuments ? { create: data.identityDocuments } : undefined,
      addressLines: data.addressLines ? { create: data.addressLines } : undefined,
    },
    include: CLIENT_INCLUDE,
  })
  return toDTO(row, false)
}

export async function listClients(): Promise<ClientDTO[]> {
  const rows = await prisma.client.findMany({ orderBy: { createdAt: 'desc' }, include: CLIENT_INCLUDE })
  const withHistory = await historyByClientId(rows.map((row) => row.id))
  return rows.map((row) => toDTO(row, withHistory.has(row.id)))
}

export async function getClient(id: string): Promise<ClientDTO> {
  const row = await prisma.client.findUnique({ where: { id }, include: CLIENT_INCLUDE })
  if (!row) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${id} not found`)
  }
  return toDTO(row, await hasHistory(id))
}

export async function updateClient(id: string, data: UpdateClientInput): Promise<ClientDTO> {
  await getClient(id)

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id },
      data: { name: data.name, phone: data.phone, email: data.email, notes: data.notes },
    })

    if (data.identityDocuments !== undefined) {
      await tx.clientIdentityDocument.deleteMany({ where: { clientId: id } })
      if (data.identityDocuments.length > 0) {
        await tx.clientIdentityDocument.createMany({
          data: data.identityDocuments.map((doc) => ({ ...doc, clientId: id })),
        })
      }
    }

    if (data.addressLines !== undefined) {
      await tx.clientAddressLine.deleteMany({ where: { clientId: id } })
      if (data.addressLines.length > 0) {
        await tx.clientAddressLine.createMany({
          data: data.addressLines.map((line) => ({ ...line, clientId: id })),
        })
      }
    }
  })

  return getClient(id)
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- clientService.test.ts`
Expected: PASS — all tests, including the 7 new ones.

Vitest transpiles with esbuild and does not type-check, so also verify the Prisma `include`/transaction typing compiles cleanly:

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/clientService.ts server/src/services/clientService.test.ts
git commit -m "feat: nested identity documents and address lines on Client"
```

---

### Task 3: `clients.ts` route — validate the new arrays

**Files:**
- Modify: `server/src/routes/clients.ts`

**Interfaces:**
- Consumes: `CreateClientInput`/`UpdateClientInput` shapes from Task 2.
- Produces: `POST /api/clients` and `PATCH /api/clients/:id` accept optional `identityDocuments`/`addressLines` arrays, validated by Zod; unchanged response shape (now includes the two arrays via `ClientDTO`, already covered by Task 2's service tests).

No dedicated test file for this task, per the Global Constraints note — `server/src/routes/clients.ts` has no existing test file, and this is schema validation wiring only, exercised end-to-end by `server/tests/integration/happyPath.test.ts` (unchanged by this task) and thoroughly by Task 2's service-layer tests.

- [ ] **Step 1: Modify the route schemas**

Replace the schema definitions at the top of `server/src/routes/clients.ts` (everything from `const createSchema = ...` through `const updateSchema = createSchema.partial()`):

```ts
const identityDocumentSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  maskKey: z.string().nullable().optional(),
})

const addressLineSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  sortOrder: z.number().int(),
  maskKey: z.string().nullable().optional(),
})

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email().or(z.literal('')),
  notes: z.string().optional(),
  identityDocuments: z.array(identityDocumentSchema).optional(),
  addressLines: z.array(addressLineSchema).optional(),
})

const updateSchema = createSchema.partial()
```

Leave the rest of the file (the route handlers themselves) unchanged — they already pass `parsed.data` straight through to `createClient`/`updateClient`, which now accept the new fields per Task 2.

- [ ] **Step 2: Verify with a type-check and the existing integration test**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

Run: `cd server && npm test -- happyPath.test.ts`
Expected: PASS (unaffected — this test doesn't send the new fields, and they're optional).

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/clients.ts
git commit -m "feat: validate identity documents and address lines on client routes"
```

---

### Task 4: Client-side locale templates and mask formatters

**Files:**
- Create: `client/src/lib/clientFieldTemplates.ts`
- Create: `client/src/lib/clientFieldTemplates.test.ts`
- Create: `client/src/lib/clientFieldMasks.ts`
- Create: `client/src/lib/clientFieldMasks.test.ts`

**Interfaces:**
- Consumes: nothing (pure data/pure functions).
- Produces:
  - `ClientFieldTemplate` type: `{ identityDocuments: FieldTemplateEntry[]; addressLines: FieldTemplateEntry[] }`, `FieldTemplateEntry`: `{ label: string; maskKey?: string; required: boolean }`.
  - `getClientFieldTemplate(locale: string | undefined): ClientFieldTemplate`.
  - `getFieldMask(maskKey: string | null | undefined): ((raw: string) => string) | undefined`.
  - Consumed by Task 5 (`MaskedTextInput`) and Tasks 7–8 (`ClientDrawer`).

- [ ] **Step 1: Write the failing tests**

Create `client/src/lib/clientFieldTemplates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getClientFieldTemplate } from './clientFieldTemplates.ts'

describe('getClientFieldTemplate', () => {
  it('returns the pt-BR template with CPF and RG identity documents', () => {
    const template = getClientFieldTemplate('pt-BR')
    expect(template.identityDocuments).toEqual([
      { label: 'CPF', maskKey: 'br-cpf', required: true },
      { label: 'RG', maskKey: 'br-rg', required: true },
    ])
  })

  it('returns the pt-BR template with the four required address lines in order', () => {
    const template = getClientFieldTemplate('pt-BR')
    expect(template.addressLines).toEqual([
      { label: 'Endereço', required: true },
      { label: 'Bairro', required: true },
      { label: 'Cidade', required: true },
      { label: 'Estado', required: true },
    ])
  })

  it('falls back to pt-BR for an unregistered locale', () => {
    const template = getClientFieldTemplate('xx-YY')
    expect(template.identityDocuments).toHaveLength(2)
  })

  it('falls back to pt-BR for undefined', () => {
    const template = getClientFieldTemplate(undefined)
    expect(template.identityDocuments).toHaveLength(2)
  })
})
```

Create `client/src/lib/clientFieldMasks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getFieldMask } from './clientFieldMasks.ts'

describe('getFieldMask', () => {
  it('formats a CPF as digits are typed', () => {
    const format = getFieldMask('br-cpf')!
    expect(format('123')).toBe('123')
    expect(format('123456')).toBe('123.456')
    expect(format('123456789')).toBe('123.456.789')
    expect(format('12345678900')).toBe('123.456.789-00')
  })

  it('ignores non-digit characters and caps at 11 digits for CPF', () => {
    const format = getFieldMask('br-cpf')!
    expect(format('123.456.789-00extra')).toBe('123.456.789-00')
  })

  it('formats an RG with the common grouping convention, allowing a trailing letter', () => {
    const format = getFieldMask('br-rg')!
    expect(format('12')).toBe('12')
    expect(format('12345')).toBe('12.345')
    expect(format('12345678')).toBe('12.345.678')
    expect(format('12345678X')).toBe('12.345.678-X')
  })

  it('returns undefined for an unknown maskKey', () => {
    expect(getFieldMask('unknown-key')).toBeUndefined()
  })

  it('returns undefined for a null or undefined maskKey', () => {
    expect(getFieldMask(null)).toBeUndefined()
    expect(getFieldMask(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/lib/clientFieldTemplates.test.ts src/lib/clientFieldMasks.test.ts`
Expected: FAIL — neither `clientFieldTemplates.ts` nor `clientFieldMasks.ts` exists yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/clientFieldTemplates.ts`:

```ts
export interface FieldTemplateEntry {
  label: string
  maskKey?: string
  required: boolean
}

export interface ClientFieldTemplate {
  identityDocuments: FieldTemplateEntry[]
  addressLines: FieldTemplateEntry[]
}

const DEFAULT_LOCALE = 'pt-BR'

export const CLIENT_FIELD_TEMPLATES: Record<string, ClientFieldTemplate> = {
  'pt-BR': {
    identityDocuments: [
      { label: 'CPF', maskKey: 'br-cpf', required: true },
      { label: 'RG', maskKey: 'br-rg', required: true },
    ],
    addressLines: [
      { label: 'Endereço', required: true },
      { label: 'Bairro', required: true },
      { label: 'Cidade', required: true },
      { label: 'Estado', required: true },
    ],
  },
}

export function getClientFieldTemplate(locale: string | undefined): ClientFieldTemplate {
  return CLIENT_FIELD_TEMPLATES[locale ?? DEFAULT_LOCALE] ?? CLIENT_FIELD_TEMPLATES[DEFAULT_LOCALE]
}
```

Create `client/src/lib/clientFieldMasks.ts`:

```ts
function formatCPF(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  const p1 = digits.slice(0, 3)
  const p2 = digits.slice(3, 6)
  const p3 = digits.slice(6, 9)
  const p4 = digits.slice(9, 11)
  let out = p1
  if (digits.length > 3) out += `.${p2}`
  if (digits.length > 6) out += `.${p3}`
  if (digits.length > 9) out += `-${p4}`
  return out
}

/**
 * RG has no single national format — it's issued per Brazilian state.
 * This applies the common grouping convention (00.000.000-0), allowing an
 * optional trailing letter some states use as a check digit, as a
 * best-effort typing aid only — it does not validate correctness.
 */
function formatRG(raw: string): string {
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, '').slice(0, 9)
  const digits = cleaned.slice(0, 8).replace(/[^0-9]/g, '')
  const trailing = cleaned.slice(8, 9)
  const p1 = digits.slice(0, 2)
  const p2 = digits.slice(2, 5)
  const p3 = digits.slice(5, 8)
  let out = p1
  if (digits.length > 2) out += `.${p2}`
  if (digits.length > 5) out += `.${p3}`
  if (trailing) out += `-${trailing}`
  return out
}

const FIELD_MASK_REGISTRY: Record<string, (raw: string) => string> = {
  'br-cpf': formatCPF,
  'br-rg': formatRG,
}

export function getFieldMask(maskKey: string | null | undefined): ((raw: string) => string) | undefined {
  if (!maskKey) return undefined
  return FIELD_MASK_REGISTRY[maskKey]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/lib/clientFieldTemplates.test.ts src/lib/clientFieldMasks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/clientFieldTemplates.ts client/src/lib/clientFieldTemplates.test.ts client/src/lib/clientFieldMasks.ts client/src/lib/clientFieldMasks.test.ts
git commit -m "feat: add client field templates and mask formatters"
```

---

### Task 5: `MaskedTextInput` component

**Files:**
- Create: `client/src/components/ui/masked-text-input.tsx`
- Create: `client/src/components/ui/masked-text-input.test.tsx`

**Interfaces:**
- Consumes: nothing directly (the `mask` formatter function is passed in as a prop by the caller — this component doesn't know about `clientFieldMasks.ts`).
- Produces: `MaskedTextInput({ value: string; onChange: (value: string) => void; mask?: (raw: string) => string; ...rest })`, consumed by Tasks 7–8.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/ui/masked-text-input.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaskedTextInput } from './masked-text-input.tsx'

describe('MaskedTextInput', () => {
  it('renders the value as plain text when no mask is given', () => {
    render(<MaskedTextInput value="hello" onChange={vi.fn()} aria-label="Campo" />)
    expect(screen.getByLabelText('Campo')).toHaveValue('hello')
  })

  it('applies the given mask function to the displayed value', () => {
    const mask = (raw: string) => raw.toUpperCase()
    render(<MaskedTextInput value="abc" onChange={vi.fn()} mask={mask} aria-label="Campo" />)
    expect(screen.getByLabelText('Campo')).toHaveValue('ABC')
  })

  it('applies the mask to typed input and emits the masked value via onChange', async () => {
    const mask = (raw: string) => raw.toUpperCase()
    const onChange = vi.fn()
    render(<MaskedTextInput value="" onChange={onChange} mask={mask} aria-label="Campo" />)

    await userEvent.type(screen.getByLabelText('Campo'), 'abc')

    expect(onChange).toHaveBeenLastCalledWith('ABC')
  })

  it('is a plain text input', () => {
    render(<MaskedTextInput value="" onChange={vi.fn()} aria-label="Campo" />)
    expect(screen.getByLabelText('Campo')).toHaveAttribute('type', 'text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/ui/masked-text-input.test.tsx`
Expected: FAIL — `masked-text-input.tsx` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/components/ui/masked-text-input.tsx`, following the same shape as the existing `PhoneInput`/`DateInput` components:

```tsx
import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

type MaskedTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
  mask?: (raw: string) => string
}

export const MaskedTextInput = forwardRef<HTMLInputElement, MaskedTextInputProps>(
  function MaskedTextInput({ className, value, onChange, mask, ...props }, ref) {
    const format = mask ?? ((raw: string) => raw)
    const [display, setDisplay] = useState(() => format(value))

    useEffect(() => {
      setDisplay(format(value))
    }, [value, format])

    return (
      <input
        ref={ref}
        type="text"
        value={display}
        onChange={(event) => {
          const formatted = format(event.target.value)
          setDisplay(formatted)
          onChange(formatted)
        }}
        className={cn(
          'h-10 w-full rounded-md border border-border-soft bg-white px-3 text-sm text-ink placeholder:text-muted-text transition-colors',
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/ui/masked-text-input.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/masked-text-input.tsx client/src/components/ui/masked-text-input.test.tsx
git commit -m "feat: add MaskedTextInput component"
```

---

### Task 6: `clientSchemas.ts` — extend `Client`/`ClientFormValues` with the two arrays

**Files:**
- Modify: `client/src/features/clients/clientSchemas.ts`
- Modify: `client/src/features/clients/clientSchemas.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `clientSchema` (Zod) and `ClientFormValues`/`Client` types gain `identityDocuments: IdentityDocument[]` and `addressLines: AddressLine[]` (always arrays, defaulting to `[]` — never optional/undefined in form state, since the form always renders both sections). Consumed by Tasks 7–8 (`ClientDrawer`).

- [ ] **Step 1: Write the failing tests**

Add to `client/src/features/clients/clientSchemas.test.ts`, inside the existing `describe('clientSchema', ...)` block:

```ts
  it('accepts a client with identity documents and address lines', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      notes: '',
      identityDocuments: [{ label: 'CPF', value: '123.456.789-00', maskKey: 'br-cpf' }],
      addressLines: [{ label: 'Cidade', value: 'Piedade', sortOrder: 0, maskKey: null }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a client with empty identity documents and address lines arrays', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      identityDocuments: [],
      addressLines: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an identity document with an empty label', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      identityDocuments: [{ label: '', value: '123' }],
      addressLines: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an address line missing sortOrder', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva',
      phone: '11999999999',
      email: 'maria@example.com',
      identityDocuments: [],
      addressLines: [{ label: 'Cidade', value: 'Piedade' }],
    })
    expect(result.success).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/features/clients/clientSchemas.test.ts`
Expected: FAIL — `clientSchema` doesn't yet know about `identityDocuments`/`addressLines`, so the new-fields tests fail (extra keys silently ignored by default `z.object`, so the "accepts" tests may pass, but the "rejects" tests fail because there's no validation on fields that don't exist in the schema yet).

- [ ] **Step 3: Write minimal implementation**

Replace `client/src/features/clients/clientSchemas.ts` in full:

```ts
import { z } from 'zod'

export const identityDocumentSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  maskKey: z.string().nullable().optional(),
})

export const addressLineSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  sortOrder: z.number().int(),
  maskKey: z.string().nullable().optional(),
})

export const clientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email().or(z.literal('')),
  notes: z.string().optional(),
  identityDocuments: z.array(identityDocumentSchema),
  addressLines: z.array(addressLineSchema),
})

export type ClientFormValues = z.infer<typeof clientSchema>

export interface IdentityDocument {
  id?: string
  label: string
  value: string
  maskKey?: string | null
}

export interface AddressLine {
  id?: string
  label: string
  value: string
  sortOrder: number
  maskKey?: string | null
}

export interface Client extends ClientFormValues {
  id: string
  hasAllocationHistory: boolean
  createdAt: string
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/features/clients/clientSchemas.test.ts`
Expected: PASS — all tests, including the 4 new ones.

Vitest transpiles with esbuild and does not type-check, so also verify the exported types compile cleanly (this schema change touches `Client`/`ClientFormValues`, consumed by Tasks 7–8):

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/clients/clientSchemas.ts client/src/features/clients/clientSchemas.test.ts
git commit -m "feat: add identityDocuments/addressLines to client schema"
```

---

### Task 7: `ClientDrawer` — identity documents section

**Files:**
- Modify: `client/src/features/clients/ClientDrawer.tsx`
- Modify: `client/src/features/clients/ClientDrawer.test.tsx`

**Interfaces:**
- Consumes: `useFieldArray` from `react-hook-form` (already a dependency, used alongside the existing `useForm`); `getClientFieldTemplate` (Task 4); `getFieldMask` (Task 4); `MaskedTextInput` (Task 5); `identityDocumentSchema`/`Client`/`ClientFormValues` (Task 6); `useLocale()` (from the locale-plumbing-fix plan, already merged).
- Produces: a new "Identity Documents" section in `ClientDrawer`, with add/remove rows, each row's value masked per its `maskKey`. Pre-seeded from the active locale's template when creating a new client (no existing `client` prop).

- [ ] **Step 1: Write the failing tests**

Add to `client/src/features/clients/ClientDrawer.test.tsx` (check the existing file's imports/render helper first and match its conventions — it already renders `<ClientDrawer client={...} onClose={...} />`; add these tests to the existing `describe` block, or a new one in the same file):

```tsx
describe('ClientDrawer identity documents', () => {
  it('pre-seeds CPF and RG rows for a new client', () => {
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('CPF')).toBeInTheDocument()
    expect(screen.getByDisplayValue('RG')).toBeInTheDocument()
  })

  it('lets staff add a custom identity document row', async () => {
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    const addButton = screen.getByRole('button', { name: /adicionar documento/i })
    await userEvent.click(addButton)
    const labelInputs = screen.getAllByLabelText(/rótulo do documento/i)
    expect(labelInputs).toHaveLength(3)
  })

  it('lets staff remove an identity document row', async () => {
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    const removeButtons = screen.getAllByRole('button', { name: /remover documento/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('CPF')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('RG')).toBeInTheDocument()
  })

  it('applies the CPF mask as staff types into a CPF row value', async () => {
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    const valueInputs = screen.getAllByLabelText(/valor do documento/i)
    await userEvent.type(valueInputs[0], '12345678900')
    expect(valueInputs[0]).toHaveValue('123.456.789-00')
  })

  it('shows an existing client\'s stored identity documents, not the template defaults', () => {
    const client: Client = {
      id: 'c1',
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      notes: '',
      identityDocuments: [{ id: 'd1', label: 'Passaporte', value: 'AB123456', maskKey: null }],
      addressLines: [],
      hasAllocationHistory: false,
      createdAt: '2026-01-01',
    }
    render(<ClientDrawer client={client} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Passaporte')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('CPF')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/features/clients/ClientDrawer.test.tsx`
Expected: FAIL — no identity documents UI exists yet.

- [ ] **Step 3: Write minimal implementation**

Modify `client/src/features/clients/ClientDrawer.tsx`. First, update the imports:

```tsx
import { useState } from 'react'
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { PhoneInput } from '../../components/ui/phone-input.tsx'
import { MaskedTextInput } from '../../components/ui/masked-text-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { getClientFieldTemplate } from '../../lib/clientFieldTemplates.ts'
import { getFieldMask } from '../../lib/clientFieldMasks.ts'
import { clientSchema, type Client, type ClientFormValues } from './clientSchemas.ts'
import { useCreateClient, useUpdateClient, useDeleteClient } from './useClients.ts'
```

Change the component body's opening (translation/locale/hooks setup and form defaults):

```tsx
export function ClientDrawer({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { t } = useTranslation('clients')
  const { locale } = useLocale()
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const deleteClient = useDeleteClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const template = getClientFieldTemplate(locale)
  const defaultIdentityDocuments = client
    ? client.identityDocuments
    : template.identityDocuments.map((entry) => ({ label: entry.label, value: '', maskKey: entry.maskKey ?? null }))
  const defaultAddressLines = client
    ? client.addressLines
    : template.addressLines.map((entry, index) => ({
        label: entry.label,
        value: '',
        sortOrder: index,
        maskKey: entry.maskKey ?? null,
      }))

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ?? {
      name: '',
      phone: '',
      email: '',
      notes: '',
      identityDocuments: defaultIdentityDocuments,
      addressLines: defaultAddressLines,
    },
  })

  const identityDocuments = useFieldArray({ control, name: 'identityDocuments' })
```

(Note: when `client` is provided, `defaultValues: client` already includes `client.identityDocuments`/`client.addressLines` directly since `Client extends ClientFormValues` — the `defaultIdentityDocuments`/`defaultAddressLines` locals above are only actually used in the `client === null` branch, but are computed either way for clarity; this matches the existing pattern of `defaultValues: client ?? { ... }`.)

Add the Identity Documents section to the JSX, immediately after the existing `notes` field's closing `</label>` and before the `<div className="mt-2 flex justify-between gap-2">` action-buttons block:

```tsx
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('identityDocuments.title')}</span>
          {identityDocuments.fields.map((field, index) => (
            <div key={field.id} className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t('identityDocuments.label')}
                <Input
                  {...register(`identityDocuments.${index}.label`)}
                  aria-label={t('identityDocuments.labelFieldAria')}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t('identityDocuments.value')}
                <Controller
                  name={`identityDocuments.${index}.value`}
                  control={control}
                  render={({ field: valueField }) => (
                    <MaskedTextInput
                      value={valueField.value}
                      onChange={valueField.onChange}
                      mask={getFieldMask(identityDocuments.fields[index].maskKey)}
                      aria-label={t('identityDocuments.valueFieldAria')}
                    />
                  )}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={() => identityDocuments.remove(index)}
                aria-label={t('identityDocuments.remove')}
              >
                {t('identityDocuments.remove')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => identityDocuments.append({ label: '', value: '', maskKey: null })}
          >
            {t('identityDocuments.add')}
          </Button>
        </div>
```

Add the translation keys to `client/src/locales/pt-BR/clients.json` (merge into the existing object — add a new top-level `identityDocuments` key alongside `title`/`fields`/`validation`/`errors`/`empty`/`noResults`):

```json
  "identityDocuments": {
    "title": "Documentos de Identificação",
    "label": "Rótulo",
    "value": "Valor",
    "labelFieldAria": "Rótulo do documento",
    "valueFieldAria": "Valor do documento",
    "add": "Adicionar documento",
    "remove": "Remover documento"
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/features/clients/ClientDrawer.test.tsx`
Expected: PASS — all tests, including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/clients/ClientDrawer.tsx client/src/features/clients/ClientDrawer.test.tsx client/src/locales/pt-BR/clients.json
git commit -m "feat: add identity documents section to ClientDrawer"
```

---

### Task 8: `ClientDrawer` — address lines section

**Files:**
- Modify: `client/src/features/clients/ClientDrawer.tsx`
- Modify: `client/src/features/clients/ClientDrawer.test.tsx`
- Modify: `client/src/locales/pt-BR/clients.json`

**Interfaces:**
- Consumes: same as Task 7, plus Task 7's `identityDocuments` field-array pattern (mirrored for address lines).
- Produces: a new "Address" section in `ClientDrawer`, structurally identical to Task 7's identity documents section but keyed on `addressLines` (with `sortOrder` set to each row's current index on every add/remove, keeping the array's insertion order as its display order — no manual reordering UI in this plan).

- [ ] **Step 1: Write the failing tests**

Add to `client/src/features/clients/ClientDrawer.test.tsx`:

```tsx
describe('ClientDrawer address lines', () => {
  it('pre-seeds the four pt-BR address line rows for a new client', () => {
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Endereço')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bairro')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Cidade')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Estado')).toBeInTheDocument()
  })

  it('lets staff add a custom address line row', async () => {
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    const addButton = screen.getByRole('button', { name: /adicionar linha de endereço/i })
    await userEvent.click(addButton)
    const labelInputs = screen.getAllByLabelText(/rótulo da linha de endereço/i)
    expect(labelInputs).toHaveLength(5)
  })

  it('lets staff remove an address line row', async () => {
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    const removeButtons = screen.getAllByRole('button', { name: /remover linha de endereço/i })
    await userEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('Endereço')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Bairro')).toBeInTheDocument()
  })

  it('shows an existing client\'s stored address lines, not the template defaults', () => {
    const client: Client = {
      id: 'c1',
      name: 'Maria',
      phone: '1',
      email: 'a@example.com',
      notes: '',
      identityDocuments: [],
      addressLines: [{ id: 'l1', label: 'Zip Code', value: '90210', sortOrder: 0, maskKey: null }],
      hasAllocationHistory: false,
      createdAt: '2026-01-01',
    }
    render(<ClientDrawer client={client} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Zip Code')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Endereço')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/features/clients/ClientDrawer.test.tsx`
Expected: FAIL — no address lines UI exists yet (only the identity documents section from Task 7).

- [ ] **Step 3: Write minimal implementation**

In `client/src/features/clients/ClientDrawer.tsx`, add the `addressLines` field array next to the existing `identityDocuments` one:

```tsx
  const identityDocuments = useFieldArray({ control, name: 'identityDocuments' })
  const addressLines = useFieldArray({ control, name: 'addressLines' })
```

Add the Address section to the JSX, immediately after the Identity Documents section from Task 7 and before the action-buttons block:

```tsx
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('addressLines.title')}</span>
          {addressLines.fields.map((field, index) => (
            <div key={field.id} className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t('addressLines.label')}
                <Input
                  {...register(`addressLines.${index}.label`)}
                  aria-label={t('addressLines.labelFieldAria')}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t('addressLines.value')}
                <Controller
                  name={`addressLines.${index}.value`}
                  control={control}
                  render={({ field: valueField }) => (
                    <MaskedTextInput
                      value={valueField.value}
                      onChange={valueField.onChange}
                      mask={getFieldMask(addressLines.fields[index].maskKey)}
                      aria-label={t('addressLines.valueFieldAria')}
                    />
                  )}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={() => addressLines.remove(index)}
                aria-label={t('addressLines.remove')}
              >
                {t('addressLines.remove')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              addressLines.append({ label: '', value: '', sortOrder: addressLines.fields.length, maskKey: null })
            }
          >
            {t('addressLines.add')}
          </Button>
        </div>
```

Since `sortOrder` must reflect display order after removals too (e.g. removing row 0 of 3 should leave the remaining two rows numbered 0 and 1, not 1 and 2), add a `handleSubmit` wrapper that renumbers `addressLines` by its current array position right before submission. Change the `onSubmit` function:

```tsx
  async function onSubmit(values: ClientFormValues) {
    const normalized: ClientFormValues = {
      ...values,
      addressLines: values.addressLines.map((line, index) => ({ ...line, sortOrder: index })),
    }
    try {
      if (client) {
        await updateClient.mutateAsync({ id: client.id, values: normalized })
      } else {
        await createClient.mutateAsync(normalized)
      }
      onClose()
    } catch (error) {
      showError(error)
    }
  }
```

Add the translation keys to `client/src/locales/pt-BR/clients.json`, merged alongside the `identityDocuments` key added in Task 7:

```json
  "addressLines": {
    "title": "Endereço",
    "label": "Rótulo",
    "value": "Valor",
    "labelFieldAria": "Rótulo da linha de endereço",
    "valueFieldAria": "Valor da linha de endereço",
    "add": "Adicionar linha de endereço",
    "remove": "Remover linha de endereço"
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/features/clients/ClientDrawer.test.tsx`
Expected: PASS — all tests, including the 4 new ones from this task and the 5 from Task 7.

Then run the full client and server suites as this is the last task in the plan:

Run: `cd client && npx vitest run`
Expected: PASS, all files.

Run: `cd server && npm test`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/clients/ClientDrawer.tsx client/src/features/clients/ClientDrawer.test.tsx client/src/locales/pt-BR/clients.json
git commit -m "feat: add address lines section to ClientDrawer"
```

---

## Plan complete

After Task 8, `Client` has fully generic, repeatable identity-document and address-line lists — no CPF/RG/Bairro-shaped assumption anywhere in the schema or backend, while the pt-BR locale template still gives staff the exact four address fields and two ID documents the paper contract requires, pre-seeded and masked. Neither list is required to save a Client; that requirement is enforced by a later plan (Contract core) at the point a Contract is actually created.
