# Dress Store Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React/TypeScript frontend for the dress-store rental app — a single-page app served both as a hosted web app and wrapped in Electron — covering login, dashboard, clients, products, allocations, and calendar screens against the already-built Express/Prisma REST API.

**Architecture:** `client/` is a new npm-workspace package alongside the existing `server/`. It's a Vite + React + TypeScript SPA styled with Tailwind CSS v4 + hand-written shadcn-style primitives, using TanStack Query for all server data, react-hook-form + zod for forms, react-i18next for pt-BR strings, and `react-router` for navigation. `electron-vite` wraps the same renderer for the desktop build, whose main process spawns the existing `server/` as a child process. One task (Task 1) closes two real gaps in the merged backend that this plan depends on: a CORS-enabled dev/Electron origin and a list endpoint for allocations.

**Tech Stack:** React 19, TypeScript, Vite 7, Tailwind CSS v4 (`@tailwindcss/vite`), TanStack Query v5, react-hook-form + `@hookform/resolvers/zod`, react-i18next, react-router v7 (declarative mode), react-big-calendar + date-fns, lucide-react, electron-vite, Vitest + React Testing Library, Playwright.

## Global Constraints

- Package manager: npm (matches `server/`). Do not pin dependency versions by hand in `package.json` — install via `npm install <package>` and let npm resolve/record the current version.
- All UI strings go through `react-i18next` translation keys (`t('namespace:key')`) — never hardcode Portuguese or English text directly in JSX, per the spec's i18n requirement.
- All relative TypeScript imports use explicit `.js`/`.tsx` extensions is **not** required in `client/` — the client uses Vite's bundler module resolution (`moduleResolution: "bundler"`), unlike `server/`'s NodeNext. Do not copy the server's `.js`-suffix import habit into `client/`.
- Currency and dates are formatted via `Intl.NumberFormat`/`Intl.DateTimeFormat` with the active i18n locale — never hand-rolled string formatting (per the whole-app i18n design).
- Every screen-level component test uses React Testing Library queries by role/label text, not test IDs, and mocks the API client module — never a real network call.
- Run `npm test` (client workspace) after every task; run `npm run build` (client workspace, `tsc -b && vite build`) before the final commit of every task to catch type errors, since Vitest alone doesn't type-check JSX prop mismatches by default.

---

## File Structure

```
dress-store-app/
  package.json                     # NEW — root workspaces
  server/                          # existing, modified in Task 1 only
    src/app.ts                     # MODIFY — add cors()
    src/routes/allocations.ts      # MODIFY — add GET /
    src/services/allocationService.ts  # MODIFY — add listAllocations()
  client/                          # NEW — everything below is new
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      index.css
      i18n.ts
      lib/
        api.ts                    # fetch wrapper, ApiError, auth header
        auth.ts                   # token storage + useAuth hook
        cn.ts                     # clsx + tailwind-merge helper
      components/ui/
        button.tsx
        input.tsx
        card.tsx
      app/
        router.tsx
        ProtectedRoute.tsx
        AppLayout.tsx
        Sidebar.tsx
      features/
        auth/LoginPage.tsx
        dashboard/DashboardPage.tsx
        clients/
          clientSchemas.ts
          useClients.ts
          ClientsPage.tsx
          ClientDrawer.tsx
        products/
          productSchemas.ts
          useProducts.ts
          ProductsPage.tsx
          ProductDrawer.tsx
        allocations/
          allocationSchemas.ts
          useAllocations.ts
          AllocationsPage.tsx
          NewAllocationForm.tsx
        calendar/
          useCalendar.ts
          CalendarPage.tsx
          AgendaView.tsx
          MonthView.tsx
      locales/pt-BR/
        common.json
        auth.json
        clients.json
        products.json
        allocations.json
        calendar.json
    electron/
      main.ts
      preload.ts
    electron.vite.config.ts
    e2e/
      happy-path.spec.ts
    playwright.config.ts
```

---

### Task 1: Backend prerequisites — CORS and an allocations list endpoint

The Allocations screen (Task 11) needs a way to list all allocations, and the frontend spec's product-picker range check needs the browser to be able to reach the API cross-origin at all. Neither exists on the merged backend today: there's no `GET /api/allocations`, and there's no CORS middleware, so a browser page served from Vite's dev server (port 5173) or an Electron renderer cannot call the API on port 3000 — the browser blocks it as a cross-origin request before the frontend code ever runs.

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/services/allocationService.ts`
- Modify: `server/src/routes/allocations.ts`
- Test: `server/src/auth/authRoutes.test.ts` (CORS header check, since it's an app-wide concern)
- Test: `server/src/services/allocationService.test.ts`

**Interfaces:**
- Produces: `listAllocations(): Promise<Allocation[]>` in `allocationService.ts` — all allocations ordered by `createdAt desc`. `GET /api/allocations` (auth-required) returns this array as JSON.
- Produces: every response from the Express app now carries `Access-Control-Allow-Origin: *`.

- [ ] **Step 1: Write the failing test for CORS**

In `server/src/auth/authRoutes.test.ts`, add at the bottom of the file (new top-level `describe`, after the existing `describe('GET /api/auth/me', ...)` block):

```typescript
describe('CORS', () => {
  it('allows cross-origin requests', async () => {
    const response = await request(app).get('/health')
    expect(response.headers['access-control-allow-origin']).toBe('*')
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd server && npm test -- authRoutes.test.ts
```
Expected: FAIL — `access-control-allow-origin` header is `undefined`.

- [ ] **Step 3: Install `cors` and wire it into the app**

```bash
cd server && npm install cors && npm install --save-dev @types/cors
```

In `server/src/app.ts`, add the import and middleware (must run before the routers):

```typescript
import cors from 'cors'
```

```typescript
export const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(express.json())
```

- [ ] **Step 4: Run the CORS test, confirm it passes**

```bash
npm test -- authRoutes.test.ts
```
Expected: PASS.

- [ ] **Step 5: Write the failing test for `listAllocations`**

In `server/src/services/allocationService.test.ts`, import `listAllocations` alongside the existing imports and add a test inside the `describe('allocationService', ...)` block (near the other availability tests):

```typescript
import {
  createAllocation,
  checkOutAllocation,
  returnAllocation,
  cancelAllocation,
  getProductAvailability,
  isProductAvailableForRange,
  listAllocations,
} from './allocationService.js'
```

```typescript
it('lists all allocations, newest first', async () => {
  const first = await createAllocation({
    productId, clientId, staffId,
    checkoutDate: new Date('2026-09-01'),
    dueDate: new Date('2026-09-05'),
    priceCharged: 100,
  })
  await cancelAllocation(first.id)
  const second = await createAllocation({
    productId, clientId, staffId,
    checkoutDate: new Date('2026-10-01'),
    dueDate: new Date('2026-10-05'),
    priceCharged: 100,
  })

  const all = await listAllocations()
  expect(all.map((a) => a.id)).toEqual([second.id, first.id])
})
```

- [ ] **Step 6: Run it, confirm it fails**

```bash
npm test -- allocationService.test.ts
```
Expected: FAIL — `listAllocations is not a function`.

- [ ] **Step 7: Implement `listAllocations`**

In `server/src/services/allocationService.ts`, add near `getProductAvailability`:

```typescript
export async function listAllocations() {
  return prisma.allocation.findMany({ orderBy: { createdAt: 'desc' } })
}
```

- [ ] **Step 8: Run the service test, confirm it passes**

```bash
npm test -- allocationService.test.ts
```
Expected: PASS.

- [ ] **Step 9: Add the route**

In `server/src/routes/allocations.ts`, add `listAllocations` to the import from `'../services/allocationService.js'`, and add the route right after `allocationsRouter.use(requireAuth)`:

```typescript
allocationsRouter.get('/', async (_req, res) => {
  res.json(await listAllocations())
})
```

- [ ] **Step 10: Type-check and run the full server test suite**

```bash
npx tsc --noEmit -p tsconfig.json && npm test
```
Expected: `tsc` clean, all tests pass (50/50: 47 existing + 3 new).

- [ ] **Step 11: Commit**

```bash
git add server/src/app.ts server/src/services/allocationService.ts server/src/services/allocationService.test.ts server/src/routes/allocations.ts server/src/auth/authRoutes.test.ts
git commit -m "Add CORS and a GET /api/allocations list endpoint

The frontend plan needs both: CORS so the browser-served SPA (dev
server or Electron renderer) can reach the API cross-origin at all,
and a list endpoint so the Allocations screen has something to render."
```

---

### Task 2: Root workspace and client scaffold

**Files:**
- Create: `package.json` (root)
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/index.css`
- Test: `client/src/App.test.tsx`

**Interfaces:**
- Produces: an `npm test`/`npm run build`/`npm run dev` script set in `client/package.json` that every later task relies on.

- [ ] **Step 1: Root workspace manifest**

Create `package.json` at the repo root:

```json
{
  "name": "dress-store-app",
  "private": true,
  "workspaces": [
    "server",
    "client"
  ]
}
```

- [ ] **Step 2: Client package manifest**

Create `client/package.json`:

```json
{
  "name": "dress-store-client",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Install base tooling**

```bash
cd client
npm install react react-dom
npm install --save-dev typescript vite @vitejs/plugin-react @types/react @types/react-dom vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 4: `tsconfig.json`**

Create `client/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: `vite.config.ts`**

Create `client/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
})
```

Create `client/src/setupTests.ts`:

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 6: `index.html` and entry point**

Create `client/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ateliê</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `client/src/index.css`:

```css
:root {
  color-scheme: light;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}
```

Create `client/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 7: Write the failing smoke test**

Create `client/src/App.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App.tsx'

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
    expect(screen.getByText('Ateliê')).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Run it, confirm it fails**

```bash
cd client && npm test
```
Expected: FAIL — `App.tsx` doesn't exist yet.

- [ ] **Step 9: Minimal `App.tsx`**

Create `client/src/App.tsx`:

```tsx
export function App() {
  return <div>Ateliê</div>
}
```

- [ ] **Step 10: Run it, confirm it passes**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add package.json client/package.json client/package-lock.json client/tsconfig.json client/vite.config.ts client/index.html client/src
git commit -m "Scaffold client workspace (Vite + React + TS + Vitest)"
```

---

### Task 3: Design tokens and base UI primitives

**Files:**
- Modify: `client/vite.config.ts`
- Modify: `client/src/index.css`
- Create: `client/src/lib/cn.ts`
- Create: `client/src/components/ui/button.tsx`
- Create: `client/src/components/ui/input.tsx`
- Create: `client/src/components/ui/card.tsx`
- Test: `client/src/components/ui/button.test.tsx`

**Interfaces:**
- Produces: `cn(...classNames: (string | false | null | undefined)[]): string`
- Produces: `<Button variant="primary" | "secondary" | "ghost" size="sm" | "md" | "icon">`, `<Input>`, `<Card>`, `<CardHeader>`, `<CardBody>` — all later screens compose these.

- [ ] **Step 1: Install Tailwind v4, clsx, tailwind-merge, lucide-react**

```bash
cd client
npm install clsx tailwind-merge lucide-react
npm install tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Wire the Tailwind Vite plugin**

In `client/vite.config.ts`, add the import and plugin:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
})
```

- [ ] **Step 3: Define the warm-boutique theme tokens**

Replace `client/src/index.css` entirely with:

```css
@import "tailwindcss";

