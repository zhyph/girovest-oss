# Locale Plumbing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `pt-BR`/`BRL` formatting in `CurrencyInput`, `DateInput`, `PhoneInput`, and several scattered date formatters with locale-driven formatting sourced from `Location.locale`, without changing any current on-screen behavior (only `pt-BR` ships today, so every output stays byte-identical).

**Architecture:** `GET /api/auth/me` starts returning the staff's `Location.locale`. A new `client/src/lib/locale.ts` module holds a registry of per-locale formatter configs (currently just one entry, `'pt-BR'`, containing the exact logic already hardcoded in the three input components). A React Context (`LocaleContext`, not a TanStack Query hook) makes the active locale available to leaf UI components without forcing every existing unwrapped component test to add a `QueryClientProvider` — the context has a default value of `'pt-BR'`, so any component rendered without a `LocaleProvider` behaves exactly as it does today.

**Tech Stack:** Existing stack only — React, `react-i18next`, `Intl`, Vitest, Testing Library, Express, Prisma. No new dependencies.

## Global Constraints

- Every locale-dependent behavior must default to `'pt-BR'` and produce output byte-identical to the current hardcoded implementation — this plan changes *where* formatting logic lives, not what it produces.
- No new npm dependencies.
- Follow existing test conventions exactly: Vitest, `@testing-library/react`, `supertest` for server routes, one `describe` per unit, `vi.fn()`/`vi.spyOn()` for mocks.
- TDD: write the failing test before the implementation in every task.

---

### Task 1: Server — return `locale` from `GET /api/auth/me`

**Files:**
- Modify: `server/src/auth/authRoutes.ts:37-53`
- Test: `server/src/auth/authRoutes.test.ts`

**Interfaces:**
- Consumes: `staff.location.locale` (already loaded via the existing `include: { location: true }`; `Location.locale` already exists in the schema with `@default("pt-BR")`).
- Produces: `GET /api/auth/me` response gains a `locale: string` field, consumed by Task 2.

- [ ] **Step 1: Write the failing test**

In `server/src/auth/authRoutes.test.ts`, inside the existing `describe('GET /api/auth/me', ...)` block, add a new test right after the `'returns the logged-in staff name, role, and location'` test:

```ts
  it('returns the location locale, defaulting to pt-BR', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ login: 'bruno', password: 'correct-horse' })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)

    expect(response.body.locale).toBe('pt-BR')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- authRoutes.test.ts`
