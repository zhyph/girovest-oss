# Contract Form Client/Product Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `<select>` client/product pickers in the "new contract" form with a searchable combobox that also lets staff create a brand-new client (full record) or product (full record) inline, without leaving the contract form.

**Architecture:** A new generic `EntityCombobox` UI primitive (Popover + accent-insensitive search, following the existing `AutocompleteInput` pattern — no new dependency) is wrapped by two thin, domain-specific components (`ClientCombobox`, `ProductCombobox`). `NewContractForm` swaps its two `<select>` fields for these, driven by `Controller` instead of `register`. Selecting "create new" opens the existing `ClientDrawer` / `ProductDrawer` (each gaining an `initialName` prefill and an `onCreated` callback) as a sibling overlay of the contract `Sheet`. `useCreateClient` / `useCreateProduct` seed the TanStack Query cache with the created record synchronously, so the new entity is selectable and fully "known" (readiness checks, price/size lookups) immediately, without waiting on the background refetch.

**Tech Stack:** React 19, react-hook-form + zod, TanStack Query v5, Radix `popover` primitive, Tailwind CSS v4, i18next (pt-BR only), Vitest + Testing Library.

## Global Constraints

- No new runtime dependency — build on the existing `Popover`/`PopoverAnchor`/`PopoverContent` (`client/src/components/ui/popover.tsx`) and `foldForSearch` (`client/src/lib/autocompleteMatch.ts:7`), the same primitives `AutocompleteInput` already uses. Do not add `cmdk` or shadcn `Command`.
- `clientId` and every `items.N.productId` field in `NewContractForm` must be `Controller`-driven, not `register`-driven — matches every other non-native field already in that file (`DateInput`, `CurrencyInput`).
- No backend/API changes. Creation still goes through the existing `POST /api/clients` / `POST /api/products` and their existing zod validation.
- No atomic client+contract (or product+contract) transaction — still two sequential requests.
- Creating a product inline still requires its full required fields (category, size, color, rental price) — no shortcut. Only client creation gets name+phone-first convenience (the rest of the client form is still there, just not gated before you can start the contract).
- Every new user-facing string goes through an i18next key in the (only shipped) `pt-BR` locale — no literal Portuguese text in `.tsx` files. Locale files: `client/src/locales/pt-BR/{contracts,clients,products}.json`.
- Scope is limited to: `client/src/components/ui/entity-combobox.tsx` (new), `client/src/features/clients/ClientCombobox.tsx` (new), `client/src/features/products/ProductCombobox.tsx` (new), `client/src/features/clients/useClients.ts`, `client/src/features/products/useProducts.ts`, `client/src/features/clients/ClientDrawer.tsx`, `client/src/features/products/ProductDrawer.tsx`, `client/src/features/products/ProductsPage.tsx`, `client/src/features/contracts/NewContractForm.tsx`, plus each file's test file. No other page/form is touched.
- Run tests with `cd client && npx vitest run <path>` (the client workspace's `package.json` `test` script is `vitest run`).

---

### Task 1: Cache-seeding on client/product create

**Files:**
- Modify: `client/src/features/clients/useClients.ts`
- Modify: `client/src/features/products/useProducts.ts`
- Test: `client/src/features/clients/useClients.test.ts` (new)
- Test: `client/src/features/products/useProducts.test.ts` (new)

**Interfaces:**
- Consumes: `apiFetch` (`client/src/lib/api.ts`), existing `Client`/`ClientFormValues` (`clientSchemas.ts`), `Product`/`ProductFormValues` (`productSchemas.ts`).
- Produces: `CLIENTS_KEY` now exported from `useClients.ts` (parallel to the already-exported `PRODUCTS_KEY` in `useProducts.ts`). `useCreateClient()`/`useCreateProduct()` behavior: on success, the newly created record is prepended into the `['clients']`/`['products']` query cache synchronously (before the background `invalidateQueries` refetch resolves) so any component reading `useClients()`/`useProducts()` sees it on the next render. Later tasks rely on this to make a just-created client/product immediately selectable.

- [ ] **Step 1: Write the failing test for client cache-seeding**

```ts
// client/src/features/clients/useClients.test.ts
import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '../../lib/api.ts'
import { useClients, useCreateClient, CLIENTS_KEY } from './useClients.ts'
import type { Client } from './clientSchemas.ts'

const created: Client = {
  id: 'c-new', name: 'Nova Cliente', phone: '11999990000', email: '', notes: '',
  identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-07-31',
}

function renderWithClient<T>(hook: () => T, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...renderHook(hook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  }) }
}

describe('useCreateClient', () => {
  afterEach(() => vi.restoreAllMocks())

  it('seeds the clients cache with the created client synchronously, before any refetch', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((url) => {
      if (url === '/api/clients') return Promise.resolve(created)
      return new Promise(() => {}) // GET refetch never resolves in this test — proves the seed alone is enough
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(CLIENTS_KEY, [])

    const { result } = renderWithClient(() => ({ create: useCreateClient(), list: useClients() }), queryClient)

    await result.current.create.mutateAsync({
      name: 'Nova Cliente', phone: '11999990000', email: '', notes: '', identityDocuments: [], addressLines: [],
    })

    await waitFor(() => expect(result.current.list.data).toEqual([created]))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/features/clients/useClients.test.ts`
Expected: FAIL — `CLIENTS_KEY` is not exported from `useClients.ts`, and even once imported, the seeded list would stay `[]` since nothing prepends the created record today.

- [ ] **Step 3: Implement cache-seeding in `useClients.ts`**

```ts
// client/src/features/clients/useClients.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Client, ClientFormValues } from './clientSchemas.ts'

export const CLIENTS_KEY = ['clients']

export function useClients() {
  return useQuery({
    queryKey: CLIENTS_KEY,
    queryFn: () => apiFetch<Client[]>('/api/clients'),
  })
}

export function useCreateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: ClientFormValues) =>
      apiFetch<Client>('/api/clients', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: (created) => {
      // Seeded ahead of the refetch below so a caller awaiting mutateAsync can
      // immediately find the new client in useClients() — the refetch this
      // still triggers is what reconciles it against the server's own state.
      queryClient.setQueryData<Client[]>(CLIENTS_KEY, (old) => [created, ...(old ?? [])])
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY })
    },
  })
}

export function useUpdateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ClientFormValues> }) =>
      apiFetch<Client>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLIENTS_KEY }),
  })
}

export function useDeleteClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLIENTS_KEY }),
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/features/clients/useClients.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for product cache-seeding**

```ts
// client/src/features/products/useProducts.test.ts
import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '../../lib/api.ts'
import { useProducts, useCreateProduct, PRODUCTS_KEY } from './useProducts.ts'
import type { Product } from './productSchemas.ts'

const created: Product = {
  id: 'p-new', locationId: 'l1', name: 'Vestido Novo', category: 'festa', size: 'M', color: 'rosa',
  rentalPrice: 200, depositAmount: 100, photos: [], status: 'active', availability: 'available',
  hasAllocationHistory: false, createdAt: '2026-07-31',
}

function renderWithClient<T>(hook: () => T, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...renderHook(hook, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  }) }
}

