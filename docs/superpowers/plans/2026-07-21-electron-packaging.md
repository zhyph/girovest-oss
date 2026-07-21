# Electron Offline-App Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-working Electron wrapper (`client/electron/`) fully self-contained and shippable as a Windows and Linux installer that a client can install and run with zero prerequisites — no Node, no npm, no manual DB setup, no scripts.

**Architecture:** `main.ts` currently spawns `node dist/server.js`, assuming a system Node install. It changes to run the server on Electron's own bundled Node/V8 (`ELECTRON_RUN_AS_NODE`), resolve its data directory from `app.getPath('userData')` instead of a relative path, generate and persist its own `JWT_SECRET`, run `prisma migrate deploy` before starting, and bind to `127.0.0.1` only. A new pair of backend endpoints plus a frontend screen let a client create their shop's first login on first launch instead of running a script. `electron-builder` packages the whole thing (client renderer/main/preload + the server's compiled output as `extraResources`) into a Windows NSIS installer and a Linux AppImage, built by a GitHub Actions matrix (one native runner per target, no cross-compilation).

**Tech Stack:** Existing stack unchanged (Express/Prisma server, React/Vite/Electron client). Adds: `electron-builder` (packaging), no new runtime dependencies on the server side beyond promoting `prisma` from `devDependencies` to `dependencies`.

Full design rationale: `docs/superpowers/specs/2026-07-21-electron-packaging-design.md`.

## Global Constraints

- No macOS target, no auto-updates, no code signing, no ARM builds — all explicit v1 non-goals in the design spec. Do not add config for any of these.
- `server`'s native modules (`bcrypt`, `better-sqlite3`) must work when the server runs on Electron's bundled Node (`ELECTRON_RUN_AS_NODE=1`), not just a system Node — `electron-builder` rebuilds them automatically as part of packaging; do not hand-roll a rebuild step.
- The offline app's server binds `127.0.0.1` only — never `0.0.0.0` — to avoid LAN exposure and Windows Firewall prompts. This must not change the server's default behavior for any other caller (a future hosted-web deployment binds `0.0.0.0` as today).
- All new user-facing strings go through `react-i18next` (pt-BR), matching the existing convention — never hardcode Portuguese text in JSX.
- New backend error codes are `UPPER_SNAKE_CASE` added to `server/src/errors/errorCodes.ts`, matching every existing code there.
- Run `npm test` in the relevant workspace (`server` or `client`) after every task; run `npm run build` in that workspace before the final commit of every task.
- Do not hand-pin dependency versions — install via `npm install <package>` and let npm record the resolved version.

---

## File Structure

```
server/
  src/server.ts                    # MODIFY — HOST env var
  src/errors/errorCodes.ts         # MODIFY — add SETUP_ALREADY_COMPLETE
  src/services/setupService.ts     # NEW — needsSetup(), completeSetup()
  src/routes/setup.ts              # NEW — GET /status, POST /
  src/routes/setup.test.ts         # NEW
  src/app.ts                        # MODIFY — wire setupRouter
  package.json                      # MODIFY (Task 5) — prisma to dependencies

client/
  electron/
    main.ts                         # MODIFY — self-contained execution
    main.test.ts                    # MODIFY — new helper coverage
  electron-builder.yml               # NEW
  src/
    i18n.ts                          # MODIFY — register setup namespace
    locales/pt-BR/setup.json         # NEW
    lib/useSetup.ts                  # NEW
    features/setup/SetupPage.tsx     # NEW
    features/setup/SetupPage.test.tsx # NEW
    app/router.tsx                    # MODIFY — gate /login behind setup check

.github/
  workflows/electron-build.yml       # NEW
```

---

### Task 1: Server — configurable network binding

**Files:**
- Modify: `server/src/server.ts`

**Interfaces:**
- Produces: `server.ts` reads an optional `HOST` env var; defaults to `0.0.0.0` (today's behavior) when unset.

- [ ] **Step 1: Read the current file**

```bash
cat server/src/server.ts
```

Current content:
```ts
import 'dotenv/config'
import { app } from './app.js'

const port = Number(process.env.PORT ?? 3000)

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
```

- [ ] **Step 2: Update to accept an optional HOST**

Replace the file with:

```ts
import 'dotenv/config'
import { app } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`)
})
```

- [ ] **Step 3: Verify the server still starts with default behavior**

```bash
cd server && npm run build && HOST= PORT=3999 node dist/server.js &
sleep 1
curl -s http://localhost:3999/health
kill %1
```

Expected: `curl` prints `{"status":"ok"}`.

- [ ] **Step 4: Verify HOST=127.0.0.1 is honored**

```bash
cd server && HOST=127.0.0.1 PORT=3999 node dist/server.js &
sleep 1
curl -s http://127.0.0.1:3999/health
kill %1
```

Expected: `curl` prints `{"status":"ok"}`.

- [ ] **Step 5: Run the full server test suite**

```bash
cd server && npm test
```

Expected: all existing tests still pass (this change doesn't touch any tested behavior directly, but confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts
git commit -m "Add configurable HOST binding to the server, defaulting to today's 0.0.0.0"
```