Expected: FAIL — `expect(response.body.locale).toBe('pt-BR')` fails because `response.body.locale` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/auth/authRoutes.ts`, change the `/me` handler's response body:

```ts
  res.json({
    id: staff.id,
    name: staff.name,
    role: staff.role,
    locationId: staff.locationId,
    locationName: staff.location.name,
    locale: staff.location.locale,
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- authRoutes.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/authRoutes.ts server/src/auth/authRoutes.test.ts
git commit -m "feat: return location locale from GET /api/auth/me"
```

---

### Task 2: Client — add `locale` to `StaffMe`

**Files:**
- Modify: `client/src/lib/useAuth.ts:7-13`

**Interfaces:**
- Consumes: the `locale` field added to `GET /api/auth/me`'s response in Task 1.
- Produces: `useAuth().staff?.locale: string | undefined`, consumed by Task 4's `LocaleProvider` wiring.

No test needed for this step in isolation — `StaffMe` is a type-only change; `useAuth.ts`'s existing tests mock `apiFetch` with `as never` casts, so they're unaffected, and the field's actual behavior is exercised end-to-end by Task 5's test.

- [ ] **Step 1: Add the field**

In `client/src/lib/useAuth.ts`, change the `StaffMe` interface:

```ts
export interface StaffMe {
  id: string
  name: string
  role: 'owner' | 'staff'
  locationId: string
  locationName: string
  locale: string
}
```

- [ ] **Step 2: Type-check**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (existing test mocks use `as never`, which bypasses the stricter shape).

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/useAuth.ts
git commit -m "feat: add locale to StaffMe"
```

---

### Task 3: Client — locale config registry

**Files:**
- Create: `client/src/lib/locale.ts`
- Test: `client/src/lib/locale.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_LOCALE: string` (`'pt-BR'`)
  - `getLocaleConfig(locale: string | undefined): LocaleConfig`
  - `LocaleConfig` shape: `{ currency: string; date: { formatDigits(digits: string): string; digitsToIso(digits: string): string; isoToDigits(iso: string): string; placeholder: string }; phone: { format(raw: string): string } }`
  - Consumed by Task 4 (`useLocale`), Task 7 (`CurrencyInput`), Task 8 (`DateInput`), Task 9 (`PhoneInput`).

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/locale.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_LOCALE, getLocaleConfig } from './locale.ts'

describe('getLocaleConfig', () => {
  it('returns the pt-BR config for "pt-BR"', () => {
    const config = getLocaleConfig('pt-BR')
    expect(config.currency).toBe('BRL')
  })

  it('falls back to pt-BR for an unregistered locale', () => {
    const config = getLocaleConfig('xx-YY')
    expect(config.currency).toBe('BRL')
  })

  it('falls back to pt-BR for undefined', () => {
    const config = getLocaleConfig(undefined)
    expect(config.currency).toBe('BRL')
  })

  it('DEFAULT_LOCALE is pt-BR', () => {
    expect(DEFAULT_LOCALE).toBe('pt-BR')
  })

  describe('pt-BR date formatting', () => {
    const { date } = getLocaleConfig('pt-BR')

    it('formats digits as a partial DD/MM/AAAA mask while typing', () => {
      expect(date.formatDigits('23')).toBe('23')
      expect(date.formatDigits('2308')).toBe('23/08')
      expect(date.formatDigits('23082026')).toBe('23/08/2026')
    })

    it('converts 8 digits (ddmmyyyy) to an ISO yyyy-mm-dd string', () => {
      expect(date.digitsToIso('23082026')).toBe('2026-08-23')
    })

    it('returns an empty string for fewer than 8 digits', () => {
      expect(date.digitsToIso('230820')).toBe('')
    })

    it('converts an ISO yyyy-mm-dd string back to ddmmyyyy digits', () => {
      expect(date.isoToDigits('2026-08-23')).toBe('23082026')
    })

    it('placeholder is DD/MM/AAAA', () => {
      expect(date.placeholder).toBe('DD/MM/AAAA')
    })
  })

  describe('pt-BR phone formatting', () => {
    const { phone } = getLocaleConfig('pt-BR')

    it('formats an 11-digit mobile number as (DDD) NNNNN-NNNN', () => {
      expect(phone.format('11987654321')).toBe('(11) 98765-4321')
    })

    it('formats a 10-digit landline number as (DDD) NNNN-NNNN', () => {
      expect(phone.format('1132654321')).toBe('(11) 3265-4321')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/locale.test.ts`
Expected: FAIL — `src/lib/locale.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/locale.ts`. This relocates the exact formatting logic currently hardcoded inline in `date-input.tsx` and `phone-input.tsx`, unchanged, so their behavior stays byte-identical after Tasks 8–9 switch to calling it here instead:

```ts
export interface DateMaskConfig {
  formatDigits: (digits: string) => string
  digitsToIso: (digits: string) => string
  isoToDigits: (iso: string) => string
  placeholder: string
}

export interface PhoneMaskConfig {
  format: (raw: string) => string
}

export interface LocaleConfig {
  currency: string
  date: DateMaskConfig
  phone: PhoneMaskConfig
}

function formatDateDigitsBR(digits: string): string {
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  let out = dd
  if (digits.length > 2) out += `/${mm}`
  if (digits.length > 4) out += `/${yyyy}`
  return out
}

function digitsToIsoBR(digits: string): string {
  if (digits.length < 8) return ''
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  return `${yyyy}-${mm}-${dd}`
}

function isoToDigitsBR(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return ''
  const [, yyyy, mm, dd] = match
  return `${dd}${mm}${yyyy}`
}

function formatPhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (digits.length === 0) return ''
  if (digits.length <= 2) return `(${digits}`
  const ddd = digits.slice(0, 2)
  const rest = digits.slice(2)
  if (rest.length <= 4) return `(${ddd}) ${rest}`
  const suffix = rest.slice(-4)
  const prefix = rest.slice(0, -4)
  return `(${ddd}) ${prefix}-${suffix}`
}

export const LOCALE_CONFIGS: Record<string, LocaleConfig> = {
  'pt-BR': {
    currency: 'BRL',
    date: {
      formatDigits: formatDateDigitsBR,
      digitsToIso: digitsToIsoBR,
      isoToDigits: isoToDigitsBR,
      placeholder: 'DD/MM/AAAA',
    },
    phone: {
      format: formatPhoneBR,
    },
  },
}

export const DEFAULT_LOCALE = 'pt-BR'

export function getLocaleConfig(locale: string | undefined): LocaleConfig {
  return LOCALE_CONFIGS[locale ?? DEFAULT_LOCALE] ?? LOCALE_CONFIGS[DEFAULT_LOCALE]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/locale.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/locale.ts client/src/lib/locale.test.ts
git commit -m "feat: add per-locale formatting config registry"
```

---

### Task 4: Client — `LocaleContext` and `useLocale`

**Files:**
- Create: `client/src/lib/LocaleContext.tsx`
- Test: `client/src/lib/LocaleContext.test.tsx`

**Interfaces:**
- Consumes: `getLocaleConfig`, `DEFAULT_LOCALE`, `LocaleConfig` from `./locale.ts` (Task 3).
- Produces:
  - `LocaleProvider({ locale: string; children: ReactNode })` component
  - `useLocale(): { locale: string; config: LocaleConfig }`
  - Consumed by Task 5 (app wiring), Task 6 (`formatDate` callers), Tasks 7–10 (input components, scattered formatters).

A plain React Context (not a `useAuth()`/TanStack Query call) is used deliberately so components that call `useLocale()` keep working when rendered in tests with no provider at all — `useContext` falls back to the context's default value (`'pt-BR'`), matching current hardcoded behavior exactly, with zero changes needed to existing component tests for `CurrencyInput`, `DateInput`, `PhoneInput`, `AgendaView`, `DashboardPage`, or `AllocationsPage`.

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/LocaleContext.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { LocaleProvider, useLocale } from './LocaleContext.tsx'

describe('useLocale', () => {
  it('defaults to pt-BR with no provider', () => {
    const { result } = renderHook(() => useLocale())
    expect(result.current.locale).toBe('pt-BR')
    expect(result.current.config.currency).toBe('BRL')
  })

  it('reads the locale from a wrapping LocaleProvider', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider locale="pt-BR">{children}</LocaleProvider>,
    })
    expect(result.current.locale).toBe('pt-BR')
  })

  it('falls back to the pt-BR config for a locale with no registered config', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider locale="xx-YY">{children}</LocaleProvider>,
    })
    expect(result.current.locale).toBe('xx-YY')
    expect(result.current.config.currency).toBe('BRL')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/LocaleContext.test.tsx`
Expected: FAIL — `src/lib/LocaleContext.tsx` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/LocaleContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_LOCALE, getLocaleConfig } from './locale.ts'

const LocaleContext = createContext<string>(DEFAULT_LOCALE)

export function LocaleProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const locale = useContext(LocaleContext)
  return { locale, config: getLocaleConfig(locale) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/LocaleContext.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/LocaleContext.tsx client/src/lib/LocaleContext.test.tsx
git commit -m "feat: add LocaleContext/useLocale"
```

---

### Task 5: Client — wire `LocaleProvider` and `i18n.changeLanguage` into `App.tsx`

**Files:**
- Modify: `client/src/App.tsx`
- Test: `client/src/App.test.tsx` (new)

**Interfaces:**
- Consumes: `useAuth()` (existing), `LocaleProvider` (Task 4), `i18n` (existing `client/src/i18n.ts` default export).
- Produces: the whole app renders inside a `LocaleProvider` reflecting `staff?.locale`, so Tasks 7–10's `useLocale()` calls pick up the real locale once logged in.

- [ ] **Step 1: Write the failing test**

Create `client/src/App.test.tsx`. It tests the exported `LocaleSync` wrapper directly (not the full `App`/router tree, which adds no relevant coverage here) — mounted with the same `QueryClientProvider`/`MemoryRouter` wrapper `useAuth.test.tsx` already uses, with a probe child reading `useLocale()`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocaleSync } from './App.tsx'
import { useLocale } from './lib/LocaleContext.tsx'
import * as api from './lib/api.ts'
import { setToken, clearToken } from './lib/auth.ts'

function LocaleProbe() {
  const { locale } = useLocale()
  return <span data-testid="locale-probe">{locale}</span>
}

function renderLocaleSync() {
  const queryClient = new QueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <LocaleSync>
          <LocaleProbe />
        </LocaleSync>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('LocaleSync', () => {
  beforeEach(() => {
    clearToken()
    vi.restoreAllMocks()
  })

  it('defaults to pt-BR before a staff is loaded', () => {
    renderLocaleSync()
    expect(screen.getByTestId('locale-probe')).toHaveTextContent('pt-BR')
  })

  it('provides the logged-in staff locale, not the hardcoded default', async () => {
    setToken('existing-token')
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      id: '1',
      name: 'Ana',
      role: 'owner',
      locationId: 'l1',
      locationName: 'Loja',
      locale: 'en-US',
    } as never)

    renderLocaleSync()

    await waitFor(() => expect(screen.getByTestId('locale-probe')).toHaveTextContent('en-US'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/App.test.tsx`
Expected: FAIL — `App.tsx` has no exported `LocaleSync`, so the import fails.

- [ ] **Step 3: Write minimal implementation**

Modify `client/src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { BrowserRouter, HashRouter } from 'react-router'
import { AppRouter } from './app/router.tsx'
import { useAuth } from './lib/useAuth.ts'
import { Toaster } from './components/ui/sonner.tsx'
import { LocaleProvider } from './lib/LocaleContext.tsx'
import { DEFAULT_LOCALE } from './lib/locale.ts'
import i18n from './i18n.ts'

const queryClient = new QueryClient()

const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

function DocumentTitleSync() {
  const { staff } = useAuth()
  useEffect(() => {
    document.title = staff?.locationName ?? i18n.t('common:appName')
  }, [staff?.locationName])
  return null
}

export function LocaleSync({ children }: { children: React.ReactNode }) {
  const { staff } = useAuth()
  const locale = staff?.locale ?? DEFAULT_LOCALE

  useEffect(() => {
    void i18n.changeLanguage(locale)
  }, [locale])

  return <LocaleProvider locale={locale}>{children}</LocaleProvider>
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <DocumentTitleSync />
        <LocaleSync>
          <AppRouter />
        </LocaleSync>
      </Router>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/App.test.tsx`
Expected: PASS. Also run the full client suite to confirm nothing else broke: `cd client && npx vitest run`
Expected: PASS (all existing tests unaffected — `LocaleSync` only adds a wrapping provider and an `i18n.changeLanguage` call that's a no-op today since only `pt-BR` resources are registered).

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/App.test.tsx
git commit -m "feat: wire LocaleProvider and i18n.changeLanguage into App"
```

---

### Task 6: Client — shared `formatDate` helper

**Files:**
- Modify: `client/src/lib/date.ts`
- Modify: `client/src/lib/date.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `formatDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string`, consumed by Task 10.

- [ ] **Step 1: Write the failing test**

Append to `client/src/lib/date.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseDateOnly, formatDate } from './date.ts'

describe('formatDate', () => {
  it('formats a date using the given locale and options', () => {
    const date = new Date(2026, 7, 23)
    expect(formatDate(date, 'pt-BR', { day: '2-digit', month: '2-digit' })).toBe('23/08')
  })

  it('includes the year when asked', () => {
    const date = new Date(2026, 7, 23)
    expect(formatDate(date, 'pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('23/08/2026')
  })
})
```

(Update the existing `import { parseDateOnly } from './date.ts'` line at the top of the file to the combined import shown above instead of duplicating it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/date.test.ts`
Expected: FAIL — `formatDate` is not exported from `date.ts` yet.

- [ ] **Step 3: Write minimal implementation**

Append to `client/src/lib/date.ts`:

```ts
export function formatDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(date)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/date.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/date.ts client/src/lib/date.test.ts
git commit -m "feat: add locale-aware formatDate helper"
```

---

### Task 7: Client — `CurrencyInput` reads locale from `useLocale()`

**Files:**
- Modify: `client/src/components/ui/currency-input.tsx`
- Create: `client/src/components/ui/currency-input.locale-wiring.test.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 4).
- Produces: no change to `CurrencyInput`'s public props (`value`, `onChange`, rest passthrough) — only its internal formatting source changes.

With only one locale registered (`'pt-BR'`), wrapping the component in a real `LocaleProvider locale="pt-BR"` can't produce output that differs from today's hardcoded behavior either way — that wouldn't be a genuine red test. Instead, this uses `vi.mock` to replace `useLocale()` with a stub returning a config the current hardcoded implementation could never produce, in its own file so it doesn't affect `currency-input.test.tsx`'s existing pt-BR-default assertions (`vi.mock` is file-scoped).

- [ ] **Step 1: Write the failing test**

Create `client/src/components/ui/currency-input.locale-wiring.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CurrencyInput } from './currency-input.tsx'

vi.mock('../../lib/LocaleContext.tsx', () => ({
  useLocale: () => ({
    locale: 'en-US',
    config: { currency: 'USD', date: {} as never, phone: {} as never },
  }),
}))

describe('CurrencyInput locale wiring', () => {
  it('formats using the currency/locale from useLocale(), not a hardcoded BRL', () => {
    render(<CurrencyInput value={1234.5} onChange={vi.fn()} aria-label="Preço" />)
    const expected = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1234.5)
    expect(screen.getByLabelText('Preço')).toHaveValue(expected)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/ui/currency-input.locale-wiring.test.tsx`
Expected: FAIL — the current implementation ignores `useLocale()` entirely and still formats as `R$ 1.234,50`, not the expected `$1,234.50`.

- [ ] **Step 3: Write minimal implementation**

Replace `client/src/components/ui/currency-input.tsx`:

```tsx
import { forwardRef, useMemo, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'

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
    const { locale, config } = useLocale()
    const currencyFormatter = useMemo(
      () => new Intl.NumberFormat(locale, { style: 'currency', currency: config.currency }),
      [locale, config.currency],
    )
    const [display, setDisplay] = useState(() => currencyFormatter.format(value))

    useEffect(() => {
      setDisplay(currencyFormatter.format(value))
    }, [value, currencyFormatter])

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

Run: `cd client && npx vitest run src/components/ui/currency-input.locale-wiring.test.tsx src/components/ui/currency-input.test.tsx`
Expected: PASS — both the new locale-wiring test and the original three tests (which rely on the `LocaleContext` default of `'pt-BR'` and are unaffected by the refactor).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/currency-input.tsx client/src/components/ui/currency-input.locale-wiring.test.tsx
git commit -m "refactor: CurrencyInput reads currency/locale from useLocale()"
```

---

### Task 8: Client — `DateInput` reads mask config from `useLocale()`

**Files:**
- Modify: `client/src/components/ui/date-input.tsx`
- Create: `client/src/components/ui/date-input.locale-wiring.test.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 4), `LOCALE_CONFIGS['pt-BR'].date` behavior (Task 3).
- Produces: no change to `DateInput`'s public props.

Same reasoning as Task 7: a real `pt-BR` `LocaleProvider` can't produce a genuine red test with only one registered locale, so this mocks `useLocale()` with a distinguishable stub, in its own file.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/ui/date-input.locale-wiring.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DateInput } from './date-input.tsx'

vi.mock('../../lib/LocaleContext.tsx', () => ({
  useLocale: () => ({
    locale: 'x-TEST',
    config: {
      currency: 'BRL',
      date: {
        formatDigits: () => 'MOCKED-DATE',
        digitsToIso: () => '9999-99-99',
        isoToDigits: () => '',
        placeholder: 'MOCKED',
      },
      phone: {} as never,
    },
  }),
}))

describe('DateInput locale wiring', () => {
  it('formats using the date config from useLocale(), not a hardcoded DD/MM/AAAA mask', () => {
    render(<DateInput value="2026-08-23" onChange={vi.fn()} aria-label="Data" />)
    expect(screen.getByLabelText('Data')).toHaveValue('MOCKED-DATE')
    expect(screen.getByLabelText('Data')).toHaveAttribute('placeholder', 'MOCKED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/ui/date-input.locale-wiring.test.tsx`
Expected: FAIL — the current implementation ignores `useLocale()` entirely and still shows `23/08/2026` with placeholder `DD/MM/AAAA`, not the mocked values.

- [ ] **Step 3: Write minimal implementation**

Replace `client/src/components/ui/date-input.tsx`:

```tsx
import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput({ className, value, onChange, ...props }, ref) {
    const { config } = useLocale()
    const { formatDigits, digitsToIso, isoToDigits, placeholder } = config.date
    const [digits, setDigits] = useState(() => isoToDigits(value))

    useEffect(() => {
      setDigits(isoToDigits(value))
    }, [value, isoToDigits])

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={formatDigits(digits)}
        onChange={(event) => {
          const nextDigits = event.target.value.replace(/\D/g, '').slice(0, 8)
          setDigits(nextDigits)
          onChange(digitsToIso(nextDigits))
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

Run: `cd client && npx vitest run src/components/ui/date-input.locale-wiring.test.tsx src/components/ui/date-input.test.tsx`
Expected: PASS — both the new locale-wiring test and the original tests (unaffected, since they exercise the `LocaleContext` default of `'pt-BR'`, which is byte-identical to the previous hardcoded behavior).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/date-input.tsx client/src/components/ui/date-input.locale-wiring.test.tsx
git commit -m "refactor: DateInput reads mask config from useLocale()"
```

---

### Task 9: Client — `PhoneInput` reads mask config from `useLocale()`

**Files:**
- Modify: `client/src/components/ui/phone-input.tsx`
- Create: `client/src/components/ui/phone-input.locale-wiring.test.tsx`

**Interfaces:**
- Consumes: `useLocale()` (Task 4).
- Produces: no change to `PhoneInput`'s public props.

Same reasoning as Tasks 7–8: mocks `useLocale()` with a distinguishable stub, in its own file.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/ui/phone-input.locale-wiring.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PhoneInput } from './phone-input.tsx'

vi.mock('../../lib/LocaleContext.tsx', () => ({
  useLocale: () => ({
    locale: 'x-TEST',
    config: {
      currency: 'BRL',
      date: {} as never,
      phone: { format: () => 'MOCKED-PHONE' },
    },
  }),
}))

describe('PhoneInput locale wiring', () => {
  it('formats using the phone config from useLocale(), not a hardcoded BR mask', () => {
    render(<PhoneInput value="11987654321" onChange={vi.fn()} aria-label="Telefone" />)
    expect(screen.getByLabelText('Telefone')).toHaveValue('MOCKED-PHONE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/ui/phone-input.locale-wiring.test.tsx`
Expected: FAIL — the current implementation ignores `useLocale()` entirely and still shows `(11) 98765-4321`, not `MOCKED-PHONE`.

- [ ] **Step 3: Write minimal implementation**

Replace `client/src/components/ui/phone-input.tsx`:

```tsx
import { forwardRef, useState, useEffect, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string
  onChange: (value: string) => void
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ className, value, onChange, ...props }, ref) {
    const { config } = useLocale()
    const { format } = config.phone
    const [display, setDisplay] = useState(() => format(value))

    useEffect(() => {
      setDisplay(format(value))
    }, [value, format])

    return (
      <input
        ref={ref}
        type="tel"
        inputMode="tel"
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

Run: `cd client && npx vitest run src/components/ui/phone-input.locale-wiring.test.tsx src/components/ui/phone-input.test.tsx`
Expected: PASS — both the new locale-wiring test and the original tests (unaffected, since they exercise the `LocaleContext` default of `'pt-BR'`).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/phone-input.tsx client/src/components/ui/phone-input.locale-wiring.test.tsx
git commit -m "refactor: PhoneInput reads mask config from useLocale()"
```

---

### Task 10: Client — replace scattered `Intl.DateTimeFormat('pt-BR', ...)` call sites with `formatDate` + `useLocale()`

**Files:**
- Modify: `client/src/features/calendar/AgendaView.tsx:36`
- Modify: `client/src/features/dashboard/DashboardPage.tsx:10,78`
- Modify: `client/src/features/allocations/AllocationsPage.tsx:21,195-196`
- Test: `client/src/features/calendar/AgendaView.test.tsx`, `client/src/features/dashboard/DashboardPage.test.tsx` (existing files — extend), `client/src/features/allocations/AllocationsPage.test.tsx` (existing file — extend)

**Interfaces:**
- Consumes: `formatDate` (Task 6), `useLocale()` (Task 4).
- Produces: no change to any component's public props; output stays byte-identical for `pt-BR` since `useLocale()` defaults to it with no provider.

This task touches three files with the same mechanical change, so all three are done together under one test-verify-commit cycle rather than split into three tasks — there's no meaningful boundary a reviewer would want to approve independently between them.

- [ ] **Step 1: Confirm existing tests already cover the rendered date strings**

Read `client/src/features/calendar/AgendaView.test.tsx`, `client/src/features/dashboard/DashboardPage.test.tsx`, and `client/src/features/allocations/AllocationsPage.test.tsx` — each already asserts on rendered `DD/MM` or `DD/MM/YYYY` text via the current hardcoded formatter (e.g. `AllocationsPage.test.tsx` renders allocations with dates like `'2026-08-01'` and the UI shows `01/08/2026`). No new test is needed to prove behavior is preserved — the existing assertions are the regression guard for this refactor. Confirm this by running the three suites before making any change:

Run: `cd client && npx vitest run src/features/calendar/AgendaView.test.tsx src/features/dashboard/DashboardPage.test.tsx src/features/allocations/AllocationsPage.test.tsx`
Expected: PASS (baseline, before the refactor).

- [ ] **Step 2: Refactor `AgendaView.tsx`**

In `client/src/features/calendar/AgendaView.tsx`, remove the module-level formatter and call `formatDate` inside the component with `useLocale()`:

```tsx
import { useTranslation } from 'react-i18next'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import type { Allocation } from '../allocations/allocationSchemas.ts'
```

Remove the line `const formatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })` from module scope. Inside `AgendaView`'s component body, add:

```tsx
  const { t } = useTranslation('calendarScreen')
  const { locale } = useLocale()
```

(replacing the existing `const { t } = useTranslation('calendarScreen')` line — keep it, just add the `useLocale()` line next to it). Then change the render site at line 68:

```tsx
              <span className="text-muted-text">{formatDate(parseDateOnly(allocation[dateField]), locale, { day: '2-digit', month: '2-digit' })}</span>
```

- [ ] **Step 3: Refactor `DashboardPage.tsx`**

In `client/src/features/dashboard/DashboardPage.tsx`, update imports:

```tsx
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardBody } from '../../components/ui/card.tsx'
import CountUp from '../../components/CountUp.tsx'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { useDashboard } from './useDashboard.ts'
```

Remove the module-level `const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })`. Inside `DashboardPage`'s component body, add `const { locale } = useLocale()` next to the existing hook calls. Change the render site at line 78:

```tsx
                      <span className="text-muted-text">{formatDate(parseDateOnly(allocation.checkoutDate), locale, { day: '2-digit', month: '2-digit' })}</span>
```

- [ ] **Step 4: Refactor `AllocationsPage.tsx`**

In `client/src/features/allocations/AllocationsPage.tsx`, update imports:

```tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { Modal } from '../../components/ui/modal.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { parseDateOnly, formatDate } from '../../lib/date.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import {
  useAllocationsList,
  useCheckOutAllocation,
  useReturnAllocation,
  useCancelAllocation,
} from './useAllocations.ts'
import { NewAllocationForm } from './NewAllocationForm.tsx'
import type { Allocation } from './allocationSchemas.ts'
```

Remove the module-level `const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })`. Inside `AllocationsPage`'s component body, add `const { locale } = useLocale()` next to its existing `useTranslation`/`useAllocationsList` calls. Change the render site at lines 195-196:

```tsx
                {formatDate(parseDateOnly(allocation.checkoutDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })} –{' '}
                {formatDate(parseDateOnly(allocation.dueDate), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
```

- [ ] **Step 5: Run tests to verify nothing broke**

Run: `cd client && npx vitest run src/features/calendar/AgendaView.test.tsx src/features/dashboard/DashboardPage.test.tsx src/features/allocations/AllocationsPage.test.tsx`
Expected: PASS — identical output to Step 1's baseline.

Then run the full client suite as a final check for this whole plan:

Run: `cd client && npx vitest run`
Expected: PASS, all files.

Also run the full server suite, since Task 1 touched the server:

Run: `cd server && npm test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add client/src/features/calendar/AgendaView.tsx client/src/features/dashboard/DashboardPage.tsx client/src/features/allocations/AllocationsPage.tsx
git commit -m "refactor: replace scattered hardcoded pt-BR date formatters with formatDate + useLocale()"
```

---

## Plan complete

After Task 10, every currently-hardcoded `pt-BR`/`BRL` formatting call site in the app (`CurrencyInput`, `DateInput`, `PhoneInput`, `AgendaView`, `DashboardPage`, `AllocationsPage`, plus `GET /api/auth/me`) is locale-driven, defaulting to and producing byte-identical output to `pt-BR` today. `MonthView`'s `culture="pt-BR"` is intentionally left untouched per the design doc — it needs an actual `react-big-calendar` locale pack per language, which doesn't exist for anything but `pt-BR` yet.

This unblocks the next plan in the sequence (client identity documents & address lines), which reuses this plan's `LOCALE_CONFIGS`/`useLocale()` pattern for the CPF/RG mask registry.