describe('useCreateProduct', () => {
  afterEach(() => vi.restoreAllMocks())

  it('seeds the products cache with the created product synchronously, before any refetch', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation((url) => {
      if (url === '/api/products') return Promise.resolve(created)
      return new Promise(() => {})
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(PRODUCTS_KEY, [])

    const { result } = renderWithClient(() => ({ create: useCreateProduct(), list: useProducts() }), queryClient)

    await result.current.create.mutateAsync({
      locationId: 'l1', name: 'Vestido Novo', category: 'festa', size: 'M', color: 'rosa',
      rentalPrice: 200, depositAmount: 100,
    })

    await waitFor(() => expect(result.current.list.data).toEqual([created]))
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd client && npx vitest run src/features/products/useProducts.test.ts`
Expected: FAIL — the seeded list stays `[]`.

- [ ] **Step 7: Implement cache-seeding in `useProducts.ts`**

```ts
// client/src/features/products/useProducts.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { PhotoTokenResponse, Product, ProductFormValues, ProductStatus } from './productSchemas.ts'

export const PRODUCTS_KEY = ['products']

export function useProducts(options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: () => apiFetch<Product[]>('/api/products'),
    refetchInterval: options.refetchInterval,
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: ProductFormValues) =>
      apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: (created) => {
      queryClient.setQueryData<Product[]>(PRODUCTS_KEY, (old) => [created, ...(old ?? [])])
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ProductFormValues> & { status?: ProductStatus } }) =>
      apiFetch<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  })
}

export function useIssueProductPhotoSession() {
  return useMutation({
    mutationFn: () => apiFetch<PhotoTokenResponse>('/api/products/photo-session', { method: 'POST' }),
  })
}
```

- [ ] **Step 8: Run both new tests plus the full client suite to check for regressions**

Run: `cd client && npx vitest run src/features/products/useProducts.test.ts src/features/clients/useClients.test.ts`
Expected: PASS
Run: `cd client && npx vitest run`
Expected: PASS (no other file reads `CLIENTS_KEY`/`PRODUCTS_KEY` in a way this changes)

- [ ] **Step 9: Commit**

```bash
cd client && git add src/features/clients/useClients.ts src/features/clients/useClients.test.ts src/features/products/useProducts.ts src/features/products/useProducts.test.ts
git commit -m "feat: seed client/product query cache immediately on create"
```

---

### Task 2: `EntityCombobox` UI primitive

**Files:**
- Create: `client/src/components/ui/entity-combobox.tsx`
- Test: `client/src/components/ui/entity-combobox.test.tsx`

**Interfaces:**
- Consumes: `Popover`/`PopoverAnchor`/`PopoverContent` (`./popover.tsx`), `foldForSearch` (`../../lib/autocompleteMatch.ts`), `cn` (`../../lib/cn.ts`), `ChevronDown` from `lucide-react`.
- Produces:
  ```ts
  export interface EntityComboboxRow {
    id: string
    label: string
    sublabel?: string
  }

  export function EntityCombobox(props: {
    rows: EntityComboboxRow[]
    value: string
    onSelect: (id: string) => void
    onCreateNew: (query: string) => void
    createLabel: (query: string) => string
    duplicateHint: (query: string) => string | undefined
    placeholder?: string
    className?: string
    'aria-label'?: string
    'aria-required'?: 'true'
    'aria-invalid'?: true
  }): JSX.Element
  ```
  Task 3/4 (`ClientCombobox`, `ProductCombobox`) consume this directly.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/ui/entity-combobox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityCombobox, type EntityComboboxRow } from './entity-combobox.tsx'

const ROWS: EntityComboboxRow[] = [
  { id: '1', label: 'Maria Silva', sublabel: '11999990000' },
  { id: '2', label: 'João Souza', sublabel: '11988880000' },
  { id: '3', label: 'Ana Costa', sublabel: '11977770000' },
]

function Harness({
  rows = ROWS,
  onSelect = vi.fn(),
  onCreateNew = vi.fn(),
  duplicateHint = () => undefined,
}: {
  rows?: EntityComboboxRow[]
  onSelect?: (id: string) => void
  onCreateNew?: (query: string) => void
  duplicateHint?: (query: string) => string | undefined
}) {
  const [value, setValue] = useState('')
  return (
    <EntityCombobox
      rows={rows}
      value={value}
      onSelect={(id) => {
        setValue(id)
        onSelect(id)
      }}
      onCreateNew={onCreateNew}
      createLabel={(query) => `Criar "${query}"`}
      duplicateHint={duplicateHint}
      aria-label="Cliente"
    />
  )
}

describe('EntityCombobox', () => {
  it('shows every row once opened, with no create row while the search is empty', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))

    expect(screen.getByRole('option', { name: /Maria Silva/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /João Souza/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Criar/ })).not.toBeInTheDocument()
  })

  it('filters by label and sublabel, ignoring case and accents', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), '999990000')

    expect(screen.getByRole('option', { name: /Maria Silva/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /João Souza/ })).not.toBeInTheDocument()
  })

  it('always renders the create row last once there is a query, regardless of matches', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')

    const options = screen.getAllByRole('option')
    expect(options[options.length - 1]).toHaveTextContent('Criar "Maria"')
  })

  it('selecting a row calls onSelect and closes the popover', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.click(screen.getByRole('option', { name: /Ana Costa/ }))

    expect(onSelect).toHaveBeenCalledWith('3')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selecting the create row calls onCreateNew with the trimmed query', async () => {
    const onCreateNew = vi.fn()
    render(<Harness onCreateNew={onCreateNew} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), '  Nova Pessoa  ')
    await userEvent.click(screen.getByRole('option', { name: /^Criar/ }))

    expect(onCreateNew).toHaveBeenCalledWith('Nova Pessoa')
  })

  it('the first match is highlighted by default so Enter selects it, not the create row', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')
    await userEvent.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('1')
  })

  it('arrow keys move the highlight down to the create row and Enter creates', async () => {
    const onCreateNew = vi.fn()
    render(<Harness rows={[ROWS[0]]} onCreateNew={onCreateNew} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onCreateNew).toHaveBeenCalledWith('Maria')
  })

  it('shows the duplicate hint next to the create row on an exact accent/case-insensitive match', async () => {
    render(<Harness duplicateHint={(query) => (query.toLowerCase() === 'maria silva' ? 'Já existe' : undefined)} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'MARIA SILVA')

    expect(screen.getByText('Já existe')).toBeInTheDocument()
  })

  it('shows the selected row label on the trigger after selecting', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.click(screen.getByRole('option', { name: /João Souza/ }))

    expect(screen.getByLabelText('Cliente')).toHaveTextContent('João Souza')
  })

  it('closes on Escape without selecting or creating anything', async () => {
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()
    render(<Harness onSelect={onSelect} onCreateNew={onCreateNew} />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Maria')

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCreateNew).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/components/ui/entity-combobox.test.tsx`
Expected: FAIL — `./entity-combobox.tsx` does not exist yet.

- [ ] **Step 3: Implement `EntityCombobox`**

```tsx
// client/src/components/ui/entity-combobox.tsx
import { useId, useMemo, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import { Popover, PopoverAnchor, PopoverContent } from './popover.tsx'

const MAX_VISIBLE_ROWS = 20

export interface EntityComboboxRow {
  id: string
  label: string
  sublabel?: string
}

type EntityComboboxProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onSelect'> & {
  rows: EntityComboboxRow[]
  value: string
  onSelect: (id: string) => void
  onCreateNew: (query: string) => void
  createLabel: (query: string) => string
  duplicateHint: (query: string) => string | undefined
  placeholder?: string
}

/**
 * An id-based combobox: search-filters a list of rows and always offers a
 * trailing "create new" action, built on the same Popover + foldForSearch
 * pattern as AutocompleteInput. Unlike AutocompleteInput this is not
 * free-solo text — the trigger shows the selected row's label, and typing
 * only searches, it never becomes the field's value directly.
 */
export function EntityCombobox({
  className,
  rows,
  value,
  onSelect,
  onCreateNew,
  createLabel,
  duplicateHint,
  placeholder = '—',
  ...props
}: EntityComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const listId = useId()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedRow = rows.find((row) => row.id === value) ?? null

  const filteredRows = useMemo(() => {
    const folded = foldForSearch(query)
    const matches = folded
      ? rows.filter((row) => foldForSearch(`${row.label} ${row.sublabel ?? ''}`).includes(folded))
      : rows
    return matches.slice(0, MAX_VISIBLE_ROWS)
  }, [rows, query])

  const trimmedQuery = query.trim()
  const showCreateRow = trimmedQuery !== ''
  const optionCount = filteredRows.length + (showCreateRow ? 1 : 0)
  // Clamped at read time, not only reset on keystrokes: `rows` comes from a
  // query that can refetch (window focus, any mutation) while the popover
  // is open and a held highlight could otherwise point past the new end.
  const activeIndex = optionCount > 0 ? Math.min(highlighted, optionCount - 1) : -1
  const hint = showCreateRow ? duplicateHint(trimmedQuery) : undefined
  const optionId = (index: number) => `${listId}-option-${index}`

  function openFresh() {
    setQuery('')
    setHighlighted(0)
    setIsOpen(true)
  }

  function commitIndex(index: number) {
    if (index < filteredRows.length) {
      onSelect(filteredRows[index].id)
    } else if (showCreateRow) {
      onCreateNew(trimmedQuery)
    }
    setIsOpen(false)
    setQuery('')
  }

  return (
    <Popover open={isOpen} onOpenChange={(next) => !next && setIsOpen(false)}>
      <PopoverAnchor asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          onClick={() => (isOpen ? setIsOpen(false) : openFresh())}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 text-sm transition-colors',
            'hover:border-input-hover',
            'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
            'aria-invalid:border-destructive aria-invalid:bg-destructive-subtle aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/30',
            className,
          )}
          {...props}
        >
          <span className={cn('truncate text-left', selectedRow ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedRow ? selectedRow.label : placeholder}
          </span>
          <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
      >
        <input
          ref={searchInputRef}
          type="text"
          role="searchbox"
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && optionCount > 0) {
              event.preventDefault()
              setHighlighted((current) => (current + 1) % optionCount)
            } else if (event.key === 'ArrowUp' && optionCount > 0) {
              event.preventDefault()
              setHighlighted((current) => (current <= 0 ? optionCount - 1 : current - 1))
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault()
              commitIndex(activeIndex)
            }
          }}
          placeholder={placeholder}
          className="mb-2 h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <div id={listId} role="listbox" className="max-h-56 overflow-y-auto">
          {filteredRows.map((row, index) => (
            <button
              key={row.id}
              id={optionId(index)}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => commitIndex(index)}
              onMouseEnter={() => setHighlighted(index)}
              className={cn(
                'flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm text-foreground transition-colors',
                index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary',
              )}
            >
              <span>{row.label}</span>
              {row.sublabel && <span className="text-xs text-muted-foreground">{row.sublabel}</span>}
            </button>
          ))}
          {showCreateRow && (
            <button
              id={optionId(filteredRows.length)}
              type="button"
              role="option"
              aria-selected={filteredRows.length === activeIndex}
              onClick={() => commitIndex(filteredRows.length)}
              onMouseEnter={() => setHighlighted(filteredRows.length)}
              className={cn(
                'flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors',
                filteredRows.length === activeIndex ? 'bg-secondary' : 'hover:bg-secondary',
              )}
            >
              <span>{createLabel(trimmedQuery)}</span>
              {hint && <span className="text-xs font-normal text-warning-foreground">{hint}</span>}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/components/ui/entity-combobox.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd client && git add src/components/ui/entity-combobox.tsx src/components/ui/entity-combobox.test.tsx
git commit -m "feat: add EntityCombobox, a searchable id-picker with inline create"
```

---

### Task 3: `ClientCombobox`

**Files:**
- Create: `client/src/features/clients/ClientCombobox.tsx`
- Test: `client/src/features/clients/ClientCombobox.test.tsx`
- Modify: `client/src/locales/pt-BR/contracts.json`

**Interfaces:**
- Consumes: `EntityCombobox`/`EntityComboboxRow` (Task 2), `foldForSearch` (`../../lib/autocompleteMatch.ts`), `Client` type (`./clientSchemas.ts`).
- Produces:
  ```ts
  export function ClientCombobox(props: {
    clients: Client[]
    value: string
    onSelect: (id: string) => void
    onCreateNew: (query: string) => void
    'aria-label'?: string
    'aria-required'?: 'true'
    'aria-invalid'?: true
  }): JSX.Element
  ```
  Task 7 (`NewContractForm`'s client field) consumes this directly.

- [ ] **Step 1: Add the i18n keys this component needs**

In `client/src/locales/pt-BR/contracts.json`, add a new top-level key (sibling of `"clientReadiness"`):

```json
  "clientCombobox": {
    "createNew": "Criar cliente \"{{name}}\"",
    "duplicateHint": "Já existe um cliente com esse nome"
  },
```

- [ ] **Step 2: Write the failing tests**

```tsx
// client/src/features/clients/ClientCombobox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ClientCombobox } from './ClientCombobox.tsx'
import type { Client } from './clientSchemas.ts'

const clients: Client[] = [
  { id: 'c1', name: 'Maria Silva', phone: '11999990000', email: '', notes: '', identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-01-01' },
  { id: 'c2', name: 'Cerimônia Souza', phone: '11988880000', email: '', notes: '', identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-01-01' },
]

describe('ClientCombobox', () => {
  it('lists clients sorted by name with phone as the sublabel', async () => {
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Cerimônia Souza')
    expect(options[0]).toHaveTextContent('11988880000')
    expect(options[1]).toHaveTextContent('Maria Silva')
  })

  it('matches accent-insensitively when filtering', async () => {
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'cerimonia')

    expect(screen.getByRole('option', { name: /Cerimônia Souza/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Maria Silva/ })).not.toBeInTheDocument()
  })

  it('renders the create-new row with the typed name', async () => {
    const onCreateNew = vi.fn()
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={onCreateNew} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'Nova Pessoa')
    await userEvent.click(screen.getByRole('option', { name: /Criar cliente "Nova Pessoa"/ }))

    expect(onCreateNew).toHaveBeenCalledWith('Nova Pessoa')
  })

  it('shows a duplicate hint when the typed name exactly matches an existing client', async () => {
    render(<ClientCombobox clients={clients} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Cliente" />)
    await userEvent.click(screen.getByLabelText('Cliente'))
    await userEvent.type(screen.getByRole('searchbox'), 'maria silva')

    expect(screen.getByText('Já existe um cliente com esse nome')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/features/clients/ClientCombobox.test.tsx`
Expected: FAIL — `./ClientCombobox.tsx` does not exist yet.

- [ ] **Step 4: Implement `ClientCombobox`**

```tsx
// client/src/features/clients/ClientCombobox.tsx
import { useTranslation } from 'react-i18next'
import { EntityCombobox } from '../../components/ui/entity-combobox.tsx'
import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import type { Client } from './clientSchemas.ts'

export function ClientCombobox({
  clients,
  value,
  onSelect,
  onCreateNew,
  'aria-label': ariaLabel,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
}: {
  clients: Client[]
  value: string
  onSelect: (id: string) => void
  onCreateNew: (query: string) => void
  'aria-label'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: true
}) {
  const { t } = useTranslation('contracts')

  const rows = [...clients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((client) => ({ id: client.id, label: client.name, sublabel: client.phone }))

  function duplicateHint(query: string) {
    const folded = foldForSearch(query)
    return clients.some((client) => foldForSearch(client.name) === folded)
      ? t('clientCombobox.duplicateHint')
      : undefined
  }

  return (
    <EntityCombobox
      rows={rows}
      value={value}
      onSelect={onSelect}
      onCreateNew={onCreateNew}
      createLabel={(query) => t('clientCombobox.createNew', { name: query })}
      duplicateHint={duplicateHint}
      aria-label={ariaLabel}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
    />
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/features/clients/ClientCombobox.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd client && git add src/features/clients/ClientCombobox.tsx src/features/clients/ClientCombobox.test.tsx src/locales/pt-BR/contracts.json
git commit -m "feat: add ClientCombobox wrapping EntityCombobox for client rows"
```

---

### Task 4: `ProductCombobox`

**Files:**
- Create: `client/src/features/products/ProductCombobox.tsx`
- Test: `client/src/features/products/ProductCombobox.test.tsx`
- Modify: `client/src/locales/pt-BR/contracts.json`

**Interfaces:**
- Consumes: `EntityCombobox`/`EntityComboboxRow` (Task 2), `foldForSearch` (`../../lib/autocompleteMatch.ts`), `Product` type (`./productSchemas.ts`).
- Produces:
  ```ts
  export function ProductCombobox(props: {
    products: Product[]
    value: string
    onSelect: (id: string) => void
    onCreateNew: (query: string) => void
    'aria-label'?: string
    'aria-required'?: 'true'
    'aria-invalid'?: true
  }): JSX.Element
  ```
  Task 8 (`NewContractForm`'s `ItemRow` product field) consumes this directly.

- [ ] **Step 1: Add the i18n keys this component needs**

In `client/src/locales/pt-BR/contracts.json`, add a new top-level key (sibling of `"clientCombobox"` added in Task 3):

```json
  "productCombobox": {
    "createNew": "Criar produto \"{{name}}\"",
    "duplicateHint": "Já existe um produto com esse nome"
  },
```

- [ ] **Step 2: Write the failing tests**

```tsx
// client/src/features/products/ProductCombobox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductCombobox } from './ProductCombobox.tsx'
import type { Product } from './productSchemas.ts'

const products: Product[] = [
  { id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'festa', size: 'M', color: 'azul', rentalPrice: 100, depositAmount: 50, photos: [], status: 'active', availability: 'available', hasAllocationHistory: false, createdAt: '2026-01-01' },
  { id: 'p2', locationId: 'l1', name: 'Vestido Azul', category: 'festa', size: 'P', color: 'azul-claro', rentalPrice: 90, depositAmount: 50, photos: [], status: 'active', availability: 'available', hasAllocationHistory: false, createdAt: '2026-01-01' },
]

describe('ProductCombobox', () => {
  it('shows size and color as the sublabel so same-named products are distinguishable', async () => {
    render(<ProductCombobox products={products} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('M · azul')
    expect(options[1]).toHaveTextContent('P · azul-claro')
  })

  it('renders the create-new row with the typed name', async () => {
    const onCreateNew = vi.fn()
    render(<ProductCombobox products={products} value="" onSelect={vi.fn()} onCreateNew={onCreateNew} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))
    await userEvent.type(screen.getByRole('searchbox'), 'Vestido Verde')
    await userEvent.click(screen.getByRole('option', { name: /Criar produto "Vestido Verde"/ }))

    expect(onCreateNew).toHaveBeenCalledWith('Vestido Verde')
  })

  it('shows a duplicate hint when the typed name exactly matches an existing product', async () => {
    render(<ProductCombobox products={products} value="" onSelect={vi.fn()} onCreateNew={vi.fn()} aria-label="Produto" />)
    await userEvent.click(screen.getByLabelText('Produto'))
    await userEvent.type(screen.getByRole('searchbox'), 'vestido azul')

    expect(screen.getByText('Já existe um produto com esse nome')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/features/products/ProductCombobox.test.tsx`
Expected: FAIL — `./ProductCombobox.tsx` does not exist yet.

- [ ] **Step 4: Implement `ProductCombobox`**

```tsx
// client/src/features/products/ProductCombobox.tsx
import { useTranslation } from 'react-i18next'
import { EntityCombobox } from '../../components/ui/entity-combobox.tsx'
import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import type { Product } from './productSchemas.ts'

export function ProductCombobox({
  products,
  value,
  onSelect,
  onCreateNew,
  'aria-label': ariaLabel,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
}: {
  products: Product[]
  value: string
  onSelect: (id: string) => void
  onCreateNew: (query: string) => void
  'aria-label'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: true
}) {
  const { t } = useTranslation('contracts')

  const rows = [...products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({ id: product.id, label: product.name, sublabel: `${product.size} · ${product.color}` }))

  function duplicateHint(query: string) {
    const folded = foldForSearch(query)
    return products.some((product) => foldForSearch(product.name) === folded)
      ? t('productCombobox.duplicateHint')
      : undefined
  }

  return (
    <EntityCombobox
      rows={rows}
      value={value}
      onSelect={onSelect}
      onCreateNew={onCreateNew}
      createLabel={(query) => t('productCombobox.createNew', { name: query })}
      duplicateHint={duplicateHint}
      aria-label={ariaLabel}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
    />
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/features/products/ProductCombobox.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd client && git add src/features/products/ProductCombobox.tsx src/features/products/ProductCombobox.test.tsx src/locales/pt-BR/contracts.json
git commit -m "feat: add ProductCombobox wrapping EntityCombobox for product rows"
```

---

### Task 5: `ClientDrawer` gains `initialName` and `onCreated`

**Files:**
- Modify: `client/src/features/clients/ClientDrawer.tsx`
- Test: `client/src/features/clients/ClientDrawer.test.tsx`

**Interfaces:**
- Produces: `ClientDrawer` accepts two new optional props — `initialName?: string` (used only when `client` is `null`, prefills the name field) and `onCreated?: (client: Client) => void` (called with the server-created `Client`, right before `onClose()`, in the create branch only). Task 7 (`NewContractForm`) relies on both.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/features/clients/ClientDrawer.test.tsx` (inside the existing `describe('ClientDrawer', ...)` block, following the file's existing `mockClientHooks` helper):

```tsx
  it('prefills the name field from initialName in create mode only', () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={null} initialName="Nova Cliente" onClose={vi.fn()} />)

    expect(screen.getByLabelText('Nome')).toHaveValue('Nova Cliente')
  })

  it('ignores initialName when editing an existing client', () => {
    mockClientHooks()
    renderWithToast(<ClientDrawer client={client} initialName="Deveria Ser Ignorado" onClose={vi.fn()} />)

    expect(screen.getByLabelText('Nome')).toHaveValue('Maria Silva')
  })

  it('calls onCreated with the created client on save, only in create mode', async () => {
    const created: Client = { ...client, id: 'c-new', name: 'Nova Cliente' }
    const createImpl = vi.fn().mockResolvedValue(created)
    const onCreated = vi.fn()
    mockClientHooks(vi.fn(), createImpl)
    renderWithToast(<ClientDrawer client={null} onClose={vi.fn()} onCreated={onCreated} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Nova Cliente')
    await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onCreated).toHaveBeenCalledWith(created)
  })

  it('does not call onCreated when updating an existing client', async () => {
    const updateImpl = vi.fn().mockResolvedValue(client)
    const onCreated = vi.fn()
    mockClientHooks(vi.fn(), vi.fn(), updateImpl)
    renderWithToast(<ClientDrawer client={client} onClose={vi.fn()} onCreated={onCreated} />)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onCreated).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/features/clients/ClientDrawer.test.tsx`
Expected: FAIL — `initialName`/`onCreated` are not accepted/used yet.

- [ ] **Step 3: Implement the props in `ClientDrawer.tsx`**

Change the function signature (`client/src/features/clients/ClientDrawer.tsx:23`):

```tsx
export function ClientDrawer({
  client,
  onClose,
  initialName,
  onCreated,
}: {
  client: Client | null
  onClose: () => void
  initialName?: string
  onCreated?: (client: Client) => void
}) {
```

Change the `useForm` default values (`ClientDrawer.tsx:56-64`) so `name` falls back to `initialName`:

```tsx
    defaultValues: client ?? {
      name: initialName ?? '',
      phone: '',
      email: '',
      notes: '',
      identityDocuments: defaultIdentityDocuments,
      addressLines: defaultAddressLines,
    },
```

Change `onSubmit` (`ClientDrawer.tsx:125-152`) to capture and forward the created client:

```tsx
  async function onSubmit(values: ClientFormValues) {
    const normalized: ClientFormValues = {
      ...values,
      identityDocuments: values.identityDocuments
        .filter((doc) => doc.value.trim() !== '')
        .map((doc) => ({ ...doc, value: doc.value.trim() })),
      addressLines: values.addressLines
        .filter((line) => line.value.trim() !== '')
        .map((line, index) => ({
          ...line,
          value: normalizeToSuggestion(line.value, addressSuggestionsFor(line.label)),
          sortOrder: index,
        })),
    }
    try {
      if (client) {
        await updateClient.mutateAsync({ id: client.id, values: normalized })
      } else {
        const created = await createClient.mutateAsync(normalized)
        onCreated?.(created)
      }
      onClose()
    } catch (error) {
      showError(error)
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/features/clients/ClientDrawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full client suite to check for regressions**

Run: `cd client && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd client && git add src/features/clients/ClientDrawer.tsx src/features/clients/ClientDrawer.test.tsx
git commit -m "feat: ClientDrawer supports initialName prefill and an onCreated callback"
```

---

### Task 6: `ProductDrawer` gains `initialName`/`allowSaveAndAddAnother`, `onCreated` now carries the created `Product`

**Files:**
- Modify: `client/src/features/products/ProductDrawer.tsx`
- Modify: `client/src/features/products/ProductsPage.tsx`
- Test: `client/src/features/products/ProductDrawer.test.tsx`
- Test: `client/src/features/products/ProductsPage.test.tsx`

**Interfaces:**
- Produces: `ProductDrawer` accepts two new optional props — `initialName?: string` (used only when `product` is `null`) and `allowSaveAndAddAnother?: boolean` (default `true`; when `false`, the "Salvar e adicionar outro" checkbox is not rendered and create-mode always closes after save). `onCreated`'s signature changes from `(values: ProductFormValues) => void` to `(product: Product) => void` — it now receives the actual server-created record (with `id`), not the submitted form values. Task 8 (`NewContractForm`) relies on all three; `ProductsPage` (existing consumer) must be updated in the same task since its callback reads fields off the argument.

- [ ] **Step 1: Update the existing `ProductDrawer.test.tsx` "onCreated" test for the new payload shape**

Replace the test at `ProductDrawer.test.tsx:354-374` (`'calls onCreated with the saved values and stays open when "Salvar e adicionar outro" is checked'`):

```tsx
  it('calls onCreated with the created product and stays open when "Salvar e adicionar outro" is checked', async () => {
    const onClose = vi.fn()
    const onCreated = vi.fn()
    const createdProduct = {
      id: 'p2', locationId: 'l1', name: 'Vestido Verde', category: 'festa', size: 'M', color: 'verde',
      rentalPrice: 150, depositAmount: 0, status: 'active' as const, availability: 'available' as const,
      hasAllocationHistory: false, createdAt: '2026-01-02',
    }
    const createImpl = vi.fn().mockResolvedValue(createdProduct)
    mockProductHooks(vi.fn(), createImpl)
    renderWithToast(<ProductDrawer product={null} onClose={onClose} onCreated={onCreated} />)

    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith(createdProduct)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })
```

Add two new tests in the same `describe` block:

```tsx
  it('prefills the name field from initialName in create mode', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} initialName="Vestido Rosa" />)

    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Rosa')
  })

  it('hides "Salvar e adicionar outro" when allowSaveAndAddAnother is false', () => {
    mockProductHooks(vi.fn())
    renderWithToast(<ProductDrawer product={null} onClose={vi.fn()} allowSaveAndAddAnother={false} />)

    expect(screen.queryByLabelText('Salvar e adicionar outro')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/features/products/ProductDrawer.test.tsx`
Expected: FAIL — the updated assertion mismatches the current `onCreated?.(normalized)` call, and `initialName`/`allowSaveAndAddAnother` aren't accepted yet.

- [ ] **Step 3: Implement the props in `ProductDrawer.tsx`**

Change the function signature (`client/src/features/products/ProductDrawer.tsx:28-38`):

```tsx
export function ProductDrawer({
  product,
  onClose,
  duplicateDefaults,
  initialName,
  allowSaveAndAddAnother = true,
  onCreated,
}: {
  product: Product | null
  onClose: () => void
  duplicateDefaults?: Partial<ProductFormValues>
  initialName?: string
  allowSaveAndAddAnother?: boolean
  onCreated?: (product: Product) => void
}) {
```

Change the `useForm` default `name` (`ProductDrawer.tsx:60`):

```tsx
      name: initialName ?? '',
```

Change `onSubmit`'s create branch (`ProductDrawer.tsx:111-113`) to pass the created record instead of the submitted values:

```tsx
      } else {
        const created = await createProduct.mutateAsync({ ...normalized, photos })
        onCreated?.(created)
```

(the rest of that `else` branch — the `addAnotherAfterSave` reset/close logic — is unchanged)

Guard the checkbox (`ProductDrawer.tsx:315-324`):

```tsx
        {!product && allowSaveAndAddAnother && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addAnotherAfterSave}
              onChange={(event) => setAddAnotherAfterSave(event.target.checked)}
            />
            {t('common:actions.saveAndAddAnother', { ns: 'common' })}
          </label>
        )}
```

- [ ] **Step 4: Run `ProductDrawer.test.tsx` to verify it passes**

Run: `cd client && npx vitest run src/features/products/ProductDrawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Fix `ProductsPage.tsx`'s consumption of the new `onCreated` payload**

`ProductsPage.tsx:144-153` currently reads `values.description` straight from the form (typed `string | undefined`). The created `Product` types `description` the same way in the client (`ProductFormValues`/`Product` share the field), but the *server* returns `null` for an empty description — map it explicitly so a later `register('description')` in the next drawer never receives `null`:

```tsx
          onCreated={(createdProduct) =>
            setLastCreatedDefaults({
              category: createdProduct.category,
              size: createdProduct.size,
              color: createdProduct.color,
              rentalPrice: createdProduct.rentalPrice,
              depositAmount: createdProduct.depositAmount,
              description: createdProduct.description ?? undefined,
            })
          }
```

- [ ] **Step 6: Update `ProductsPage.test.tsx`'s two affected mocks so they resolve a real product**

`ProductsPage.tsx`'s "save and add another" flow now reads `category`/`size`/`color`/etc. off whatever `createProduct.mutateAsync(...)` resolves to, not off the typed form values directly — so the two tests at `ProductsPage.test.tsx:100` and `ProductsPage.test.tsx:131` (both currently `vi.fn().mockResolvedValue(undefined)`) need a resolved value with the fields the test asserts on afterwards. In both tests, replace:

```tsx
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false } as never)
```

with:

```tsx
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        id: 'p2', locationId: 'l1', name: 'Vestido Verde', category: 'festa', size: 'M', color: 'verde',
        rentalPrice: 150, depositAmount: 0, status: 'active', availability: 'available',
        hasAllocationHistory: false, createdAt: '2026-01-02',
      }),
      isPending: false,
    } as never)