@theme {
  --color-brand-50: #fbf0ec;
  --color-brand-100: #f5dcd2;
  --color-brand-300: #e3ab93;
  --color-brand-500: #c97c5d;
  --color-brand-600: #b0643f;
  --color-brand-700: #8f4e30;

  --color-cream: #fdf8f3;
  --color-ink: #3a2e28;
  --color-muted: #8a7a70;
  --color-border-soft: #ead9cd;

  --radius-md: 0.625rem;
  --radius-lg: 0.875rem;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background-color: var(--color-cream);
  color: var(--color-ink);
}
```

- [ ] **Step 4: `cn` helper**

Create `client/src/lib/cn.ts`:

```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: Write the failing test for `Button`**

Create `client/src/components/ui/button.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button.tsx'

describe('Button', () => {
  it('renders its children and responds to clicks', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Salvar</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('disables the button when disabled is true', () => {
    render(<Button disabled>Salvar</Button>)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })
})
```

- [ ] **Step 6: Run it, confirm it fails**

```bash
npm test -- button.test.tsx
```
Expected: FAIL — `button.tsx` doesn't exist.

- [ ] **Step 7: Implement `Button`, `Input`, `Card`**

Create `client/src/components/ui/button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'icon'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600',
  secondary: 'bg-white text-ink border border-border-soft hover:bg-brand-50',
  ghost: 'bg-transparent text-ink hover:bg-brand-50',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  icon: 'h-10 w-10 p-0',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  )
}
```

Create `client/src/components/ui/input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-md border border-border-soft bg-white px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-300',
          className,
        )}
        {...props}
      />
    )
  },
)
```

Create `client/src/components/ui/card.tsx`:

```tsx
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border-soft bg-white shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-border-soft p-4', className)} {...props} />
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}
```

- [ ] **Step 8: Run the test, confirm it passes**

```bash
npm test -- button.test.tsx
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/vite.config.ts client/src/index.css client/src/lib/cn.ts client/src/components client/package.json client/package-lock.json
git commit -m "Add Tailwind v4 warm-boutique theme and base UI primitives"
```

---

### Task 4: API client, auth token storage, TanStack Query provider

**Files:**
- Create: `client/src/lib/api.ts`
- Create: `client/src/lib/auth.ts`
- Modify: `client/src/main.tsx`
- Modify: `client/src/App.tsx`
- Test: `client/src/lib/api.test.ts`
- Test: `client/src/lib/auth.test.ts`