---

### Task 2: Server — first-run setup endpoints

**Files:**
- Modify: `server/src/errors/errorCodes.ts`
- Create: `server/src/services/setupService.ts`
- Create: `server/src/routes/setup.ts`
- Create: `server/src/routes/setup.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `prisma` from `server/src/db/client.ts`, `hashPassword` from `server/src/auth/passwords.ts`, `AppError`/`ErrorCodes` from `server/src/errors/`.
- Produces: `GET /api/setup/status` → `{ needsSetup: boolean }`. `POST /api/setup` → body `{ shopName, shopAddress, ownerName, ownerLogin, ownerPassword }`, creates the first `Location` + `Staff` (role `owner`), returns `201 { locationId, staffId }`. Returns `409 { code: 'SETUP_ALREADY_COMPLETE' }` if a `Location` already exists. Neither route requires authentication (there is no account to authenticate with yet) — this matches `authRouter`'s own unauthenticated `/login`.

- [ ] **Step 1: Add the new error code**

Modify `server/src/errors/errorCodes.ts`:

```ts
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DUE_DATE_BEFORE_CHECKOUT: 'DUE_DATE_BEFORE_CHECKOUT',
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  INVALID_ALLOCATION_TRANSITION: 'INVALID_ALLOCATION_TRANSITION',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  CANNOT_DELETE_WITH_HISTORY: 'CANNOT_DELETE_WITH_HISTORY',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PRODUCT_NOT_IN_CIRCULATION: 'PRODUCT_NOT_IN_CIRCULATION',
  SETUP_ALREADY_COMPLETE: 'SETUP_ALREADY_COMPLETE',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
```

- [ ] **Step 2: Write the failing test**

Create `server/src/routes/setup.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'

describe('GET /api/setup/status', () => {
  beforeAll(async () => {
    // Defensive cleanup: this suite's "empty DB" assertion must hold
    // regardless of what other test files left behind, since Vitest runs
    // files sequentially (parallelism disabled) but doesn't reset the DB
    // between them.
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  it('reports needsSetup: true when no location exists', async () => {
    const response = await request(app).get('/api/setup/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ needsSetup: true })
  })
})

describe('GET /api/setup/status with an existing location', () => {
  let locationId: string

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { name: 'Loja Existente', address: 'Rua X, 1' },
    })
    locationId = location.id
  })

  afterAll(async () => {
    await prisma.location.delete({ where: { id: locationId } })
  })

  it('reports needsSetup: false', async () => {
    const response = await request(app).get('/api/setup/status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ needsSetup: false })
  })
})