```

- [ ] **Step 7: Add a regression test for the `description: null → undefined` mapping**

Add to `ProductsPage.test.tsx`, alongside the two tests updated in Step 6:

```tsx
  it('does not crash and leaves Descrição blank when the created product has no description', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1', locationName: 'Loja Teste', locale: 'pt-BR' }, isLoadingStaff: false, isErrorStaff: false, refetchStaff: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: true })
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        id: 'p2', locationId: 'l1', name: 'Vestido Verde', description: null, category: 'festa', size: 'M', color: 'verde',
        rentalPrice: 150, depositAmount: 0, status: 'active', availability: 'available',
        hasAllocationHistory: false, createdAt: '2026-01-02',
      }),
      isPending: false,
    } as never)
    vi.spyOn(useProductsModule, 'useUpdateProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    vi.spyOn(useProductsModule, 'useDeleteProduct').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderWithQueryClient(<ProductsPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Vestido Verde')
    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'M')
    await userEvent.type(screen.getByLabelText('Cor'), 'verde')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '15000')
    await userEvent.click(screen.getByLabelText('Salvar e adicionar outro'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    // A `null` description handed straight to an uncontrolled register('description')
    // input would render "null" (or throw, depending on the input type) — this
    // must come through as an empty field instead.
    expect(screen.getByLabelText('Descrição')).toHaveValue('')
  })