**Interfaces:**
- Produces: `class ApiError extends Error { code: string; status: number }`
- Produces: `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — prefixes `API_BASE_URL`, attaches `Authorization` from `getToken()`, throws `ApiError` on non-2xx, clears the token and dispatches a `'auth:logout'` window event on 401.
- Produces: `getToken(): string | null`, `setToken(token: string): void`, `clearToken(): void` in `lib/auth.ts`.
- Consumes (later tasks): every `features/*/use*.ts` hook calls `apiFetch`.

- [ ] **Step 1: Install TanStack Query**

```bash
cd client && npm install @tanstack/react-query
```

- [ ] **Step 2: Write the failing tests for `auth.ts`**

Create `client/src/lib/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getToken, setToken, clearToken } from './auth.ts'

describe('auth token storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('stores and retrieves a token', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
  })

  it('clears a stored token', () => {
    setToken('abc123')
    clearToken()
    expect(getToken()).toBeNull()
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
npm test -- auth.test.ts
```
Expected: FAIL — `auth.ts` doesn't exist.

- [ ] **Step 4: Implement `auth.ts`**

Create `client/src/lib/auth.ts`:

```typescript
const TOKEN_KEY = 'dress-store-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}
```

- [ ] **Step 5: Run it, confirm it passes**

```bash
npm test -- auth.test.ts
```
Expected: PASS.

- [ ] **Step 6: Write the failing tests for `api.ts`**

Create `client/src/lib/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiFetch, ApiError } from './api.ts'
import { setToken, getToken } from './auth.ts'

describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches the Authorization header when a token exists', async () => {
    setToken('my-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    await apiFetch('/api/clients')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer my-token')
  })

  it('throws ApiError with the backend code and message on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Invalid payload' }), {
        status: 400,
      }),
    )

    await expect(apiFetch('/api/clients')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid payload',
    })
  })

  it('clears the token on a 401 response', async () => {
    setToken('stale-token')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Invalid token' }), {
        status: 401,
      }),
    )

    await expect(apiFetch('/api/clients')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
  })
})
```

- [ ] **Step 7: Run it, confirm it fails**

```bash
npm test -- api.test.ts
```
Expected: FAIL — `api.ts` doesn't exist.

- [ ] **Step 8: Implement `api.ts`**

Create `client/src/lib/api.ts`:

```typescript
import { getToken, clearToken } from './auth.ts'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })

  if (response.status === 204) {
    return undefined as T
  }

  const body = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      clearToken()
      window.dispatchEvent(new Event('auth:logout'))
    }
    throw new ApiError(body.code ?? 'UNKNOWN', response.status, body.message ?? 'Request failed')
  }

  return body as T
}
```

- [ ] **Step 9: Run it, confirm it passes**

```bash
npm test -- api.test.ts
```
Expected: PASS.

- [ ] **Step 10: Wire the TanStack Query provider**

Modify `client/src/App.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div>Ateliê</div>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 11: Run the full test suite, confirm nothing broke**

```bash
npm test
```
Expected: PASS (App smoke test still finds "Ateliê").

- [ ] **Step 12: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/lib client/src/App.tsx client/package.json client/package-lock.json
git commit -m "Add API client with auth-aware fetch wrapper and TanStack Query provider"
```

---

### Task 5: i18n setup (pt-BR)

**Files:**
- Create: `client/src/i18n.ts`
- Create: `client/src/locales/pt-BR/common.json`
- Create: `client/src/locales/pt-BR/auth.json`
- Modify: `client/src/main.tsx`
- Test: `client/src/i18n.test.ts`

**Interfaces:**
- Produces: importing `./i18n.ts` initializes i18next as a side effect; `useTranslation('common')` (or any registered namespace) becomes available everywhere after that import runs.
- Namespaces registered now: `common`, `auth`. Later tasks add `clients`, `products`, `allocations`, `calendar` namespace files the same way.

- [ ] **Step 1: Install i18next**

```bash
cd client && npm install i18next react-i18next
```

- [ ] **Step 2: Write the locale resource files**

Create `client/src/locales/pt-BR/common.json`:

```json
{
  "appName": "Ateliê",
  "nav": {
    "dashboard": "Painel",
    "clients": "Clientes",
    "products": "Produtos",
    "allocations": "Alocações",
    "calendar": "Calendário"
  },
  "actions": {
    "save": "Salvar",
    "cancel": "Cancelar",
    "edit": "Editar",
    "delete": "Excluir",
    "create": "Novo"
  },
  "errors": {
    "UNKNOWN": "Algo deu errado. Tente novamente."
  }
}
```

Create `client/src/locales/pt-BR/auth.json`:

```json
{
  "loginTitle": "Entrar",
  "loginField": "Usuário",
  "passwordField": "Senha",
  "submit": "Entrar",
  "errors": {
    "INVALID_CREDENTIALS": "Usuário ou senha inválidos."
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `client/src/i18n.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import i18n from './i18n.ts'

describe('i18n', () => {
  it('initializes with pt-BR as the active language', () => {
    expect(i18n.language).toBe('pt-BR')
  })

  it('resolves a key from the common namespace', () => {
    expect(i18n.t('common:appName')).toBe('Ateliê')
  })
})
```

- [ ] **Step 4: Run it, confirm it fails**

```bash
npm test -- i18n.test.ts
```
Expected: FAIL — `i18n.ts` doesn't exist.

- [ ] **Step 5: Implement `i18n.ts`**

Create `client/src/i18n.ts`:

```typescript
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/pt-BR/common.json'
import auth from './locales/pt-BR/auth.json'

i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  resources: {
    'pt-BR': { common, auth },
  },
})

export default i18n
```

- [ ] **Step 6: Run it, confirm it passes**

```bash
npm test -- i18n.test.ts
```
Expected: PASS.

- [ ] **Step 7: Import it once, at the app's entry point**

Modify `client/src/main.tsx` to import `./i18n.ts` before `./App.tsx` renders (side-effect import, must run first):

```tsx
import { createRoot } from 'react-dom/client'
import './i18n.ts'
import { App } from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 8: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/i18n.ts client/src/i18n.test.ts client/src/locales client/src/main.tsx client/package.json client/package-lock.json
git commit -m "Add react-i18next setup with pt-BR common and auth namespaces"
```

---

### Task 6: Auth — login screen, `useAuth`, protected routes

**Files:**
- Create: `client/src/features/auth/LoginPage.tsx`
- Create: `client/src/lib/useAuth.ts`
- Create: `client/src/app/ProtectedRoute.tsx`
- Test: `client/src/features/auth/LoginPage.test.tsx`
- Test: `client/src/lib/useAuth.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `lib/api.ts` (Task 4), `setToken`/`getToken`/`clearToken` from `lib/auth.ts` (Task 4).
- Produces: `useAuth(): { staff: StaffMe | undefined; isLoadingStaff: boolean; login(login: string, password: string): Promise<void>; logout(): void; isLoggedIn: boolean }` where `StaffMe = { id: string; name: string; role: 'owner' | 'staff'; locationId: string }`.
- Produces: `<ProtectedRoute>` — a route wrapper that renders `<Navigate to="/login" />` when `isLoggedIn` is false, otherwise renders its children (via `<Outlet />`).
- `useAuth`'s staff query also listens for the `'auth:logout'` window event `apiFetch` dispatches on a 401 (Task 4) and calls `logout()` in response, so an expired token anywhere in the app bounces the user to `/login`.

- [ ] **Step 1: Install react-router**

```bash
cd client && npm install react-router
```

- [ ] **Step 2: Write the failing test for `useAuth`**

Create `client/src/lib/useAuth.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from './useAuth.ts'
import * as api from './api.ts'
import { getToken } from './auth.ts'

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('logs in, stores the token, and reports isLoggedIn', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path) => {
      if (path === '/api/auth/login') return { token: 'new-token' } as never
      if (path === '/api/auth/me') return { id: '1', name: 'Ana', role: 'owner', locationId: 'l1' } as never
      throw new Error('unexpected path')
    })

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(() => result.current.login('ana', 'senha123'))

    expect(getToken()).toBe('new-token')
    await waitFor(() => expect(result.current.isLoggedIn).toBe(true))
    await waitFor(() => expect(result.current.staff?.name).toBe('Ana'))
  })

  it('logs out and clears the token on the auth:logout event', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ id: '1', name: 'Ana', role: 'owner', locationId: 'l1' } as never)
    const { setToken } = await import('./auth.ts')
    setToken('existing-token')

    renderHook(() => useAuth(), { wrapper })
    act(() => window.dispatchEvent(new Event('auth:logout')))

    expect(getToken()).toBeNull()
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
npm test -- useAuth.test.tsx
```
Expected: FAIL — `useAuth.ts` doesn't exist.

- [ ] **Step 4: Implement `useAuth`**

Create `client/src/lib/useAuth.ts`:

```typescript
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api.ts'
import { getToken, setToken, clearToken } from './auth.ts'

export interface StaffMe {
  id: string
  name: string
  role: 'owner' | 'staff'
  locationId: string
}

export function useAuth() {
  const queryClient = useQueryClient()

  const staffQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiFetch<StaffMe>('/api/auth/me'),
    enabled: Boolean(getToken()),
    retry: false,
  })

  useEffect(() => {
    function handleLogout() {
      clearToken()
      queryClient.setQueryData(['auth', 'me'], undefined)
    }
    window.addEventListener('auth:logout', handleLogout)
    return () => window.removeEventListener('auth:logout', handleLogout)
  }, [queryClient])

  async function login(login: string, password: string) {
    const { token } = await apiFetch<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    })
    setToken(token)
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
  }

  function logout() {
    clearToken()
    queryClient.setQueryData(['auth', 'me'], undefined)
  }

  return {
    staff: staffQuery.data,
    isLoadingStaff: staffQuery.isLoading,
    login,
    logout,
    isLoggedIn: Boolean(getToken()),
  }
}
```

- [ ] **Step 5: Run it, confirm it passes**

```bash
npm test -- useAuth.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Write the failing test for `LoginPage`**

Create `client/src/features/auth/LoginPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { LoginPage } from './LoginPage.tsx'
import * as useAuthModule from '../../lib/useAuth.ts'

describe('LoginPage', () => {
  it('submits the entered credentials to login()', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: undefined, isLoadingStaff: false, login, logout: vi.fn(), isLoggedIn: false,
    })

    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(login).toHaveBeenCalledWith('ana', 'senha123')
  })

  it('shows a translated error message when login rejects', async () => {
    const login = vi.fn().mockRejectedValue({ code: 'INVALID_CREDENTIALS', message: 'nope' })
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: undefined, isLoadingStaff: false, login, logout: vi.fn(), isLoggedIn: false,
    })

    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Usuário'), 'ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Usuário ou senha inválidos.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run it, confirm it fails**

```bash
npm test -- LoginPage.test.tsx
```
Expected: FAIL — `LoginPage.tsx` doesn't exist.

- [ ] **Step 8: Implement `LoginPage`**

Create `client/src/features/auth/LoginPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useAuth } from '../../lib/useAuth.ts'

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common'])
  const { login } = useAuth()
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorCode(null)
    try {
      await login(loginValue, password)
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <Card className="w-80">
        <CardHeader>
          <h1 className="text-lg font-semibold">{t('auth:loginTitle')}</h1>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('auth:loginField')}
              <Input value={loginValue} onChange={(e) => setLoginValue(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('auth:passwordField')}
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {errorCode && (
              <p className="text-sm text-red-600">
                {t(`auth:errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN') })}
              </p>
            )}
            <Button type="submit">{t('auth:submit')}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
```

- [ ] **Step 9: Run it, confirm it passes**

```bash
npm test -- LoginPage.test.tsx
```
Expected: PASS.

- [ ] **Step 10: Implement `ProtectedRoute`**

Create `client/src/app/ProtectedRoute.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../lib/useAuth.ts'

export function ProtectedRoute() {
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
```

- [ ] **Step 11: Run the full client test suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/features/auth client/src/lib/useAuth.ts client/src/lib/useAuth.test.tsx client/src/app/ProtectedRoute.tsx client/package.json client/package-lock.json
git commit -m "Add login screen, useAuth hook, and route protection"
```

---

### Task 7: App shell — router, sidebar nav, staff name

**Files:**
- Create: `client/src/app/router.tsx`
- Create: `client/src/app/AppLayout.tsx`
- Create: `client/src/app/Sidebar.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/locales/pt-BR/common.json` (already has `nav` keys from Task 5 — no change needed)
- Test: `client/src/app/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 6) for `staff.name` and `logout()`.
- Produces: five route paths mounted under `<ProtectedRoute>`: `/` (dashboard), `/clientes`, `/produtos`, `/alocacoes`, `/calendario`, plus a public `/login`. Later tasks (8–12) each fill in the element for one of these paths — this task renders an empty placeholder `<div>` for each so the routing/layout can be tested independently of the screens.

- [ ] **Step 1: Write the failing test for `Sidebar`**

Create `client/src/app/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import '../i18n.ts'
import { Sidebar } from './Sidebar.tsx'
import * as useAuthModule from '../lib/useAuth.ts'

describe('Sidebar', () => {
  it('shows the nav links and the logged-in staff name', () => {
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      staff: { id: '1', name: 'Ana Owner', role: 'owner', locationId: 'l1' },
      isLoadingStaff: false,
      login: vi.fn(),
      logout: vi.fn(),
      isLoggedIn: true,
    })

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Painel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Produtos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alocações' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Calendário' })).toBeInTheDocument()
    expect(screen.getByText('Ana Owner')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd client && npm test -- Sidebar.test.tsx
```
Expected: FAIL — `Sidebar.tsx` doesn't exist.

- [ ] **Step 3: Implement `Sidebar`**

Create `client/src/app/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Users, Shirt, ClipboardList, Calendar } from 'lucide-react'
import { useAuth } from '../lib/useAuth.ts'
import { cn } from '../lib/cn.ts'

const links = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/clientes', labelKey: 'nav.clients', icon: Users },
  { to: '/produtos', labelKey: 'nav.products', icon: Shirt },
  { to: '/alocacoes', labelKey: 'nav.allocations', icon: ClipboardList },
  { to: '/calendario', labelKey: 'nav.calendar', icon: Calendar },
]

export function Sidebar() {
  const { t } = useTranslation('common')
  const { staff } = useAuth()

  return (
    <nav className="flex h-full w-48 flex-col gap-1 border-r border-border-soft bg-white p-3">
      <div className="mb-3 px-2 text-lg font-semibold text-brand-600">{t('appName')}</div>
      {links.map(({ to, labelKey, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-brand-50',
            )
          }
        >
          <Icon size={18} />
          {t(labelKey)}
        </NavLink>
      ))}
      {staff && <div className="mt-auto px-2 text-xs text-muted">{staff.name}</div>}
    </nav>
  )
}
```

- [ ] **Step 4: Run it, confirm it passes**

```bash
npm test -- Sidebar.test.tsx
```
Expected: PASS.

- [ ] **Step 5: `AppLayout`**

Create `client/src/app/AppLayout.tsx`:

```tsx
import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar.tsx'

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 6: `router.tsx` with placeholder screens**

Create `client/src/app/router.tsx`:

```tsx
import { Routes, Route } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { ProtectedRoute } from './ProtectedRoute.tsx'
import { AppLayout } from './AppLayout.tsx'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<div>Painel</div>} />
          <Route path="/clientes" element={<div>Clientes</div>} />
          <Route path="/produtos" element={<div>Produtos</div>} />
          <Route path="/alocacoes" element={<div>Alocações</div>} />
          <Route path="/calendario" element={<div>Calendário</div>} />
        </Route>
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 7: Wire it into `App.tsx`**

Modify `client/src/App.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { AppRouter } from './app/router.tsx'

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

Update `client/src/App.test.tsx` since the root now redirects to `/login` (no token stored in tests) instead of showing "Ateliê" directly:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../src/i18n.ts'
import { App } from './App.tsx'

describe('App', () => {
  it('renders the login screen when logged out', () => {
    render(<App />)
    // "Entrar" appears both as the page title and the submit button text,
    // so assert on the button specifically rather than getByText (which
    // would throw on finding two matches).
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Run the full suite, confirm everything passes**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/app client/src/App.tsx client/src/App.test.tsx
git commit -m "Add app shell: router, sidebar nav, and layout"
```

---

### Task 8: Dashboard screen

**Files:**
- Create: `client/src/features/dashboard/useDashboard.ts`
- Create: `client/src/features/dashboard/DashboardPage.tsx`
- Create: `client/src/locales/pt-BR/dashboard.json`
- Modify: `client/src/i18n.ts` (register the `dashboard` namespace)
- Modify: `client/src/app/router.tsx` (mount `DashboardPage` at `/`)
- Test: `client/src/features/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 4). Backend shapes used: `GET /api/calendar/going-out?from&to`, `/due-back?from&to`, `/overdue?asOf` — each returns `Allocation[]` per the existing server routes (`server/src/routes/calendar.ts`).
- Produces: `useDashboard(): { goingOutToday: Allocation[]; dueBackToday: Allocation[]; overdue: Allocation[]; isLoading: boolean }`.

- [ ] **Step 1: Locale file**

Create `client/src/locales/pt-BR/dashboard.json`:

```json
{
  "title": "Painel — hoje",
  "goingOutToday": "Saindo hoje",
  "dueBackToday": "Voltando hoje",
  "overdue": "Atrasados"
}
```

Modify `client/src/i18n.ts` to register it:

```typescript
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/pt-BR/common.json'
import auth from './locales/pt-BR/auth.json'
import dashboard from './locales/pt-BR/dashboard.json'

i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  resources: {
    'pt-BR': { common, auth, dashboard },
  },
})

export default i18n
```

- [ ] **Step 2: Write the failing test for `DashboardPage`**

Create `client/src/features/dashboard/DashboardPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { DashboardPage } from './DashboardPage.tsx'
import * as useDashboardModule from './useDashboard.ts'

describe('DashboardPage', () => {
  it('shows the three today counts', () => {
    vi.spyOn(useDashboardModule, 'useDashboard').mockReturnValue({
      goingOutToday: [{ id: '1' }] as never,
      dueBackToday: [] as never,
      overdue: [{ id: '2' }, { id: '3' }] as never,
      isLoading: false,
    })

    render(<DashboardPage />)

    expect(screen.getByText('Saindo hoje')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Atrasados')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
cd client && npm test -- DashboardPage.test.tsx
```
Expected: FAIL — `useDashboard.ts`/`DashboardPage.tsx` don't exist.

- [ ] **Step 4: Implement `useDashboard`**

Create `client/src/features/dashboard/useDashboard.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'

export interface AllocationSummary {
  id: string
  productId: string
  clientId: string
  checkoutDate: string
  dueDate: string
  status: string
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

export function useDashboard() {
  const from = startOfToday().toISOString()
  const to = endOfToday().toISOString()

  const goingOut = useQuery({
    queryKey: ['calendar', 'going-out', from, to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/going-out?from=${from}&to=${to}`),
  })
  const dueBack = useQuery({
    queryKey: ['calendar', 'due-back', from, to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/due-back?from=${from}&to=${to}`),
  })
  const overdue = useQuery({
    queryKey: ['calendar', 'overdue', to],
    queryFn: () => apiFetch<AllocationSummary[]>(`/api/calendar/overdue?asOf=${to}`),
  })

  return {
    goingOutToday: goingOut.data ?? [],
    dueBackToday: dueBack.data ?? [],
    overdue: overdue.data ?? [],
    isLoading: goingOut.isLoading || dueBack.isLoading || overdue.isLoading,
  }
}
```

- [ ] **Step 5: Implement `DashboardPage`**

Create `client/src/features/dashboard/DashboardPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { useDashboard } from './useDashboard.ts'

function StatTile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <Card className={danger && value > 0 ? 'border-red-300 bg-red-50' : undefined}>
      <CardBody>
        <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardBody>
    </Card>
  )
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { goingOutToday, dueBackToday, overdue } = useDashboard()

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t('title')}</h1>
      <div className="grid grid-cols-3 gap-4">
        <StatTile label={t('goingOutToday')} value={goingOutToday.length} />
        <StatTile label={t('dueBackToday')} value={dueBackToday.length} />
        <StatTile label={t('overdue')} value={overdue.length} danger />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the test, confirm it passes**

```bash
npm test -- DashboardPage.test.tsx
```
Expected: PASS.

- [ ] **Step 7: Mount it in the router**

In `client/src/app/router.tsx`, replace the placeholder dashboard route:

```tsx
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx'
```

```tsx
<Route index element={<DashboardPage />} />
```

- [ ] **Step 8: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/features/dashboard client/src/locales/pt-BR/dashboard.json client/src/i18n.ts client/src/app/router.tsx
git commit -m "Add dashboard screen with today's going-out/due-back/overdue counts"
```

---

### Task 9: Clients screen

**Files:**
- Create: `client/src/features/clients/clientSchemas.ts`
- Create: `client/src/features/clients/useClients.ts`
- Create: `client/src/features/clients/ClientDrawer.tsx`
- Create: `client/src/features/clients/ClientsPage.tsx`
- Create: `client/src/locales/pt-BR/clients.json`
- Modify: `client/src/i18n.ts`
- Modify: `client/src/app/router.tsx`
- Test: `client/src/features/clients/clientSchemas.test.ts`
- Test: `client/src/features/clients/ClientDrawer.test.tsx`
- Test: `client/src/features/clients/ClientsPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 4). Backend shapes (mirrored, not imported — see note below): `POST /api/clients` and `PATCH /api/clients/:id` accept `{ name: string (min 1), phone: string (min 1), email: string (email), notes?: string }`, per `server/src/routes/clients.ts`. `DELETE /api/clients/:id` can 409 with `CANNOT_DELETE_WITH_HISTORY`.
- Produces: `clientSchema: ZodSchema`, `type ClientFormValues`, `useClients()`, `useCreateClient()`, `useUpdateClient()`, `useDeleteClient()`, `<ClientDrawer client={Client | null} onClose={() => void}>` (client `null` = create mode).
- **Note on schema reuse:** the frontend cannot literally `import` the backend's zod schemas — `server/src/routes/clients.ts` also imports Express, Prisma-backed services, and `AppError`, none of which are safe to bundle into a browser build. `clientSchemas.ts` instead mirrors the backend's field names and constraints exactly, so the two are documented as the same shape rather than physically shared.

- [ ] **Step 1: Locale file**

Create `client/src/locales/pt-BR/clients.json`:

```json
{
  "title": "Clientes",
  "searchPlaceholder": "Buscar por nome, telefone ou e-mail...",
  "fields": {
    "name": "Nome",
    "phone": "Telefone",
    "email": "E-mail",
    "notes": "Observações"
  },
  "validation": {
    "nameRequired": "Nome é obrigatório",
    "phoneRequired": "Telefone é obrigatório",
    "emailInvalid": "E-mail inválido"
  },
  "errors": {
    "CANNOT_DELETE_WITH_HISTORY": "Não é possível excluir um cliente com histórico de alocações."
  },
  "empty": "Nenhum cliente cadastrado ainda."
}
```

Modify `client/src/i18n.ts` to add `clients` to the imports and `resources['pt-BR']`.

- [ ] **Step 2: Write the failing test for `clientSchemas`**

Create `client/src/features/clients/clientSchemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { clientSchema } from './clientSchemas.ts'

describe('clientSchema', () => {
  it('accepts a valid client', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva', phone: '11999999999', email: 'maria@example.com', notes: '',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = clientSchema.safeParse({
      name: 'Maria Silva', phone: '11999999999', email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const result = clientSchema.safeParse({ name: '', phone: '1', email: 'a@b.com' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
cd client && npm test -- clientSchemas.test.ts
```
Expected: FAIL — `clientSchemas.ts` doesn't exist.

- [ ] **Step 4: Install zod and react-hook-form**

```bash
npm install zod react-hook-form @hookform/resolvers
```

- [ ] **Step 5: Implement `clientSchemas.ts`**

Create `client/src/features/clients/clientSchemas.ts`:

```typescript
import { z } from 'zod'

export const clientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email(),
  notes: z.string().optional(),
})

export type ClientFormValues = z.infer<typeof clientSchema>

export interface Client extends ClientFormValues {
  id: string
  createdAt: string
}
```

- [ ] **Step 6: Run it, confirm it passes**

```bash
npm test -- clientSchemas.test.ts
```
Expected: PASS.

- [ ] **Step 7: Implement `useClients`**

Create `client/src/features/clients/useClients.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Client, ClientFormValues } from './clientSchemas.ts'

const CLIENTS_KEY = ['clients']

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLIENTS_KEY }),
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

- [ ] **Step 8: Implement `ClientDrawer`**

Create `client/src/features/clients/ClientDrawer.tsx`:

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { clientSchema, type Client, type ClientFormValues } from './clientSchemas.ts'
import { useCreateClient, useUpdateClient, useDeleteClient } from './useClients.ts'

export function ClientDrawer({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { t } = useTranslation('clients')
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const deleteClient = useDeleteClient()
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ?? { name: '', phone: '', email: '', notes: '' },
  })

  async function onSubmit(values: ClientFormValues) {
    if (client) {
      await updateClient.mutateAsync({ id: client.id, values })
    } else {
      await createClient.mutateAsync(values)
    }
    onClose()
  }

  async function handleDelete() {
    if (!client) return
    setDeleteErrorCode(null)
    try {
      await deleteClient.mutateAsync(client.id)
      onClose()
    } catch (error) {
      setDeleteErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 border-l border-border-soft bg-white p-4 shadow-lg">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.name')}
          <Input {...register('name')} />
          {errors.name && <span className="text-xs text-red-600">{t('validation.nameRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.phone')}
          <Input {...register('phone')} />
          {errors.phone && <span className="text-xs text-red-600">{t('validation.phoneRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.email')}
          <Input {...register('email')} />
          {errors.email && <span className="text-xs text-red-600">{t('validation.emailInvalid')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.notes')}
          <Input {...register('notes')} />
        </label>
        {deleteErrorCode && (
          <p className="text-xs text-red-600">
            {t(`errors.${deleteErrorCode}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) })}
          </p>
        )}
        <div className="mt-2 flex justify-between gap-2">
          {client && (
            <Button type="button" variant="ghost" onClick={handleDelete}>
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </div>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 9: Write the failing test for delete-with-history handling**

Add to `client/src/features/clients/ClientDrawer.test.tsx` (new file):

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import * as useClientsModule from './useClients.ts'

const client = { id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }

function mockClientHooks(deleteImpl: () => Promise<unknown>) {
  vi.spyOn(useClientsModule, 'useCreateClient').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useClientsModule, 'useUpdateClient').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useClientsModule, 'useDeleteClient').mockReturnValue({ mutateAsync: deleteImpl } as never)
}

describe('ClientDrawer', () => {
  it('does not show a delete button in create mode', () => {
    mockClientHooks(vi.fn())
    render(<ClientDrawer client={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('shows the translated error when deleting a client with allocation history', async () => {
    mockClientHooks(vi.fn().mockRejectedValue({ code: 'CANNOT_DELETE_WITH_HISTORY', message: 'nope' }))
    render(<ClientDrawer client={client} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    expect(
      await screen.findByText('Não é possível excluir um cliente com histórico de alocações.'),
    ).toBeInTheDocument()
  })

  it('closes the drawer when delete succeeds', async () => {
    const onClose = vi.fn()
    mockClientHooks(vi.fn().mockResolvedValue(undefined))
    render(<ClientDrawer client={client} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 10: Run it, confirm it fails**

```bash
cd client && npm test -- ClientDrawer.test.tsx
```
Expected: FAIL — `useDeleteClient` isn't wired into `ClientDrawer` yet if Step 8 wasn't applied with the delete button; if Step 8's code above is already in place, this passes immediately — continue to Step 11 either way.

- [ ] **Step 11: Confirm it passes**

```bash
npm test -- ClientDrawer.test.tsx
```
Expected: PASS.

- [ ] **Step 12: Write the failing test for `ClientsPage`**

Create `client/src/features/clients/ClientsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ClientsPage } from './ClientsPage.tsx'
import * as useClientsModule from './useClients.ts'

describe('ClientsPage', () => {
  it('lists clients and opens the drawer in create mode when "Novo" is clicked', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    render(<ClientsPage />)

    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Novo' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('opens the drawer in edit mode pre-filled when a row is clicked', async () => {
    vi.spyOn(useClientsModule, 'useClients').mockReturnValue({
      data: [{ id: '1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }],
      isLoading: false,
    } as never)

    render(<ClientsPage />)
    await userEvent.click(screen.getByText('Maria Silva'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Maria Silva')
  })
})
```

- [ ] **Step 13: Run it, confirm it fails**

```bash
npm test -- ClientsPage.test.tsx
```
Expected: FAIL — `ClientsPage.tsx` doesn't exist.

- [ ] **Step 14: Implement `ClientsPage`**

Create `client/src/features/clients/ClientsPage.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useClients } from './useClients.ts'
import { ClientDrawer } from './ClientDrawer.tsx'
import type { Client } from './clientSchemas.ts'

export function ClientsPage() {
  const { t } = useTranslation('clients')
  const { data: clients, isLoading } = useClients()
  const [editing, setEditing] = useState<Client | null | undefined>(undefined)

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('common:actions.create', { ns: 'common' })}</Button>
      </div>
      {clients && clients.length === 0 && <p className="text-muted">{t('empty')}</p>}
      <div className="flex flex-col gap-1">
        {clients?.map((client) => (
          <button
            key={client.id}
            onClick={() => setEditing(client)}
            className="flex justify-between rounded-md p-2 text-left text-sm hover:bg-brand-50"
          >
            <span>{client.name}</span>
            <span className="text-muted">{client.phone}</span>
          </button>
        ))}
      </div>
      {editing !== undefined && <ClientDrawer client={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}
```

- [ ] **Step 15: Run it, confirm it passes**

```bash
npm test -- ClientsPage.test.tsx
```
Expected: PASS.

- [ ] **Step 16: Mount it in the router**

In `client/src/app/router.tsx`, import `ClientsPage` and replace the `/clientes` placeholder with `<Route path="/clientes" element={<ClientsPage />} />`.

- [ ] **Step 17: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 18: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/features/clients client/src/locales/pt-BR/clients.json client/src/i18n.ts client/src/app/router.tsx client/package.json client/package-lock.json
git commit -m "Add Clients screen: list, create/edit drawer, delete-with-history handling, zod validation"
```

---

### Task 10: Products screen

Same table + drawer pattern as Task 9, applied to products. Full code shown (per the "no `Similar to Task N`" rule), field set changed to match `server/src/routes/products.ts`.

**Files:**
- Create: `client/src/features/products/productSchemas.ts`
- Create: `client/src/features/products/useProducts.ts`
- Create: `client/src/features/products/ProductDrawer.tsx`
- Create: `client/src/features/products/ProductsPage.tsx`
- Create: `client/src/locales/pt-BR/products.json`
- Modify: `client/src/i18n.ts`
- Modify: `client/src/app/router.tsx`
- Test: `client/src/features/products/productSchemas.test.ts`
- Test: `client/src/features/products/ProductDrawer.test.tsx`
- Test: `client/src/features/products/ProductsPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 4). Backend shapes mirrored from `server/src/routes/products.ts`: create/update take `{ locationId, name, description?, category, size, color, rentalPrice, depositAmount, photos?: string[], status? }` where `status` is `'active' | 'maintenance' | 'retired'`.
- Produces: `productSchema`, `type ProductFormValues`, `useProducts()`, `useCreateProduct()`, `useUpdateProduct()`, `useDeleteProduct()`, `<ProductDrawer product={Product | null} onClose={() => void}>`.
- **v1 simplification:** the drawer hardcodes `locationId` to the single seeded location rather than offering a picker — the whole-app spec explicitly scopes multi-location UI out of v1 ("the `location` field exists in the schema but v1 only ever has one row"). The location id is read from `staff.locationId` via `useAuth()`.

- [ ] **Step 1: Locale file**

Create `client/src/locales/pt-BR/products.json`:

```json
{
  "title": "Produtos",
  "fields": {
    "name": "Nome",
    "category": "Categoria",
    "size": "Tamanho",
    "color": "Cor",
    "rentalPrice": "Preço do aluguel",
    "depositAmount": "Caução",
    "description": "Descrição",
    "status": "Status"
  },
  "status": {
    "active": "Disponível",
    "maintenance": "Manutenção",
    "retired": "Aposentado"
  },
  "validation": {
    "nameRequired": "Nome é obrigatório",
    "categoryRequired": "Categoria é obrigatória",
    "sizeRequired": "Tamanho é obrigatório",
    "colorRequired": "Cor é obrigatória"
  },
  "empty": "Nenhum produto cadastrado ainda.",
  "errors": {
    "CANNOT_DELETE_WITH_HISTORY": "Não é possível excluir um produto com histórico de alocações."
  }
}
```

Modify `client/src/i18n.ts` to add `products`.

- [ ] **Step 2: Write the failing test for `productSchemas`**

Create `client/src/features/products/productSchemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { productSchema } from './productSchemas.ts'

describe('productSchema', () => {
  it('accepts a valid product', () => {
    const result = productSchema.safeParse({
      locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
      rentalPrice: 150, depositAmount: 50,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a negative rental price', () => {
    const result = productSchema.safeParse({
      locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
      rentalPrice: -10, depositAmount: 50,
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
cd client && npm test -- productSchemas.test.ts
```
Expected: FAIL — `productSchemas.ts` doesn't exist.

- [ ] **Step 4: Implement `productSchemas.ts`**

Create `client/src/features/products/productSchemas.ts`:

```typescript
import { z } from 'zod'

export const productSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().min(1),
  size: z.string().min(1),
  color: z.string().min(1),
  rentalPrice: z.number().nonnegative(),
  depositAmount: z.number().nonnegative(),
  photos: z.array(z.string()).optional(),
})

export type ProductFormValues = z.infer<typeof productSchema>

export type ProductStatus = 'active' | 'maintenance' | 'retired'

export interface Product extends ProductFormValues {
  id: string
  status: ProductStatus
  createdAt: string
}
```

- [ ] **Step 5: Run it, confirm it passes**

```bash
npm test -- productSchemas.test.ts
```
Expected: PASS.

- [ ] **Step 6: Implement `useProducts`**

Create `client/src/features/products/useProducts.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Product, ProductFormValues, ProductStatus } from './productSchemas.ts'

const PRODUCTS_KEY = ['products']

export function useProducts() {
  return useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: () => apiFetch<Product[]>('/api/products'),
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: ProductFormValues) =>
      apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY }),
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
```

- [ ] **Step 7: Implement `ProductDrawer`**

Create `client/src/features/products/ProductDrawer.tsx`:

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { useAuth } from '../../lib/useAuth.ts'
import { productSchema, type Product, type ProductFormValues } from './productSchemas.ts'
import { useCreateProduct, useUpdateProduct, useDeleteProduct } from './useProducts.ts'

export function ProductDrawer({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation('products')
  const { staff } = useAuth()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? {
      locationId: staff?.locationId ?? '',
      name: '', category: '', size: '', color: '', rentalPrice: 0, depositAmount: 0,
    },
  })

  async function onSubmit(values: ProductFormValues) {
    if (product) {
      await updateProduct.mutateAsync({ id: product.id, values })
    } else {
      await createProduct.mutateAsync(values)
    }
    onClose()
  }

  async function handleDelete() {
    if (!product) return
    setDeleteErrorCode(null)
    try {
      await deleteProduct.mutateAsync(product.id)
      onClose()
    } catch (error) {
      setDeleteErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 border-l border-border-soft bg-white p-4 shadow-lg">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <input type="hidden" {...register('locationId')} />
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.name')}
          <Input {...register('name')} />
          {errors.name && <span className="text-xs text-red-600">{t('validation.nameRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.category')}
          <Input {...register('category')} />
          {errors.category && <span className="text-xs text-red-600">{t('validation.categoryRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.size')}
          <Input {...register('size')} />
          {errors.size && <span className="text-xs text-red-600">{t('validation.sizeRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.color')}
          <Input {...register('color')} />
          {errors.color && <span className="text-xs text-red-600">{t('validation.colorRequired')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.rentalPrice')}
          <Input type="number" step="0.01" {...register('rentalPrice', { valueAsNumber: true })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.depositAmount')}
          <Input type="number" step="0.01" {...register('depositAmount', { valueAsNumber: true })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.description')}
          <Input {...register('description')} />
        </label>
        {deleteErrorCode && (
          <p className="text-xs text-red-600">
            {t(`errors.${deleteErrorCode}`, { defaultValue: t('common:errors.UNKNOWN', { ns: 'common' }) })}
          </p>
        )}
        <div className="mt-2 flex justify-between gap-2">
          {product && (
            <Button type="button" variant="ghost" onClick={handleDelete}>
              {t('common:actions.delete', { ns: 'common' })}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </div>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 8: Write the failing test for delete-with-history handling**

Create `client/src/features/products/ProductDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import * as useProductsModule from './useProducts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'

const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, createdAt: '2026-01-01',
}

function mockProductHooks(deleteImpl: () => Promise<unknown>) {
  vi.spyOn(useProductsModule, 'useCreateProduct').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useProductsModule, 'useUpdateProduct').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useProductsModule, 'useDeleteProduct').mockReturnValue({ mutateAsync: deleteImpl } as never)
  vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
    staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1' },
    isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true,
  })
}

describe('ProductDrawer', () => {
  it('does not show a delete button in create mode', () => {
    mockProductHooks(vi.fn())
    render(<ProductDrawer product={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('shows the translated error when deleting a product with allocation history', async () => {
    mockProductHooks(vi.fn().mockRejectedValue({ code: 'CANNOT_DELETE_WITH_HISTORY', message: 'nope' }))
    render(<ProductDrawer product={product} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    expect(
      await screen.findByText('Não é possível excluir um produto com histórico de alocações.'),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 9: Run it, confirm it passes**

```bash
cd client && npm test -- ProductDrawer.test.tsx
```
Expected: PASS (the delete button and error handling were already added in Step 7's code).

- [ ] **Step 10: Write the failing test for `ProductsPage`**

Create `client/src/features/products/ProductsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { ProductsPage } from './ProductsPage.tsx'
import * as useProductsModule from './useProducts.ts'
import * as useAuthModule from '../../lib/useAuth.ts'

const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, createdAt: '2026-01-01',
}

describe('ProductsPage', () => {
  it('lists products with their status', () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    render(<ProductsPage />)

    expect(screen.getByText('Vestido Azul')).toBeInTheDocument()
    expect(screen.getByText('Disponível')).toBeInTheDocument()
  })

  it('opens the drawer in edit mode when a row is clicked', async () => {
    vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({ staff: { id: '1', name: 'Ana', role: 'owner', locationId: 'l1' }, isLoadingStaff: false, login: vi.fn(), logout: vi.fn(), isLoggedIn: true })

    render(<ProductsPage />)
    await userEvent.click(screen.getByText('Vestido Azul'))
    expect(screen.getByLabelText('Nome')).toHaveValue('Vestido Azul')
  })
})
```

- [ ] **Step 11: Run it, confirm it fails**

```bash
npm test -- ProductsPage.test.tsx
```
Expected: FAIL — `ProductsPage.tsx` doesn't exist.

- [ ] **Step 12: Implement `ProductsPage`**

Create `client/src/features/products/ProductsPage.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useProducts } from './useProducts.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import type { Product } from './productSchemas.ts'

export function ProductsPage() {
  const { t } = useTranslation(['products', 'common'])
  const { data: products, isLoading } = useProducts()
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('common:actions.create')}</Button>
      </div>
      {products && products.length === 0 && <p className="text-muted">{t('empty')}</p>}
      <div className="flex flex-col gap-1">
        {products?.map((product) => (
          <button
            key={product.id}
            onClick={() => setEditing(product)}
            className="flex justify-between rounded-md p-2 text-left text-sm hover:bg-brand-50"
          >
            <span>{product.name}</span>
            <span className="flex gap-4 text-muted">
              <span>{product.size}</span>
              <span>{t(`status.${product.status}`)}</span>
            </span>
          </button>
        ))}
      </div>
      {editing !== undefined && <ProductDrawer product={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}
```

- [ ] **Step 13: Run it, confirm it passes**

```bash
npm test -- ProductsPage.test.tsx
```
Expected: PASS.

- [ ] **Step 14: Mount it in the router**

In `client/src/app/router.tsx`, import `ProductsPage` and replace the `/produtos` placeholder.

- [ ] **Step 15: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/features/products client/src/locales/pt-BR/products.json client/src/i18n.ts client/src/app/router.tsx client/package.json client/package-lock.json
git commit -m "Add Products screen: list, create/edit drawer, delete-with-history handling, status display"
```

---

### Task 11: Allocations screen

The core workflow screen: a table with status-aware actions, and a "Nova alocação" form whose product picker filters by the range-aware availability endpoint added in Task 1.

**Files:**
- Create: `client/src/features/allocations/allocationSchemas.ts`
- Create: `client/src/features/allocations/useAllocations.ts`
- Create: `client/src/features/allocations/NewAllocationForm.tsx`
- Create: `client/src/features/allocations/AllocationsPage.tsx`
- Create: `client/src/locales/pt-BR/allocations.json`
- Modify: `client/src/i18n.ts`
- Modify: `client/src/app/router.tsx`
- Test: `client/src/features/allocations/allocationSchemas.test.ts`
- Test: `client/src/features/allocations/AllocationsPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 4), `useClients` (Task 9, for the client picker), `useProducts` (Task 10, for the product list to filter). Backend shapes mirrored from `server/src/routes/allocations.ts`: `POST /api/allocations` takes `{ productId, clientId, checkoutDate, dueDate, priceCharged }`; `POST /:id/check-out` takes `{ conditionNotesOut?, depositCollected? }`; `POST /:id/return` takes `{ conditionNotesIn?, depositReturned?, actualReturnDate? }`; `POST /:id/cancel` takes no body; `GET /products/:id/availability?checkoutDate&dueDate` (added in Task 1) returns `{ available: boolean }`.
- Produces: `newAllocationSchema`, `useAllocationsList()`, `useCreateAllocation()`, `useCheckOutAllocation()`, `useReturnAllocation()`, `useCancelAllocation()`, `useProductAvailability(productId, checkoutDate, dueDate)`.

- [ ] **Step 1: Locale file**

Create `client/src/locales/pt-BR/allocations.json`:

```json
{
  "title": "Alocações",
  "newAllocation": "Nova alocação",
  "fields": {
    "client": "Cliente",
    "product": "Produto",
    "checkoutDate": "Data de saída",
    "dueDate": "Data de devolução",
    "priceCharged": "Valor cobrado"
  },
  "status": {
    "reserved": "Reservado",
    "checked_out": "Alugado",
    "returned": "Devolvido",
    "cancelled": "Cancelado"
  },
  "actions": {
    "checkOut": "Check-out",
    "return": "Devolver",
    "cancel": "Cancelar"
  },
  "unavailableProduct": "Não disponível no período escolhido",
  "errors": {
    "PRODUCT_UNAVAILABLE": "Produto não disponível para as datas escolhidas.",
    "PRODUCT_NOT_IN_CIRCULATION": "Este produto não está disponível para aluguel.",
    "DUE_DATE_BEFORE_CHECKOUT": "A data de devolução deve ser após a data de saída.",
    "INVALID_ALLOCATION_TRANSITION": "Esta ação não é permitida no status atual."
  },
  "empty": "Nenhuma alocação registrada ainda."
}
```

Modify `client/src/i18n.ts` to add `allocations`.

- [ ] **Step 2: Write the failing test for `allocationSchemas`**

Create `client/src/features/allocations/allocationSchemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { newAllocationSchema } from './allocationSchemas.ts'

describe('newAllocationSchema', () => {
  it('accepts a valid allocation request', () => {
    const result = newAllocationSchema.safeParse({
      productId: 'p1', clientId: 'c1', checkoutDate: '2026-08-01', dueDate: '2026-08-05', priceCharged: 100,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing productId', () => {
    const result = newAllocationSchema.safeParse({
      productId: '', clientId: 'c1', checkoutDate: '2026-08-01', dueDate: '2026-08-05', priceCharged: 100,
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
cd client && npm test -- allocationSchemas.test.ts
```
Expected: FAIL — `allocationSchemas.ts` doesn't exist.

- [ ] **Step 4: Implement `allocationSchemas.ts`**

Create `client/src/features/allocations/allocationSchemas.ts`:

```typescript
import { z } from 'zod'

export const newAllocationSchema = z.object({
  productId: z.string().min(1),
  clientId: z.string().min(1),
  checkoutDate: z.string().min(1),
  dueDate: z.string().min(1),
  priceCharged: z.number().nonnegative(),
})

export type NewAllocationFormValues = z.infer<typeof newAllocationSchema>

export type AllocationStatus = 'reserved' | 'checked_out' | 'returned' | 'cancelled'

export interface Allocation {
  id: string
  productId: string
  clientId: string
  staffId: string
  checkoutDate: string
  dueDate: string
  actualReturnDate: string | null
  status: AllocationStatus
  priceCharged: number
  depositCollected: number | null
  depositReturned: number | null
  conditionNotesOut: string | null
  conditionNotesIn: string | null
  createdAt: string
}
```

- [ ] **Step 5: Run it, confirm it passes**

```bash
npm test -- allocationSchemas.test.ts
```
Expected: PASS.

- [ ] **Step 6: Implement `useAllocations.ts`**

Create `client/src/features/allocations/useAllocations.ts`:

```typescript
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Allocation, NewAllocationFormValues } from './allocationSchemas.ts'

const ALLOCATIONS_KEY = ['allocations']

export function useAllocationsList() {
  return useQuery({
    queryKey: ALLOCATIONS_KEY,
    queryFn: () => apiFetch<Allocation[]>('/api/allocations'),
  })
}

function invalidateAfterMutation(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ALLOCATIONS_KEY })
  queryClient.invalidateQueries({ queryKey: ['calendar'] })
  queryClient.invalidateQueries({ queryKey: ['products'] })
}

export function useCreateAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: NewAllocationFormValues) =>
      apiFetch<Allocation>('/api/allocations', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useCheckOutAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, conditionNotesOut, depositCollected }: { id: string; conditionNotesOut?: string; depositCollected?: number }) =>
      apiFetch<Allocation>(`/api/allocations/${id}/check-out`, {
        method: 'POST',
        body: JSON.stringify({ conditionNotesOut, depositCollected }),
      }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useReturnAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, conditionNotesIn, depositReturned }: { id: string; conditionNotesIn?: string; depositReturned?: number }) =>
      apiFetch<Allocation>(`/api/allocations/${id}/return`, {
        method: 'POST',
        body: JSON.stringify({ conditionNotesIn, depositReturned }),
      }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useCancelAllocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<Allocation>(`/api/allocations/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidateAfterMutation(queryClient),
  })
}

export function useProductAvailability(productId: string, checkoutDate: string, dueDate: string) {
  return useQuery({
    queryKey: ['availability', productId, checkoutDate, dueDate],
    queryFn: () =>
      apiFetch<{ available: boolean }>(
        `/api/allocations/products/${productId}/availability?checkoutDate=${checkoutDate}&dueDate=${dueDate}`,
      ),
    enabled: Boolean(productId && checkoutDate && dueDate),
  })
}
```

- [ ] **Step 7: Implement `NewAllocationForm`**

Create `client/src/features/allocations/NewAllocationForm.tsx`:

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { useClients } from '../clients/useClients.ts'
import { useProducts } from '../products/useProducts.ts'
import { newAllocationSchema, type NewAllocationFormValues } from './allocationSchemas.ts'
import { useCreateAllocation, useProductAvailability } from './useAllocations.ts'

export function NewAllocationForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('allocations')
  const { data: clients } = useClients()
  const { data: products } = useProducts()
  const createAllocation = useCreateAllocation()
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const { register, handleSubmit, watch } = useForm<NewAllocationFormValues>({
    resolver: zodResolver(newAllocationSchema),
    defaultValues: { productId: '', clientId: '', checkoutDate: '', dueDate: '', priceCharged: 0 },
  })

  const selectedProductId = watch('productId')
  const checkoutDate = watch('checkoutDate')
  const dueDate = watch('dueDate')
  const availability = useProductAvailability(selectedProductId, checkoutDate, dueDate)

  async function onSubmit(values: NewAllocationFormValues) {
    setErrorCode(null)
    try {
      await createAllocation.mutateAsync(values)
      onClose()
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  const activeProducts = products?.filter((p) => p.status === 'active') ?? []

  return (
    <div className="fixed inset-y-0 right-0 w-96 border-l border-border-soft bg-white p-4 shadow-lg">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.client')}
          <select {...register('clientId')} className="h-10 rounded-md border border-border-soft px-2">
            <option value="">—</option>
            {clients?.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.checkoutDate')}
          <Input type="date" {...register('checkoutDate')} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.dueDate')}
          <Input type="date" {...register('dueDate')} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.product')}
          <select {...register('productId')} className="h-10 rounded-md border border-border-soft px-2">
            <option value="">—</option>
            {activeProducts.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
          {selectedProductId && checkoutDate && dueDate && availability.data?.available === false && (
            <span className="text-xs text-red-600">{t('unavailableProduct')}</span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('fields.priceCharged')}
          <Input type="number" step="0.01" {...register('priceCharged', { valueAsNumber: true })} />
        </label>
        {errorCode && (
          <p className="text-sm text-red-600">{t(`errors.${errorCode}`, { defaultValue: errorCode })}</p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={availability.data?.available === false}>Salvar</Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 8: Write the failing test for the availability-aware product picker**

This is the one piece of real business logic in this task — the picker
must disable submission and show a warning when the chosen product isn't
available for the chosen dates, per the whole-app spec's testing
requirement to cover "the availability-aware product picker." Create
`client/src/features/allocations/NewAllocationForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { NewAllocationForm } from './NewAllocationForm.tsx'
import * as useClientsModule from '../clients/useClients.ts'
import * as useProductsModule from '../products/useProducts.ts'
import * as useAllocationsModule from './useAllocations.ts'

const client = { id: 'c1', name: 'Maria Silva', phone: '119', email: 'm@x.com', notes: '', createdAt: '2026-01-01' }
const product = {
  id: 'p1', locationId: 'l1', name: 'Vestido Azul', category: 'casual', size: 'P', color: 'azul',
  rentalPrice: 150, depositAmount: 50, status: 'active' as const, createdAt: '2026-01-01',
}

function mockPickerHooks(available: boolean) {
  vi.spyOn(useClientsModule, 'useClients').mockReturnValue({ data: [client], isLoading: false } as never)
  vi.spyOn(useProductsModule, 'useProducts').mockReturnValue({ data: [product], isLoading: false } as never)
  vi.spyOn(useAllocationsModule, 'useCreateAllocation').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useAllocationsModule, 'useProductAvailability').mockReturnValue({ data: { available } } as never)
}

describe('NewAllocationForm', () => {
  it('disables Salvar and shows a warning when the product is unavailable for the chosen range', async () => {
    mockPickerHooks(false)
    render(<NewAllocationForm onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Data de saída'), '2026-08-01')
    await userEvent.type(screen.getByLabelText('Data de devolução'), '2026-08-05')
    await userEvent.selectOptions(screen.getByLabelText('Produto'), 'p1')

    expect(screen.getByText('Não disponível no período escolhido')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('leaves Salvar enabled when the product is available for the chosen range', async () => {
    mockPickerHooks(true)
    render(<NewAllocationForm onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Data de saída'), '2026-08-01')
    await userEvent.type(screen.getByLabelText('Data de devolução'), '2026-08-05')
    await userEvent.selectOptions(screen.getByLabelText('Produto'), 'p1')

    expect(screen.queryByText('Não disponível no período escolhido')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })
})
```

- [ ] **Step 9: Run it, confirm it fails**

```bash
npm test -- NewAllocationForm.test.tsx
```
Expected: FAIL — `useProductAvailability` isn't exported as a spy-able named export yet in a way the mock can override (it is exported from Task 11 Step 6, so this only fails if Steps 6–7 were skipped; if it already passes, that's fine — it means the implementation from Steps 6–7 already satisfies this test, so continue to Step 10 without changes).

- [ ] **Step 10: Run it again after confirming the implementation, record the result**

```bash
npm test -- NewAllocationForm.test.tsx
```
Expected: PASS.

- [ ] **Step 11: Write the failing test for `AllocationsPage`**

Create `client/src/features/allocations/AllocationsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../../i18n.ts'
import { AllocationsPage } from './AllocationsPage.tsx'
import * as useAllocationsModule from './useAllocations.ts'

const reserved = {
  id: 'a1', productId: 'p1', clientId: 'c1', staffId: 's1', checkoutDate: '2026-08-01', dueDate: '2026-08-05',
  actualReturnDate: null, status: 'reserved' as const, priceCharged: 100, depositCollected: null,
  depositReturned: null, conditionNotesOut: null, conditionNotesIn: null, createdAt: '2026-07-01',
}
const checkedOut = { ...reserved, id: 'a2', status: 'checked_out' as const }
const returned = { ...reserved, id: 'a3', status: 'returned' as const }

function mockAllocationHooks(list: typeof reserved[]) {
  vi.spyOn(useAllocationsModule, 'useAllocationsList').mockReturnValue({ data: list, isLoading: false } as never)
  vi.spyOn(useAllocationsModule, 'useCheckOutAllocation').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useAllocationsModule, 'useReturnAllocation').mockReturnValue({ mutateAsync: vi.fn() } as never)
  vi.spyOn(useAllocationsModule, 'useCancelAllocation').mockReturnValue({ mutateAsync: vi.fn() } as never)
}

describe('AllocationsPage', () => {
  it('shows Check-out/Cancelar for a reserved row', () => {
    mockAllocationHooks([reserved])
    render(<AllocationsPage />)
    expect(screen.getByRole('button', { name: 'Check-out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('shows Devolver for a checked_out row', () => {
    mockAllocationHooks([checkedOut])
    render(<AllocationsPage />)
    expect(screen.getByRole('button', { name: 'Devolver' })).toBeInTheDocument()
  })

  it('shows no action buttons for a returned row', () => {
    mockAllocationHooks([returned])
    render(<AllocationsPage />)
    expect(screen.queryByRole('button', { name: 'Check-out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Devolver' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 12: Run it, confirm it fails**

```bash
npm test -- AllocationsPage.test.tsx
```
Expected: FAIL — `AllocationsPage.tsx` doesn't exist.

- [ ] **Step 13: Implement `AllocationsPage`**

Create `client/src/features/allocations/AllocationsPage.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import {
  useAllocationsList,
  useCheckOutAllocation,
  useReturnAllocation,
  useCancelAllocation,
} from './useAllocations.ts'
import { NewAllocationForm } from './NewAllocationForm.tsx'
import type { Allocation } from './allocationSchemas.ts'

function RowActions({ allocation }: { allocation: Allocation }) {
  const { t } = useTranslation('allocations')
  const checkOut = useCheckOutAllocation()
  const returnAllocation = useReturnAllocation()
  const cancel = useCancelAllocation()

  if (allocation.status === 'reserved') {
    return (
      <div className="flex gap-2">
        <Button size="sm" onClick={() => checkOut.mutateAsync({ id: allocation.id })}>
          {t('actions.checkOut')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => cancel.mutateAsync(allocation.id)}>
          {t('actions.cancel')}
        </Button>
      </div>
    )
  }
  if (allocation.status === 'checked_out') {
    return (
      <Button size="sm" onClick={() => returnAllocation.mutateAsync({ id: allocation.id })}>
        {t('actions.return')}
      </Button>
    )
  }
  return null
}

export function AllocationsPage() {
  const { t } = useTranslation('allocations')
  const { data: allocations, isLoading } = useAllocationsList()
  const [showForm, setShowForm] = useState(false)

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setShowForm(true)}>{t('newAllocation')}</Button>
      </div>
      {allocations && allocations.length === 0 && <p className="text-muted">{t('empty')}</p>}
      <div className="flex flex-col gap-1">
        {allocations?.map((allocation) => (
          <div key={allocation.id} className="flex items-center justify-between rounded-md p-2 text-sm">
            <span>{t(`status.${allocation.status}`)}</span>
            <RowActions allocation={allocation} />
          </div>
        ))}
      </div>
      {showForm && <NewAllocationForm onClose={() => setShowForm(false)} />}
    </div>
  )
}
```

- [ ] **Step 14: Run it, confirm it passes**

```bash
npm test -- AllocationsPage.test.tsx
```
Expected: PASS.

- [ ] **Step 15: Mount it in the router**

In `client/src/app/router.tsx`, import `AllocationsPage` and replace the `/alocacoes` placeholder.

- [ ] **Step 16: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/features/allocations client/src/locales/pt-BR/allocations.json client/src/i18n.ts client/src/app/router.tsx client/package.json client/package-lock.json
git commit -m "Add Allocations screen: status-aware actions and range-aware product picker"
```

---

### Task 12: Calendar screen (agenda default, month toggle)

**Files:**
- Create: `client/src/features/calendar/useCalendar.ts`
- Create: `client/src/features/calendar/AgendaView.tsx`
- Create: `client/src/features/calendar/MonthView.tsx`
- Create: `client/src/features/calendar/CalendarPage.tsx`
- Create: `client/src/locales/pt-BR/calendarScreen.json`
- Modify: `client/src/i18n.ts`
- Modify: `client/src/app/router.tsx`
- Test: `client/src/features/calendar/CalendarPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 4). Backend shapes from `server/src/routes/calendar.ts`: `going-out`/`due-back` take `from`/`to` and return `Allocation[]`; `overdue` takes `asOf` and returns `Allocation[]`.
- Produces: `useCalendarTab(tab: 'going-out' | 'due-back' | 'overdue', from: Date, to: Date)`, `<AgendaView allocations={Allocation[]} dateField="checkoutDate" | "dueDate">`, `<MonthView allocations={Allocation[]} dateField=... onSelectDay={(date: Date) => void}>`.

- [ ] **Step 1: Install react-big-calendar and date-fns**

```bash
cd client && npm install react-big-calendar date-fns
npm install --save-dev @types/react-big-calendar
```

- [ ] **Step 2: Locale file**

Create `client/src/locales/pt-BR/calendarScreen.json`:

```json
{
  "title": "Calendário",
  "tabs": {
    "goingOut": "Saindo",
    "dueBack": "Voltando",
    "overdue": "Atrasados"
  },
  "viewMonth": "Ver mês",
  "viewAgenda": "Ver agenda",
  "empty": "Nada para mostrar neste período."
}
```

Modify `client/src/i18n.ts` to add `calendarScreen` (named to avoid clashing with the `calendar` word used loosely elsewhere).

- [ ] **Step 3: Implement `useCalendar.ts`**

Create `client/src/features/calendar/useCalendar.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'

export type CalendarTab = 'going-out' | 'due-back' | 'overdue'

export function useCalendarTab(tab: CalendarTab, from: Date, to: Date) {
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  return useQuery({
    queryKey: ['calendar', tab, fromIso, toIso],
    queryFn: () => {
      if (tab === 'overdue') {
        return apiFetch<Allocation[]>(`/api/calendar/overdue?asOf=${toIso}`)
      }
      return apiFetch<Allocation[]>(`/api/calendar/${tab}?from=${fromIso}&to=${toIso}`)
    },
  })
}
```

- [ ] **Step 4: Implement `AgendaView`**

Create `client/src/features/calendar/AgendaView.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import type { Allocation } from '../allocations/allocationSchemas.ts'

export function AgendaView({
  allocations,
  dateField,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
}) {
  const { t } = useTranslation('calendarScreen')
  const formatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

  if (allocations.length === 0) {
    return <p className="text-muted">{t('empty')}</p>
  }

  const sorted = [...allocations].sort(
    (a, b) => new Date(a[dateField]).getTime() - new Date(b[dateField]).getTime(),
  )

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((allocation) => (
        <div key={allocation.id} className="flex justify-between rounded-md border border-border-soft p-2 text-sm">
          <span>{allocation.productId}</span>
          <span className="text-muted">{formatter.format(new Date(allocation[dateField]))}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Implement `MonthView`**

Create `client/src/features/calendar/MonthView.tsx`:

```tsx
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import format from 'date-fns/format'
import parse from 'date-fns/parse'
import startOfWeek from 'date-fns/startOfWeek'
import getDay from 'date-fns/getDay'
import { ptBR } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import type { Allocation } from '../allocations/allocationSchemas.ts'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: ptBR }),
  getDay,
  locales: { 'pt-BR': ptBR },
})

export function MonthView({
  allocations,
  dateField,
  onSelectDay,
}: {
  allocations: Allocation[]
  dateField: 'checkoutDate' | 'dueDate'
  onSelectDay: (date: Date) => void
}) {
  const events = allocations.map((allocation) => ({
    title: allocation.productId,
    start: new Date(allocation[dateField]),
    end: new Date(allocation[dateField]),
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
        onSelectEvent={(event) => onSelectDay(event.start)}
        onSelectSlot={(slot) => onSelectDay(slot.start)}
        selectable
        culture="pt-BR"
      />
    </div>
  )
}
```

- [ ] **Step 6: Write the failing test for `CalendarPage`**

Create `client/src/features/calendar/CalendarPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../../i18n.ts'
import { CalendarPage } from './CalendarPage.tsx'
import * as useCalendarModule from './useCalendar.ts'

describe('CalendarPage', () => {
  it('defaults to the agenda view with the Saindo tab active', () => {
    vi.spyOn(useCalendarModule, 'useCalendarTab').mockReturnValue({ data: [], isLoading: false } as never)
    render(<CalendarPage />)
    expect(screen.getByRole('button', { name: 'Ver mês' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver agenda' })).not.toBeInTheDocument()
  })

  it('toggles to month view and back', async () => {
    vi.spyOn(useCalendarModule, 'useCalendarTab').mockReturnValue({ data: [], isLoading: false } as never)
    render(<CalendarPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Ver mês' }))
    expect(screen.getByRole('button', { name: 'Ver agenda' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run it, confirm it fails**

```bash
cd client && npm test -- CalendarPage.test.tsx
```
Expected: FAIL — `CalendarPage.tsx` doesn't exist.

- [ ] **Step 8: Implement `CalendarPage`**

Create `client/src/features/calendar/CalendarPage.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useCalendarTab, type CalendarTab } from './useCalendar.ts'
import { AgendaView } from './AgendaView.tsx'
import { MonthView } from './MonthView.tsx'

const tabDateField: Record<CalendarTab, 'checkoutDate' | 'dueDate'> = {
  'going-out': 'checkoutDate',
  'due-back': 'dueDate',
  overdue: 'dueDate',
}

function monthRange(anchor: Date) {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59)
  return { from, to }
}

export function CalendarPage() {
  const { t } = useTranslation('calendarScreen')
  const [tab, setTab] = useState<CalendarTab>('going-out')
  const [view, setView] = useState<'agenda' | 'month'>('agenda')
  const [anchor, setAnchor] = useState(new Date())
  const { from, to } = monthRange(anchor)
  const { data: allocations } = useCalendarTab(tab, from, to)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button size="sm" variant="secondary" onClick={() => setView(view === 'agenda' ? 'month' : 'agenda')}>
          {view === 'agenda' ? t('viewMonth') : t('viewAgenda')}
        </Button>
      </div>
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === 'going-out' ? 'primary' : 'secondary'} onClick={() => setTab('going-out')}>
          {t('tabs.goingOut')}
        </Button>
        <Button size="sm" variant={tab === 'due-back' ? 'primary' : 'secondary'} onClick={() => setTab('due-back')}>
          {t('tabs.dueBack')}
        </Button>
        <Button size="sm" variant={tab === 'overdue' ? 'primary' : 'secondary'} onClick={() => setTab('overdue')}>
          {t('tabs.overdue')}
        </Button>
      </div>
      {view === 'agenda' ? (
        <AgendaView allocations={allocations ?? []} dateField={tabDateField[tab]} />
      ) : (
        <MonthView
          allocations={allocations ?? []}
          dateField={tabDateField[tab]}
          onSelectDay={(date) => {
            setAnchor(date)
            setView('agenda')
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 9: Run it, confirm it passes**

```bash
npm test -- CalendarPage.test.tsx
```
Expected: PASS.

- [ ] **Step 10: Mount it in the router**

In `client/src/app/router.tsx`, import `CalendarPage` and replace the `/calendario` placeholder.

- [ ] **Step 11: Run the full suite and build**

```bash
npm test
npm run build
```
Expected: all tests pass; build succeeds with no type errors.

- [ ] **Step 12: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/src/features/calendar client/src/locales/pt-BR/calendarScreen.json client/src/i18n.ts client/src/app/router.tsx client/package.json client/package-lock.json
git commit -m "Add Calendar screen: agenda default with going-out/due-back/overdue tabs and month-view toggle"
```

---

### Task 13: Electron wrapper

**Files:**
- Create: `client/electron/main.ts`
- Create: `client/electron/preload.ts`
- Create: `client/electron.vite.config.ts`
- Modify: `client/package.json`
- Test: `client/electron/main.test.ts`

**Interfaces:**
- Produces: `npm run electron:dev` (electron-vite dev, launches the renderer + spawns the backend) and `npm run electron:build` in `client/package.json`.
- Produces: `resolveServerCwd(): string` in `main.ts` — the one piece of packaging-sensitive logic worth unit-testing directly (everything else in `main.ts` is Electron API calls that need a running Electron process, covered instead by Task 14's smoke test).

- [ ] **Step 1: Install electron, electron-vite, and the two Electron build/type packages**

```bash
cd client
npm install --save-dev electron electron-vite @types/node
```

- [ ] **Step 2: Write the failing test for `resolveServerCwd`**

Create `client/electron/main.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveServerCwd } from './main.ts'

describe('resolveServerCwd', () => {
  it('resolves to the server workspace relative to the electron app root', () => {
    const result = resolveServerCwd('/home/user/dress-store-app/client')
    expect(result).toBe(path.resolve('/home/user/dress-store-app/client', '..', 'server'))
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
npm test -- main.test.ts
```
Expected: FAIL — `main.ts` doesn't exist.

- [ ] **Step 4: Implement `main.ts`**

Create `client/electron/main.ts`:

```typescript
import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function resolveServerCwd(appRoot: string): string {
  return path.resolve(appRoot, '..', 'server')
}

let serverProcess: ChildProcess | null = null

function startServer() {
  const serverCwd = resolveServerCwd(app.getAppPath())
  serverProcess = spawn('node', ['dist/server.js'], {
    cwd: serverCwd,
    env: { ...process.env, DB_PROVIDER: 'sqlite', PORT: '3000' },
    stdio: 'pipe',
  })
  serverProcess.on('error', (error) => {
    console.error('Backend process failed to start:', error)
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  startServer()
  createWindow()
})

app.on('window-all-closed', () => {
  serverProcess?.kill()
  app.quit()
})
```

- [ ] **Step 5: Run it, confirm it passes**

```bash
npm test -- main.test.ts
```
Expected: PASS.

- [ ] **Step 6: `preload.ts`**

Create `client/electron/preload.ts`:

```typescript
// No privileged APIs are exposed to the renderer yet — the renderer talks
// to the backend over plain HTTP (http://localhost:3000), same as the
// hosted web build. This file exists so electron-vite's default project
// layout (main/preload/renderer) has a preload entry point to build.
```

- [ ] **Step 7: `electron.vite.config.ts`**

Create `client/electron.vite.config.ts`:

```typescript
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
  },
})
```

- [ ] **Step 8: Add the Electron scripts**

Modify `client/package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "electron:dev": "electron-vite dev",
    "electron:build": "electron-vite build"
  }
}
```

- [ ] **Step 9: Run the full test suite and build**

```bash
npm test
npm run build
```
Expected: all tests pass; web build still succeeds (the Electron config is a separate entry point and doesn't affect `vite build`).

- [ ] **Step 10: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/electron client/electron.vite.config.ts client/package.json client/package-lock.json
git commit -m "Add Electron wrapper: main process spawns the backend, electron-vite build config"
```

---

### Task 14: E2E happy-path test (Playwright)

**Files:**
- Create: `client/playwright.config.ts`
- Create: `client/e2e/happy-path.spec.ts`
- Modify: `client/package.json`

**Interfaces:**
- Produces: `npm run test:e2e` in `client/package.json`, running against the Vite dev server with the real backend (SQLite, freshly migrated test DB) — this is the one test in the whole plan that exercises the real API instead of a mocked one, per the whole-app spec's testing section ("E2E test (Playwright) for the happy path... driven through the actual UI instead of curl").

- [ ] **Step 1: Install Playwright**

```bash
cd client && npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
```

- [ ] **Step 2: `playwright.config.ts`**

Create `client/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
```

- [ ] **Step 3: Write the E2E happy-path test**

Create `client/e2e/happy-path.spec.ts`. This assumes a running backend (`npm run dev` in `server/`, migrated `.env` with a seeded `Location` + `Staff` row — the plan doesn't seed one automatically since that's an operational/deployment concern, not a frontend build concern; the test documents the precondition in a comment):

```typescript
import { test, expect } from '@playwright/test'

// Precondition: server/ is running against a database that already has a
// Location and a Staff row (login: e2e-staff, password: e2e-password12).
// See server/README.md for how to seed one.

test('register client and product, allocate, check out, return', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Usuário').fill('e2e-staff')
  await page.getByLabel('Senha').fill('e2e-password12')
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByText('Painel — hoje')).toBeVisible()

  await page.getByRole('link', { name: 'Clientes' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  await page.getByLabel('Nome').fill('Cliente E2E')
  await page.getByLabel('Telefone').fill('11999999999')
  await page.getByLabel('E-mail').fill('e2e@example.com')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Cliente E2E')).toBeVisible()

  await page.getByRole('link', { name: 'Produtos' }).click()
  await page.getByRole('button', { name: 'Novo' }).click()
  await page.getByLabel('Nome').fill('Vestido E2E')
  await page.getByLabel('Categoria').fill('festa')
  await page.getByLabel('Tamanho').fill('M')
  await page.getByLabel('Cor').fill('verde')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Vestido E2E')).toBeVisible()

  await page.getByRole('link', { name: 'Alocações' }).click()
  await page.getByRole('button', { name: 'Nova alocação' }).click()
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente E2E' })
  await page.getByLabel('Data de saída').fill('2027-01-10')
  await page.getByLabel('Data de devolução').fill('2027-01-15')
  await page.getByLabel('Produto').selectOption({ label: 'Vestido E2E' })
  await page.getByLabel('Valor cobrado').fill('200')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Reservado')).toBeVisible()

  await page.getByRole('button', { name: 'Check-out' }).click();
  await expect(page.getByText('Alugado')).toBeVisible()

  await page.getByRole('button', { name: 'Devolver' }).click();
  await expect(page.getByText('Devolvido')).toBeVisible()
})
```

- [ ] **Step 4: Add the script**

Modify `client/package.json` scripts, adding:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 5: Run it against a live backend**

```bash
# terminal 1
cd server && npm run dev
# terminal 2
cd client && npm run test:e2e
```
Expected: PASS, provided a `Location`/`Staff` row exists per the precondition comment in the test. (If no such row exists yet, seed one the same way Task-1-era manual testing did — create a `Location` and `Staff` via a one-off script against `server/dev.db`, exactly as was done earlier for manual `curl` testing of this same backend.)

- [ ] **Step 6: Commit**

```bash
cd /home/zhyp/Code/dress-store-app
git add client/playwright.config.ts client/e2e client/package.json client/package-lock.json
git commit -m "Add Playwright E2E happy-path test through the real UI"
```