describe('POST /api/setup', () => {
  beforeAll(async () => {
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  afterAll(async () => {
    await prisma.staff.deleteMany()
    await prisma.location.deleteMany()
  })

  it('creates the first location and owner staff row', async () => {
    const response = await request(app).post('/api/setup').send({
      shopName: 'Loja Nova',
      shopAddress: 'Rua Nova, 100',
      ownerName: 'Dona Ana',
      ownerLogin: 'dona-ana',
      ownerPassword: 'senha-forte-123',
    })

    expect(response.status).toBe(201)
    expect(typeof response.body.locationId).toBe('string')
    expect(typeof response.body.staffId).toBe('string')

    const staff = await prisma.staff.findUnique({ where: { id: response.body.staffId } })
    expect(staff).toMatchObject({ login: 'dona-ana', role: 'owner' })
  })

  it('rejects a second call once a location exists', async () => {
    await request(app).post('/api/setup').send({
      shopName: 'Loja Nova',
      shopAddress: 'Rua Nova, 100',
      ownerName: 'Dona Ana',
      ownerLogin: 'dona-ana-2',
      ownerPassword: 'senha-forte-123',
    })

    const response = await request(app).post('/api/setup').send({
      shopName: 'Outra Loja',
      shopAddress: 'Rua Outra, 1',
      ownerName: 'Outra Dona',
      ownerLogin: 'outra-dona',
      ownerPassword: 'senha-forte-123',
    })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('SETUP_ALREADY_COMPLETE')
  })

  it('rejects an incomplete payload with VALIDATION_ERROR', async () => {
    const response = await request(app).post('/api/setup').send({ shopName: 'Loja' })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

```bash
cd server && npm test -- setup.test.ts
```

Expected: FAIL — `../app.js` doesn't yet import a `setupRouter`, and `setup.test.ts` itself has no route to hit (404s, not the expected statuses).

- [ ] **Step 4: Implement the service**

Create `server/src/services/setupService.ts`:

```ts
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { hashPassword } from '../auth/passwords.js'

export interface CompleteSetupInput {
  shopName: string
  shopAddress: string
  ownerName: string
  ownerLogin: string
  ownerPassword: string
}

export async function needsSetup(): Promise<boolean> {
  const count = await prisma.location.count()
  return count === 0
}

export async function completeSetup(
  input: CompleteSetupInput,
): Promise<{ locationId: string; staffId: string }> {
  if (!(await needsSetup())) {
    throw new AppError(ErrorCodes.SETUP_ALREADY_COMPLETE, 409, 'Setup has already been completed')
  }

  const location = await prisma.location.create({
    data: { name: input.shopName, address: input.shopAddress },
  })

  const staff = await prisma.staff.create({
    data: {
      name: input.ownerName,
      login: input.ownerLogin,
      passwordHash: await hashPassword(input.ownerPassword),
      role: 'owner',
      locationId: location.id,
    },
  })

  return { locationId: location.id, staffId: staff.id }
}
```

- [ ] **Step 5: Implement the router**

Create `server/src/routes/setup.ts`:

```ts
import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { needsSetup, completeSetup } from '../services/setupService.js'

export const setupRouter = Router()

setupRouter.get('/status', async (_req, res) => {
  res.json({ needsSetup: await needsSetup() })
})

const completeSetupSchema = z.object({
  shopName: z.string().min(1),
  shopAddress: z.string().min(1),
  ownerName: z.string().min(1),
  ownerLogin: z.string().min(1),
  ownerPassword: z.string().min(8),
})

setupRouter.post('/', async (req, res) => {
  const parsed = completeSetupSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid setup payload')
  }
  const result = await completeSetup(parsed.data)
  res.status(201).json(result)
})
```

- [ ] **Step 6: Wire the router into the app**

Modify `server/src/app.ts` — add the import alongside the others and the route registration above the "always add new routers ABOVE this comment" line:

```ts
import express from 'express'
import cors from 'cors'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { authRouter } from './auth/authRoutes.js'
import { setupRouter } from './routes/setup.js'
import { clientsRouter } from './routes/clients.js'
import { productsRouter } from './routes/products.js'
import { allocationsRouter } from './routes/allocations.js'
import { calendarRouter } from './routes/calendar.js'

export const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/setup', setupRouter)
app.use('/api/auth', authRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/products', productsRouter)
app.use('/api/allocations', allocationsRouter)
app.use('/api/calendar', calendarRouter)

// Always add new routers ABOVE this comment and BELOW it stays last:

app.use(errorMiddleware)
```

- [ ] **Step 7: Run the test, confirm it passes**

```bash
cd server && npm test -- setup.test.ts
```

Expected: PASS, all 4 cases.

- [ ] **Step 8: Run the full server suite**

```bash
cd server && npm test
```

Expected: all tests pass, including the pre-existing `authRoutes.test.ts` CORS/auth suite (confirms the new router didn't disturb existing route registration order).

- [ ] **Step 9: Commit**

```bash
git add server/src/errors/errorCodes.ts server/src/services/setupService.ts server/src/routes/setup.ts server/src/routes/setup.test.ts server/src/app.ts
git commit -m "Add first-run setup endpoints: GET /api/setup/status, POST /api/setup"
```

---

### Task 3: Client — first-run setup screen

**Files:**
- Create: `client/src/locales/pt-BR/setup.json`
- Modify: `client/src/i18n.ts`
- Create: `client/src/lib/useSetup.ts`
- Create: `client/src/features/setup/SetupPage.tsx`
- Create: `client/src/features/setup/SetupPage.test.tsx`
- Modify: `client/src/app/router.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `client/src/lib/api.ts` (existing), `Button`/`Input`/`Card`/`CardBody`/`CardHeader` from `client/src/components/ui/` (existing).
- Produces: `useSetupStatus(): { data: { needsSetup: boolean } | undefined, isLoading: boolean }` and `useCompleteSetup(): { mutateAsync, isPending }` in `useSetup.ts`. `SetupPage` component, rendered at `/configurar-loja`.

- [ ] **Step 1: Add the locale file**

Create `client/src/locales/pt-BR/setup.json`:

```json
{
  "title": "Configurar loja",
  "shopNameField": "Nome da loja",
  "shopAddressField": "Endereço",
  "ownerNameField": "Seu nome",
  "ownerLoginField": "Usuário",
  "ownerPasswordField": "Senha",
  "submit": "Criar loja",
  "errors": {
    "SETUP_ALREADY_COMPLETE": "Esta loja já foi configurada."
  }
}
```

- [ ] **Step 2: Register the namespace**

Modify `client/src/i18n.ts`:

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/pt-BR/common.json'
import auth from './locales/pt-BR/auth.json'
import setup from './locales/pt-BR/setup.json'
import dashboard from './locales/pt-BR/dashboard.json'
import clients from './locales/pt-BR/clients.json'
import products from './locales/pt-BR/products.json'
import allocations from './locales/pt-BR/allocations.json'
import calendarScreen from './locales/pt-BR/calendarScreen.json'

i18n.use(initReactI18next).init({
  lng: 'pt-BR',
  fallbackLng: 'pt-BR',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  resources: {
    'pt-BR': { common, auth, setup, dashboard, clients, products, allocations, calendarScreen },
  },
})

export default i18n
```

- [ ] **Step 3: Write the failing test**

Create `client/src/features/setup/SetupPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import '../../i18n.ts'
import { SetupPage } from './SetupPage.tsx'
import { apiFetch } from '../../lib/api.ts'

vi.mock('../../lib/api.ts', () => ({ apiFetch: vi.fn() }))

function renderSetupPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/configurar-loja']}>
        <Routes>
          <Route path="/configurar-loja" element={<SetupPage />} />
          <Route path="/login" element={<div>Login stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  it('submits the form and redirects to /login on success', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ locationId: 'l1', staffId: 's1' })

    renderSetupPage()

    await userEvent.type(screen.getByLabelText('Nome da loja'), 'Loja Teste')
    await userEvent.type(screen.getByLabelText('Endereço'), 'Rua Teste, 1')
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Dona Ana')
    await userEvent.type(screen.getByLabelText('Usuário'), 'dona-ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-forte-123')
    await userEvent.click(screen.getByRole('button', { name: 'Criar loja' }))

    await waitFor(() => expect(screen.getByText('Login stub')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/setup',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows an error message when setup is already complete', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'SETUP_ALREADY_COMPLETE' })

    renderSetupPage()

    await userEvent.type(screen.getByLabelText('Nome da loja'), 'Loja Teste')
    await userEvent.type(screen.getByLabelText('Endereço'), 'Rua Teste, 1')
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Dona Ana')
    await userEvent.type(screen.getByLabelText('Usuário'), 'dona-ana')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-forte-123')
    await userEvent.click(screen.getByRole('button', { name: 'Criar loja' }))

    expect(await screen.findByText('Esta loja já foi configurada.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run it, confirm it fails**

```bash
cd client && npm test -- SetupPage.test.tsx
```

Expected: FAIL — `./SetupPage.tsx` and `../../lib/useSetup.ts` don't exist yet.

- [ ] **Step 5: Implement the hook**

Create `client/src/lib/useSetup.ts`:

```ts
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from './api.ts'

export interface SetupStatus {
  needsSetup: boolean
}

export interface CompleteSetupInput {
  shopName: string
  shopAddress: string
  ownerName: string
  ownerLogin: string
  ownerPassword: string
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup', 'status'],
    queryFn: () => apiFetch<SetupStatus>('/api/setup/status'),
  })
}

export function useCompleteSetup() {
  return useMutation({
    mutationFn: (values: CompleteSetupInput) =>
      apiFetch<{ locationId: string; staffId: string }>('/api/setup', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
  })
}
```

- [ ] **Step 6: Implement the page**

Create `client/src/features/setup/SetupPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useCompleteSetup } from '../../lib/useSetup.ts'

export function SetupPage() {
  const { t } = useTranslation(['setup', 'common'])
  const completeSetup = useCompleteSetup()
  const [shopName, setShopName] = useState('')
  const [shopAddress, setShopAddress] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerLogin, setOwnerLogin] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorCode(null)
    try {
      await completeSetup.mutateAsync({ shopName, shopAddress, ownerName, ownerLogin, ownerPassword })
      setDone(true)
    } catch (error) {
      setErrorCode((error as { code?: string }).code ?? 'UNKNOWN')
    }
  }

  if (done) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <Card className="w-96">
        <CardHeader>
          <h1 className="text-lg font-semibold">{t('setup:title')}</h1>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:shopNameField')}
              <Input value={shopName} onChange={(e) => setShopName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:shopAddressField')}
              <Input value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerNameField')}
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerLoginField')}
              <Input value={ownerLogin} onChange={(e) => setOwnerLogin(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('setup:ownerPasswordField')}
              <Input
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
              />
            </label>
            {errorCode && (
              <p className="text-sm text-red-600">
                {t(`setup:errors.${errorCode}`, { defaultValue: t('common:errors.UNKNOWN') })}
              </p>
            )}
            <Button type="submit" disabled={completeSetup.isPending}>
              {t('setup:submit')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
```

- [ ] **Step 7: Run the test, confirm it passes**

```bash
cd client && npm test -- SetupPage.test.tsx
```

Expected: PASS, both cases.

- [ ] **Step 8: Wire the route and gate `/login` behind a setup check**

Modify `client/src/app/router.tsx`:

```tsx
import { Routes, Route } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { SetupPage } from '../features/setup/SetupPage.tsx'
import { ProtectedRoute } from './ProtectedRoute.tsx'
import { AppLayout } from './AppLayout.tsx'
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx'
import { ClientsPage } from '../features/clients/ClientsPage.tsx'
import { ProductsPage } from '../features/products/ProductsPage.tsx'
import { AllocationsPage } from '../features/allocations/AllocationsPage.tsx'
import { CalendarPage } from '../features/calendar/CalendarPage.tsx'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/configurar-loja" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/alocacoes" element={<AllocationsPage />} />
          <Route path="/calendario" element={<CalendarPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
```

This adds the route but doesn't yet redirect a fresh install there automatically —
that's `LoginPage`'s job, since it already owns the "what do I show before
authentication" decision. Modify `client/src/features/auth/LoginPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Card, CardBody, CardHeader } from '../../components/ui/card.tsx'
import { useAuth } from '../../lib/useAuth.ts'
import { useSetupStatus } from '../../lib/useSetup.ts'

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common'])
  const { login, isLoggedIn } = useAuth()
  const setupStatus = useSetupStatus()
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

  if (isLoggedIn) {
    return <Navigate to="/" replace />
  }

  if (setupStatus.data?.needsSetup) {
    return <Navigate to="/configurar-loja" replace />
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

`setupStatus.data` is `undefined` while the query is loading, so
`setupStatus.data?.needsSetup` is falsy and the login form renders normally
until the check resolves — on an already-configured install this is
indistinguishable from today's behavior (a one-request flash that resolves
to `false`).

- [ ] **Step 9: Update `LoginPage.test.tsx` for the new dependency**

`LoginPage` now calls `useSetupStatus()`, which calls `apiFetch`. The
existing `client/src/features/auth/LoginPage.test.tsx` mocks `useAuth` but
makes real (unmocked) calls through `apiFetch` for any other hook it
doesn't know about — check the current file:

```bash
cat client/src/features/auth/LoginPage.test.tsx
```

Add a mock for `useSetupStatus` so existing tests don't trigger a real
network call. At the top of the file, alongside the existing
`vi.spyOn(useAuthModule, 'useAuth')` calls, add:

```ts
import * as useSetupModule from '../../lib/useSetup.ts'
```

And in each existing `it(...)` block, before `renderLoginPage()`, add:

```ts
vi.spyOn(useSetupModule, 'useSetupStatus').mockReturnValue({
  data: { needsSetup: false },
} as ReturnType<typeof useSetupModule.useSetupStatus>)
```

- [ ] **Step 10: Run the full client test suite**

```bash
cd client && npm test
```

Expected: all tests pass, including the updated `LoginPage.test.tsx` and new `SetupPage.test.tsx`.

- [ ] **Step 11: Run the build**

```bash
cd client && npm run build
```

Expected: succeeds, no type errors.

- [ ] **Step 12: Commit**

```bash
git add client/src/locales/pt-BR/setup.json client/src/i18n.ts client/src/lib/useSetup.ts client/src/features/setup client/src/app/router.tsx client/src/features/auth/LoginPage.tsx client/src/features/auth/LoginPage.test.tsx
git commit -m "Add first-run setup screen, gated in front of login"
```

---

### Task 4: Electron — self-contained server execution

**Files:**
- Modify: `client/electron/main.ts`
- Modify: `client/electron/main.test.ts`

**Interfaces:**
- Produces: `resolveServerRuntimeCwd(isPackaged, appRoot, resourcesPath): string`, `resolveJwtSecret(userDataPath): string`, `resolveDatabaseUrl(userDataPath): string` — all pure, exported, unit-testable without a real Electron runtime, following the existing `resolveServerCwd` pattern.
- Consumes: nothing new from other tasks — this is self-contained within `client/electron/`.

- [ ] **Step 1: Write the failing tests for the three new pure helpers**

Replace `client/electron/main.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  resolveServerCwd,
  resolveServerRuntimeCwd,
  resolveJwtSecret,
  resolveDatabaseUrl,
} from './main.ts'

describe('resolveServerCwd', () => {
  it('resolves to the server workspace relative to the electron app root', () => {
    const result = resolveServerCwd('/home/user/dress-store-app/client')
    expect(result).toBe(path.resolve('/home/user/dress-store-app/client', '..', 'server'))
  })
})

describe('resolveServerRuntimeCwd', () => {
  it('resolves relative to resourcesPath when packaged', () => {
    const result = resolveServerRuntimeCwd(true, '/unused', '/opt/dress-store-app/resources')
    expect(result).toBe(path.join('/opt/dress-store-app/resources', 'server'))
  })

  it('falls back to resolveServerCwd when not packaged', () => {
    const result = resolveServerRuntimeCwd(false, '/home/user/dress-store-app/client', '/unused')
    expect(result).toBe(resolveServerCwd('/home/user/dress-store-app/client'))
  })
})

describe('resolveJwtSecret', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-secret-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates and persists a secret when none exists', () => {
    const secret = resolveJwtSecret(tmpDir)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(path.join(tmpDir, 'jwt-secret'), 'utf-8')).toBe(secret)
  })

  it('returns the same secret on a second call instead of regenerating', () => {
    const first = resolveJwtSecret(tmpDir)
    const second = resolveJwtSecret(tmpDir)
    expect(second).toBe(first)
  })

  it('reads a pre-existing secret file rather than overwriting it', () => {
    fs.writeFileSync(path.join(tmpDir, 'jwt-secret'), 'existing-secret-value', 'utf-8')
    expect(resolveJwtSecret(tmpDir)).toBe('existing-secret-value')
  })
})

describe('resolveDatabaseUrl', () => {
  it('builds a file: URL pointing at dev.db inside the given directory', () => {
    const userDataPath = '/home/user/.config/dress-store-app'
    expect(resolveDatabaseUrl(userDataPath)).toBe(`file:${path.join(userDataPath, 'dev.db')}`)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd client && npm test -- main.test.ts
```

Expected: FAIL — `resolveServerRuntimeCwd`, `resolveJwtSecret`, `resolveDatabaseUrl` aren't exported from `main.ts` yet.

- [ ] **Step 3: Verify the exact prisma CLI entry path before wiring migrations**

The migration step (Step 5) needs to invoke Prisma's CLI directly as a JS
file (not a shell shim), so it can run under `ELECTRON_RUN_AS_NODE`. Confirm
the entry point:

```bash
cd server && python3 -c "import json; print(json.load(open('node_modules/prisma/package.json'))['bin'])"
```

Expected: `{'prisma': 'build/index.js'}` — this is the path used in Step 5
below (`node_modules/prisma/build/index.js`, relative to the server's own
directory, which works identically on Windows and Linux since it's a JS
file path, not an OS shell shim).

- [ ] **Step 4: Implement the pure helpers and rewrite the bootstrap**

Replace `client/electron/main.ts` with:

```ts
import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export function resolveServerCwd(appRoot: string): string {
  return path.resolve(appRoot, '..', 'server')
}

export function resolveServerRuntimeCwd(
  isPackaged: boolean,
  appRoot: string,
  resourcesPath: string,
): string {
  return isPackaged ? path.join(resourcesPath, 'server') : resolveServerCwd(appRoot)
}

export function resolveJwtSecret(userDataPath: string): string {
  const secretPath = path.join(userDataPath, 'jwt-secret')
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf-8')
  }
  const secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(secretPath, secret, 'utf-8')
  return secret
}

export function resolveDatabaseUrl(userDataPath: string): string {
  return `file:${path.join(userDataPath, 'dev.db')}`
}

let serverProcess: ChildProcess | null = null

function runMigrations(serverCwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const prismaCli = path.join(serverCwd, 'node_modules', 'prisma', 'build', 'index.js')
    const migrate = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: serverCwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    })
    migrate.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`prisma migrate deploy exited with code ${code}`))
    })
    migrate.on('error', reject)
  })
}

async function startServer() {
  app.setName('dress-store-app')
  const userDataPath = app.getPath('userData')
  const serverCwd = resolveServerRuntimeCwd(
    app.isPackaged,
    app.getAppPath(),
    process.resourcesPath,
  )

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_PROVIDER: 'sqlite',
    DATABASE_URL: resolveDatabaseUrl(userDataPath),
    JWT_SECRET: resolveJwtSecret(userDataPath),
    HOST: '127.0.0.1',
    PORT: '3000',
  }

  try {
    await runMigrations(serverCwd, env)
  } catch (error) {
    console.error('Database migration failed:', error)
    return
  }

  serverProcess = spawn(process.execPath, ['dist/server.js'], {
    cwd: serverCwd,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
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
      preload: path.join(import.meta.dirname, '../preload/index.js'),
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
}

// `electron` resolves to a plain string (the path to the Electron binary)
// when this module is loaded outside the real Electron runtime — e.g. by
// Vitest, which imports this file directly to unit-test the pure helpers
// above. Guard the app bootstrap so importing this module for tests doesn't
// try to call methods on that string. Under a real Electron process `app`
// is always a populated object, so production behavior is unaffected.
if (app) {
  app.whenReady().then(async () => {
    await startServer()
    createWindow()
  })

  app.on('window-all-closed', () => {
    serverProcess?.kill()
    app.quit()
  })
}
```

- [ ] **Step 5: Run the test, confirm it passes**

```bash
cd client && npm test -- main.test.ts
```

Expected: PASS, all cases across all four `describe` blocks.

- [ ] **Step 6: Manually verify the full dev flow still works**

```bash
cd server && npm run build
cd ../client && npm run electron:dev
```

Expected: the app launches (subject to the target machine having a normal
display/GPU — a headless sandbox without one will fail at window creation,
not at any of the logic this task changed); confirm via the terminal log
that `startServer` ran migrations and spawned the server without a
`node: command not found`-style error, and that no port-3000 firewall
prompt appears (binding is now `127.0.0.1`).

- [ ] **Step 7: Run the full client test suite and build**

```bash
cd client && npm test && npm run build
```

Expected: all tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/electron/main.ts client/electron/main.test.ts
git commit -m "Make the Electron server process self-contained: bundled Node, persisted JWT secret, userData DB path, auto-migrate"
```

---

### Task 5: Packaging — electron-builder config

**Files:**
- Create: `client/electron-builder.yml`
- Modify: `server/package.json`
- Modify: `client/package.json`

**Interfaces:**
- Produces: `npm run package` in `client/package.json` (runs `electron-builder`). Packaged output at `client/release/` (deliberately not `client/dist/`, which the plain web build already uses).

- [ ] **Step 1: Promote `prisma` to a runtime dependency**

The packaged app runs `prisma migrate deploy` via the bundled `prisma`
package (Task 4). If `server`'s production install (`npm ci --omit=dev`)
strips `devDependencies`, `prisma` disappears — it must ship. Modify
`server/package.json`'s `dependencies`/`devDependencies`:

```bash
cd server && npm uninstall --save-dev prisma && npm install --save prisma
```

Verify the move:

```bash
python3 -c "
import json
pkg = json.load(open('package.json'))
assert 'prisma' in pkg['dependencies'], 'prisma missing from dependencies'
assert 'prisma' not in pkg.get('devDependencies', {}), 'prisma still in devDependencies'
print('OK')
"
```

Expected: `OK`.

- [ ] **Step 2: Confirm the server still builds and tests pass**

```bash
cd server && npm run build && npm test
```

Expected: both succeed — moving a package between `dependencies` and
`devDependencies` doesn't change what's installed locally (`npm install`
already ran both), only what a production-only install keeps.

- [ ] **Step 3: Install electron-builder**

```bash
cd client && npm install --save-dev electron-builder
```

- [ ] **Step 4: Write the electron-builder config**

Create `client/electron-builder.yml`:

```yaml
appId: com.dressstore.app
productName: Dress Store
directories:
  output: release
files:
  - out/**/*
  - package.json
extraResources:
  - from: ../server/dist
    to: server/dist
  - from: ../server/node_modules
    to: server/node_modules
  - from: ../server/prisma
    to: server/prisma
  - from: ../server/prisma.config.ts
    to: server/prisma.config.ts
win:
  target: nsis
linux:
  target: AppImage
```

`directories.output: release` avoids colliding with `client/dist/`, which
`npm run build` (the plain web build, `tsc -b && vite build`) already
owns — electron-builder's own default output directory is also `dist`,
which would silently clobber or conflict with that unrelated build if left
unset.

- [ ] **Step 5: Add the packaging script**

Modify `client/package.json`'s `scripts`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "electron:dev": "electron-vite dev",
    "electron:build": "electron-vite build",
    "package": "electron-builder"
  }
}
```

- [ ] **Step 6: Prune the server to production dependencies before packaging (local verification)**

```bash
cd server && cp -r node_modules /tmp/server-node_modules-backup
npm ci --omit=dev
ls node_modules/prisma
```

Expected: `node_modules/prisma` exists (confirms Step 1 worked — a
production-only install still includes it).

- [ ] **Step 7: Build everything and package for Linux locally**

```bash
cd server && npm run build
cd ../client && npm run electron:build && npm run package -- --linux
```

Expected: succeeds; `client/release/` contains a `.AppImage` file.

- [ ] **Step 8: Restore the server's full node_modules for continued local development**

```bash
cd server && rm -rf node_modules && mv /tmp/server-node_modules-backup node_modules
```

- [ ] **Step 9: Confirm the plain web build still works and lands in its own directory**

```bash
cd client && npm run build
ls dist/index.html
ls release/*.AppImage
```

Expected: both exist — confirms `client/dist/` (web build) and
`client/release/` (electron-builder output) don't collide.

- [ ] **Step 10: Commit**

```bash
git add server/package.json server/package-lock.json client/electron-builder.yml client/package.json client/package-lock.json
git commit -m "Add electron-builder packaging config (Windows NSIS, Linux AppImage)"
```

Note: do not commit `client/release/` or the AppImage produced in Step 7 —
confirm `client/.gitignore` already ignores build output directories
(`out/`, `dist/`); add `release/` to it if not already covered.

```bash
grep -q '^release/$' client/.gitignore || echo 'release/' >> client/.gitignore
git add client/.gitignore
git commit -m "Ignore electron-builder's release/ output directory" --allow-empty
```

(The `--allow-empty` guards the case where `release/` was already covered
by an existing broader ignore pattern and the `grep -q` check above added
nothing — check `git status` before this commit and drop `--allow-empty`
if there's a real change to commit instead.)

---

### Task 6: CI — GitHub Actions build matrix

**Files:**
- Create: `.github/workflows/electron-build.yml`

**Interfaces:**
- Produces: a manually-triggerable (and tag-triggered) workflow that builds and uploads a Windows installer and a Linux AppImage as build artifacts.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/electron-build.yml`:

```yaml
name: Build Electron App

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Install workspace dependencies
        run: npm ci

      - name: Build server
        run: npm run build --workspace=server

      - name: Prune server to production dependencies
        run: npm ci --omit=dev --workspace=server

      - name: Build client renderer/main/preload
        run: npm run electron:build --workspace=client

      - name: Package with electron-builder
        run: npm run package --workspace=client -- --publish=never

      - uses: actions/upload-artifact@v4
        with:
          name: dress-store-app-${{ matrix.os }}
          path: |
            client/release/*.exe
            client/release/*.AppImage
          if-no-files-found: error
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/electron-build.yml
git commit -m "Add GitHub Actions workflow: build Windows + Linux installers"
```

- [ ] **Step 3: Manually trigger the workflow (requires repo push access)**

```bash
gh workflow run electron-build.yml
```

Wait for it to complete, then check both matrix legs succeeded and
produced downloadable artifacts:

```bash
gh run list --workflow=electron-build.yml --limit=1
gh run view --log $(gh run list --workflow=electron-build.yml --limit=1 --json databaseId --jq '.[0].databaseId')
```

Expected: both `windows-latest` and `ubuntu-latest` jobs show success, and
`gh run view` (or the Actions UI) lists both artifacts. This is the first
point where native-module rebuilding (`bcrypt`, `better-sqlite3` against
Electron's ABI, per the design's noted open risk) gets tested for real —
if either fails here, treat it as a bug in this task, not a follow-up.

---

## Final Verification

After all six tasks:

```bash
cd server && npm test && npm run build
cd ../client && npm test && npm run build
```

Expected: both workspaces' tests and builds pass. Then confirm the
GitHub Actions workflow (Task 6, Step 4) produced both installers
successfully — that is the actual acceptance bar for this plan: a client
downloads one file, double-clicks it, and reaches a working shop-setup
screen with no other software installed.