```

- [ ] **Step 8: Run the full client suite to verify everything passes**

Run: `cd client && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd client && git add src/features/products/ProductDrawer.tsx src/features/products/ProductDrawer.test.tsx src/features/products/ProductsPage.tsx src/features/products/ProductsPage.test.tsx
git commit -m "feat: ProductDrawer supports initialName/allowSaveAndAddAnother, onCreated carries the created product"
```

---

### Task 7: Wire the client combobox and inline create into `NewContractForm`

**Files:**
- Modify: `client/src/features/contracts/NewContractForm.tsx`

**Interfaces:**
- Consumes: `ClientCombobox` (Task 3), `ClientDrawer`'s `initialName`/`onCreated` (Task 5), `useCreateClient`'s cache-seeding (Task 1, already effective through `useClients()`).
- Produces: no new exports — this task only changes `NewContractForm`'s internal client-field wiring. Task 9's test rewrites depend on the exact DOM/interaction shape this task produces (trigger has `aria-label` "Cliente", opens a `role="option"` list, create row reads "Criar cliente \"...\"").

- [ ] **Step 1: Replace the client `<select>` with `ClientCombobox`, `Controller`-driven**

In `client/src/features/contracts/NewContractForm.tsx`, add the import (near the existing `ClientDrawer` import):

```tsx
import { ClientCombobox } from '../clients/ClientCombobox.tsx'
```

Add one new piece of state alongside `completingClient` (`NewContractForm.tsx:152`):

```tsx
  const [completingClient, setCompletingClient] = useState<Client | null>(null)
  const [creatingClientName, setCreatingClientName] = useState<string | null>(null)
```

Replace the client field block (`NewContractForm.tsx:227-236`):

```tsx
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('fields.client')}<RequiredMark /></span>
            <Controller
              name="clientId"
              control={control}
              render={({ field }) => (
                <ClientCombobox
                  clients={clients ?? []}
                  value={field.value}
                  onSelect={field.onChange}
                  onCreateNew={(name) => setCreatingClientName(name)}
                  aria-label={t('fields.client')}
                  aria-required="true"
                  aria-invalid={errors.clientId ? true : undefined}
                />
              )}
            />
            {errors.clientId && <span className="text-xs text-destructive">{t('validation.clientRequired')}</span>}
          </label>
```

- [ ] **Step 2: Render the inline-create `ClientDrawer` as a sibling of the contract `Sheet`**

Change the closing block (`NewContractForm.tsx:403-405`) from:

```tsx
    </Sheet>
    {completingClient && <ClientDrawer client={completingClient} onClose={() => setCompletingClient(null)} />}
    </>
```

to:

```tsx
    </Sheet>
    {completingClient && <ClientDrawer client={completingClient} onClose={() => setCompletingClient(null)} />}
    {creatingClientName !== null && (
      <ClientDrawer
        client={null}
        initialName={creatingClientName}
        onClose={() => setCreatingClientName(null)}
        onCreated={(newClient) => {
          setValue('clientId', newClient.id, { shouldDirty: true, shouldValidate: true })
          setCreatingClientName(null)
        }}
      />
    )}
    </>
```

- [ ] **Step 3: Run the existing test suite to see the expected breakage**

Run: `cd client && npx vitest run src/features/contracts/NewContractForm.test.tsx`
Expected: FAIL — every test using `userEvent.selectOptions(screen.getByLabelText(/cliente/i), ...)` breaks, since the client field is no longer a native `<select>`. This is expected; Task 9 rewrites these tests. Do not attempt to fix them here — this task's own scope is the form wiring, not the test suite (Task 9's test cycle is where the "no regressions" gate lives). The product field and `paymentMethod` field still use `<Select>` at this point (`paymentMethod` keeps using it permanently — Task 8 only removes the product one), so the `Select` import stays in the file.

- [ ] **Step 4: Manually sanity-check in the running app**

Run: `cd client && npm run dev` (or the repo's existing dev-server invocation), open Contratos → Novo Contrato, confirm: the client field opens a searchable list on click, typing a name that doesn't exist shows a "Criar cliente "..."" row, selecting it opens the full client drawer prefilled with the typed name, saving it selects that client back in the contract form and the trigger shows the new name. Stop the dev server afterward.

- [ ] **Step 5: Commit**

```bash
cd client && git add src/features/contracts/NewContractForm.tsx
git commit -m "feat: contract form client field becomes a searchable combobox with inline create"
```

---

### Task 8: Wire the product combobox and inline create into `ItemRow`

**Files:**
- Modify: `client/src/features/contracts/NewContractForm.tsx`

**Interfaces:**
- Consumes: `ProductCombobox` (Task 4), `ProductDrawer`'s `initialName`/`allowSaveAndAddAnother`/`onCreated` (Task 6), `Product` type (`../products/productSchemas.ts`).
- Produces: no new exports — internal wiring only. Task 9's test rewrites depend on this task's exact shape (trigger `aria-label` "Produto", create row "Criar produto \"...\"").

- [ ] **Step 1: Widen `ItemRow`'s product prop type and drop the now-unused `register` prop**

Change `ItemRow`'s signature (`NewContractForm.tsx:27-47`):

```tsx
function ItemRow({
  index,
  control,
  activeProducts,
  setValue,
  onRemove,
  showRemove,
  checkoutDateError,
  dueDateError,
  onCreateProduct,
}: {
  index: number
  control: ReturnType<typeof useForm<NewContractFormValues>>['control']
  activeProducts: Product[]
  setValue: ReturnType<typeof useForm<NewContractFormValues>>['setValue']
  onRemove: () => void
  showRemove: boolean
  checkoutDateError?: string
  dueDateError?: string
  onCreateProduct: (index: number, name: string) => void
}) {
```

Add the import for `Product` and `ProductCombobox` at the top of the file:

```tsx
import type { Product } from '../products/productSchemas.ts'
import { ProductCombobox } from '../products/ProductCombobox.tsx'
```

- [ ] **Step 2: Replace the product `<select>` inside `ItemRow` with `ProductCombobox`, `Controller`-driven, moving the price auto-fill into `onSelect`**

Replace the product field block (`NewContractForm.tsx:56-79`):

```tsx
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>{t('fields.product')}<RequiredMark /></span>
          <Controller
            name={`items.${index}.productId`}
            control={control}
            render={({ field }) => (
              <ProductCombobox
                products={activeProducts}
                value={field.value}
                onSelect={(id) => {
                  field.onChange(id)
                  // Staff should not have to remember each piece's price. The
                  // field stays editable — a discount or a surcharge is still
                  // just typing over it — but it starts from the real number.
                  const picked = activeProducts.find((product) => product.id === id)
                  if (picked) {
                    setValue(`items.${index}.priceCharged`, picked.rentalPrice, { shouldDirty: true })
                  }
                }}
                onCreateNew={(name) => onCreateProduct(index, name)}
                aria-label={t('fields.product')}
                aria-required="true"
              />
            )}
          />
        </label>
```

- [ ] **Step 3: Add per-item create-product state and rendering in `NewContractForm`**

Add state alongside `creatingClientName` (from Task 7):

```tsx
  const [creatingProduct, setCreatingProduct] = useState<{ index: number; name: string } | null>(null)
```

Pass `onCreateProduct` into each `ItemRow` (`NewContractForm.tsx:268-289`):

```tsx
            {items.fields.map((field, index) => (
              <ItemRow
                key={field.id}
                index={index}
                control={control}
                activeProducts={activeProducts}
                setValue={setValue}
                onRemove={() => items.remove(index)}
                showRemove={items.fields.length > 1}
                onCreateProduct={(idx, name) => setCreatingProduct({ index: idx, name })}
                checkoutDateError={
                  errors.items?.[index]?.checkoutDate
                    ? t(errors.items[index]?.checkoutDate?.type === 'custom' ? 'validation.checkoutDateInvalid' : 'validation.checkoutDateRequired')
                    : undefined
                }
                dueDateError={
                  errors.items?.[index]?.dueDate
                    ? t(errors.items[index]?.dueDate?.type === 'custom' ? 'validation.dueDateInvalid' : 'validation.dueDateRequired')
                    : undefined
                }
              />
            ))}
```

Render the inline-create `ProductDrawer` as another sibling of the `Sheet`, alongside `creatingClientName`'s drawer from Task 7:

```tsx
    {creatingProduct && (
      <ProductDrawer
        product={null}
        initialName={creatingProduct.name}
        allowSaveAndAddAnother={false}
        onClose={() => setCreatingProduct(null)}
        onCreated={(newProduct) => {
          setValue(`items.${creatingProduct.index}.productId`, newProduct.id, { shouldDirty: true, shouldValidate: true })
          setValue(`items.${creatingProduct.index}.priceCharged`, newProduct.rentalPrice, { shouldDirty: true })
          setCreatingProduct(null)
        }}
      />
    )}
```

Add the `ProductDrawer` import at the top of the file (alongside `ClientDrawer`'s import):

```tsx
import { ProductDrawer } from '../products/ProductDrawer.tsx'
```

- [ ] **Step 4: Run the existing test suite to see the expected breakage**

Run: `cd client && npx vitest run src/features/contracts/NewContractForm.test.tsx`
Expected: FAIL — every test using `userEvent.selectOptions(screen.getByLabelText(/produto/i), ...)` breaks, same reasoning as Task 7 Step 4. Task 9 fixes this.

- [ ] **Step 5: Manually sanity-check in the running app**

Run: `cd client && npm run dev`, open Contratos → Novo Contrato, add a line item, confirm: the product field opens a searchable list showing size/color per row, typing a name that doesn't exist shows "Criar produto "..."", selecting it opens the full product drawer (no "save and add another" checkbox) prefilled with the typed name, and saving it — after filling category/size/color/price — selects that product back in the item row with `priceCharged` auto-filled from the new product's rental price. Stop the dev server afterward.

- [ ] **Step 6: Commit**

```bash
cd client && git add src/features/contracts/NewContractForm.tsx
git commit -m "feat: contract form product field becomes a searchable combobox with inline create"
```

---

### Task 9: Rewrite and extend `NewContractForm.test.tsx` for the combobox interaction

**Files:**
- Modify: `client/src/features/contracts/NewContractForm.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–8. This task's only job is proving it all works together — no production code changes.

**Note on interaction pattern:** every existing `userEvent.selectOptions(screen.getByLabelText(/cliente/i), 'c1')` becomes a two-step open-then-pick:
```tsx
await userEvent.click(screen.getByLabelText(/cliente/i))
await userEvent.click(await screen.findByRole('option', { name: /Maria Completa/ }))
```
and every `userEvent.selectOptions(screen.getByLabelText(/produto/i), 'p1')` becomes:
```tsx
await userEvent.click(screen.getByLabelText(/produto/i))
await userEvent.click(await screen.findByRole('option', { name: /Vestido Azul/ }))
```
`screen.getByLabelText(/cliente/i)`/`/produto/i` still resolves — the combobox trigger is a `<button aria-label="Cliente">`/`aria-label="Produto"` — no other change needed to locate it.

- [ ] **Step 1: Rewrite every existing test that drives the client/product field**

Replace the full contents of `client/src/features/contracts/NewContractForm.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../i18n.ts'
import { NewContractForm } from './NewContractForm.tsx'
import * as useClientsModule from '../clients/useClients.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useAllocationsModule from '../allocations/useAllocations.ts'
import * as useContractsModule from './useContracts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'
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
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <>{ui}<Toaster /></>
    </QueryClientProvider>,
  )
}

function mockHooks() {
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [readyClient, incompleteClient] } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product] } as never)
  vi.spyOn(useAllocationsModule, 'useProductAvailability').mockReturnValue({ data: { available: true } } as never)
  vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: 's1', name: 'Staff', role: 'staff', locationId: 'l1', locationName: 'Loja', locale: 'pt-BR' },
    isLoadingStaff: false,
    login: vi.fn(),
    logout: vi.fn(),
    isLoggedIn: true,
  } as never)
}

async function pickClient(name: RegExp) {
  await userEvent.click(screen.getByLabelText(/cliente/i))
  await userEvent.click(await screen.findByRole('option', { name }))
}

async function pickProduct(name: RegExp) {
  await userEvent.click(screen.getByLabelText(/produto/i))
  await userEvent.click(await screen.findByRole('option', { name }))
}

describe('NewContractForm', () => {
  it('shows no missing-fields warning for a client with every required field filled', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickClient(/Maria Completa/)
    expect(screen.queryByText(/CPF, RG/)).not.toBeInTheDocument()
  })

  it('shows a missing-fields warning with a completion button for an incomplete client', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickClient(/Joana Incompleta/)
    expect(screen.getByRole('button', { name: /completar cadastro/i })).toBeInTheDocument()
  })

  it('opens ClientDrawer for the selected client when "complete registration" is clicked', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickClient(/Joana Incompleta/)
    await userEvent.click(screen.getByRole('button', { name: /completar cadastro/i }))
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Joana Incompleta')
  })

  it('closes immediately when Cancelar is clicked on an untouched form', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('prompts before discarding a partially filled contract', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes after confirming Descartar', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('prompts instead of closing when the backdrop is clicked with a partially filled contract', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]')!)

    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not prompt on the contract form when the nested client drawer is closed', async () => {
    mockHooks()
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Joana Incompleta/)
    await userEvent.click(screen.getByRole('button', { name: /completar cadastro/i }))
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText('Descartar alterações?')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Novo Contrato' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
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
    mockHooks()
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    const onClose = vi.fn()
    renderWithToast(<NewContractForm onClose={onClose} />)

    await pickClient(/Maria Completa/)
    await userEvent.type(screen.getByLabelText(/data do evento/i), '03102026')
    await pickProduct(/Vestido Azul/)
    await userEvent.type(screen.getByLabelText(/retirada/i), '02102026')
    await userEvent.type(screen.getByLabelText(/devolução/i), '05102026')
    await userEvent.selectOptions(screen.getByLabelText(/forma de pagamento/i), 'PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].paymentMethod).toBe('PIX')
    expect(createImpl.mock.calls[0][0].clientId).toBe('c1')
    expect(createImpl.mock.calls[0][0].locationId).toBeUndefined()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks for confirmation instead of saving immediately when the client is missing required fields', async () => {
    const createImpl = vi.fn().mockResolvedValue(undefined)
    mockHooks()
    vi.spyOn(useContractsModule, 'useCreateContract').mockReturnValue({ mutateAsync: createImpl, isPending: false } as never)
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    await pickClient(/Joana Incompleta/)
    await userEvent.type(screen.getByLabelText(/data do evento/i), '03102026')
    await pickProduct(/Vestido Azul/)
    await userEvent.type(screen.getByLabelText(/retirada/i), '02102026')
    await userEvent.type(screen.getByLabelText(/devolução/i), '05102026')
    await userEvent.selectOptions(screen.getByLabelText(/forma de pagamento/i), 'PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).not.toHaveBeenCalled()
    expect(screen.getByText(/salvar contrato mesmo assim/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /salvar mesmo assim/i }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(createImpl.mock.calls[0][0].clientId).toBe('c2')
  })
})

describe('inline client creation', () => {
  it('creates a client from the typed name and selects it, arming the unsaved-changes guard', async () => {
    mockHooks()
    const onClose = vi.fn()
    const created: Client = {
      id: 'c-new', name: 'Cliente Novo', phone: '', email: '', notes: '',
      identityDocuments: [], addressLines: [], hasAllocationHistory: false, createdAt: '2026-07-31',
    }
    const createImpl = vi.fn().mockResolvedValue(created)
    vi.spyOn(useClientsModule, 'useCreateClient').mockReturnValue({ mutateAsync: createImpl } as never)
    renderWithToast(<NewContractForm onClose={onClose} />)

    await userEvent.click(screen.getByLabelText(/cliente/i))
    await userEvent.type(screen.getByRole('searchbox'), 'Cliente Novo')
    await userEvent.click(screen.getByRole('option', { name: /Criar cliente "Cliente Novo"/ }))

    expect(screen.getByRole('dialog', { name: 'Novo cliente' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Cliente Novo')

    await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Novo cliente' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/cliente/i)).toHaveTextContent('Cliente Novo')

    // The just-created client has no CPF/RG/address on file — the readiness
    // gate this feature exists to protect must still catch that.
    expect(screen.getByRole('button', { name: /completar cadastro/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Descartar alterações?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('inline product creation', () => {
  it('creates a product from the typed name, selects it in the item row, and fills its price', async () => {
    mockHooks()
    const created = {
      id: 'p-new', locationId: 'l1', name: 'Vestido Novo', category: 'festa', size: 'G', color: 'rosa',
      rentalPrice: 250, depositAmount: 0, photos: [], status: 'active' as const, availability: 'available' as const,
      hasAllocationHistory: false, createdAt: '2026-07-31',
    }
    const createImpl = vi.fn().mockResolvedValue(created)
    vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({ mutateAsync: createImpl } as never)
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    await userEvent.click(screen.getByLabelText(/produto/i))
    await userEvent.type(screen.getByRole('searchbox'), 'Vestido Novo')
    await userEvent.click(screen.getByRole('option', { name: /Criar produto "Vestido Novo"/ }))

    expect(screen.getByRole('dialog', { name: 'Novo produto' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Novo')
    expect(screen.queryByLabelText('Salvar e adicionar outro')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Categoria'), 'festa')
    await userEvent.type(screen.getByLabelText('Tamanho'), 'G')
    await userEvent.type(screen.getByLabelText('Cor'), 'rosa')
    await userEvent.clear(screen.getByLabelText('Preço do aluguel'))
    await userEvent.type(screen.getByLabelText('Preço do aluguel'), '25000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(createImpl).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Novo produto' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/produto/i)).toHaveTextContent('Vestido Novo')
    expect((screen.getByLabelText(/valor/i) as HTMLInputElement).value).toContain('250,00')
  })
})

describe('pricing', () => {
  it("fills the charged price with the product's rental price when a piece is picked", async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)

    await pickProduct(/Vestido Azul/)

    // Intl formats currency with a non-breaking space, so compare on the number.
    expect((screen.getByLabelText(/valor/i) as HTMLInputElement).value).toContain('100,00')
  })

  it('leaves an operator-typed price alone and totals what is actually charged', async () => {
    mockHooks()
    renderWithToast(<NewContractForm onClose={vi.fn()} />)
    await pickProduct(/Vestido Azul/)

    const priceField = screen.getByLabelText(/valor/i)
    await userEvent.clear(priceField)
    await userEvent.type(priceField, '8000')

    expect(screen.getByText(/total das peças/i).parentElement).toHaveTextContent('R$ 80,00')
  })
})
```

- [ ] **Step 2: Run the full rewritten test file**

Run: `cd client && npx vitest run src/features/contracts/NewContractForm.test.tsx`
Expected: PASS

- [ ] **Step 3: Run the full client test suite for a final regression check**

Run: `cd client && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd client && git add src/features/contracts/NewContractForm.test.tsx
git commit -m "test: cover the contract form combobox and inline client/product creation"
```

---

## Final Verification

- [ ] Run the entire client suite once more from a clean state: `cd client && npx vitest run`. Expected: PASS, zero skipped/failing tests.
- [ ] Run the type checker (transpile-only Vitest does not catch type errors): check `client/package.json` for a `typecheck`/`tsc` script (e.g. `npm run typecheck` or `npx tsc --noEmit`) and run it. Expected: no new type errors introduced by any task above.
- [ ] Manual walk-through (per the design spec's testing section): open a new contract, type a client name that doesn't exist, create the client inline leaving an address field blank, confirm the readiness banner still catches it before submit, then complete and save the contract — all without leaving the contract sheet.
