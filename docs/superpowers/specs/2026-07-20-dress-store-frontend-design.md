# Dress Store Rental Management App — Frontend Design

## Problem

The backend (REST API: auth, clients, products, allocations, calendar) is
built and merged. Staff have no way to use it except `curl` — this spec
covers the React frontend that gives them a real UI, shipped as both a
local Electron app and a hosted web app from one codebase, per the
architecture already committed to in the
[whole-app design](2026-07-17-dress-store-app-design.md).

## Goals

- A staff-facing UI covering all core workflows already defined: register
  client, register product, allocate, check out, return, cancel,
  calendar/list views.
- Usable on desktop and tablet (staff may use a tablet at the counter).
- Visual tone: warm boutique feel, not a generic admin panel — fits a
  dress rental brand.
- Same codebase runs inside the Electron shell (local, SQLite-backed) and
  as a hosted web app (remote, Postgres-backed), per the existing
  architecture doc.
- pt-BR by default via `react-i18next`, per the i18n design already
  committed to.

## Non-goals (v1)

- Anything already scoped out at the whole-app level (payments, SMS,
  multi-location UI, public customer portal, non-pt-BR locales).
- Native mobile app — tablet support means a responsive web/Electron
  layout, not a separate iOS/Android build.
- Photo upload UI beyond a basic file picker — cropping/editing tools are
  out of scope.

## Architecture

### Repo layout

`client/` sits alongside the existing `server/`, joined by npm workspaces:

```
dress-store-app/
  package.json          # root: "workspaces": ["server", "client"]
  server/                # existing Express/Prisma API
  client/
    electron/            # main.ts, preload.ts (electron-vite)
    src/
      app/               # routing, layout shell, providers
      features/
        dashboard/
        clients/
        products/
        allocations/
        calendar/
      components/        # shadcn-generated + custom shared UI
      lib/                # api client, auth token handling, zod schemas
      locales/
        pt-BR/
          common.json
          clients.json
          products.json
          allocations.json
          calendar.json
    index.html
    vite.config.ts
    electron.vite.config.ts
```

### Stack

- **React + TypeScript + Vite** — SPA, matches the backend's TS and gives
  a single build that serves both targets.
- **electron-vite** — builds main/preload/renderer from one config. The
  Electron main process spawns the existing `server/` as a child process
  on localhost (SQLite adapter), matching the architecture already
  defined. The hosted build serves the same renderer build as static
  files behind the deployed Express API (Postgres adapter). The only
  difference between targets is how the server process starts and which
  DB adapter it uses — already true of the backend, now also true of how
  the frontend is served.
- **shadcn/ui (Radix + Tailwind)** for components — copy-in, not an npm
  dependency, so the warm-boutique reskin (custom color tokens, rounder
  corners, softer shadows) is a Tailwind config change, not a fight with
  a component library's theme API.
- **lucide-react** for icons — the icon set shadcn/ui is built around,
  used consistently across nav, buttons, and status indicators instead of
  emoji.
- **TanStack Query** for all API calls — caching, invalidation, loading
  states, identical in both build targets since both talk to the same
  REST API shape.
- **react-hook-form + zod** for forms, reusing the backend's existing Zod
  schemas (`createClient`, `createProduct`, `createAllocation`, etc.) so
  frontend and backend validation can't drift apart on shape, even though
  each still validates independently (frontend for UX, backend as the
  source of truth).
- **react-i18next** for pt-BR, per the whole-app i18n design — UI strings
  as translation keys from day one, `Intl.DateTimeFormat`/`NumberFormat`
  for dates and currency.
- **react-big-calendar** used only for the month-view toggle (see Calendar
  screen below) — not the primary calendar UI.

### Auth

JWT from `POST /api/auth/login` stored in memory + `localStorage` (web) /
Electron's renderer storage (desktop) — same mechanism in both targets
since Electron's renderer is just a Chromium context. An axios/fetch
wrapper in `lib/api.ts` attaches `Authorization: Bearer <token>` to every
request and redirects to the login screen on a `401`.

## Screens

### App shell

Sidebar nav (Painel/Clientes/Produtos/Alocações/Calendário), collapsing to
icon-only at tablet width — labels reappear on hover/tap. Current
logged-in staff name shown at the bottom of the sidebar.

### Dashboard (landing screen)

Three stat tiles — Saindo hoje / Voltando hoje / Atrasados — sourced from
the existing `/api/calendar/going-out`, `/due-back`, `/overdue` endpoints
scoped to today, plus a short "upcoming events" list. This is the first
thing staff see after login, giving the overdue-alert visibility called
out as a goal in the whole-app spec without requiring a click into the
full calendar.

### Clients / Products

Both follow the same table + detail-drawer pattern: a searchable/filterable
table (name+phone+email+notes-preview for Clients; photo thumbnail+name+
category+size+price+status badge for Products), a "+ Novo" button opening
the same right-side drawer (create mode, empty form), and clicking a row
opens that drawer in edit mode with the record's full detail pre-filled.
One drawer component per domain, two modes, not two separate UIs. Delete is only offered when the record has no
allocation history (per the backend's `CANNOT_DELETE_WITH_HISTORY` rule);
otherwise the drawer only offers edit/status-change actions.

### Allocations

A table of allocations (product → client, date range, status badge) with
status-aware row actions: `reserved` rows get Check-out/Cancelar buttons,
`checked_out` rows get a Devolver button, `returned`/`cancelled` rows are
read-only. "+ Nova alocação" opens a form: pick client → pick product
(the product picker calls `/api/allocations/products/:id/availability`
live as dates are chosen, hiding/disabling products that aren't available
for the selected range) → dates → confirm. Check-out and Devolver open
small forms for condition notes and deposit collected/returned, matching
the backend's existing payload shape.

### Calendar

Defaults to a grouped agenda list (Hoje / Amanhã / this week, etc.), with
tabs matching the three calendar endpoints (Saindo/Voltando/Atrasados). A
"Ver mês" toggle switches to a `react-big-calendar` month grid for
forward planning (e.g. checking next month's bookings before confirming a
new allocation); clicking a day in month view jumps back to the agenda
view scrolled to that date. Agenda is the default because this is a tool
checked daily for immediate next actions, not a scheduling/planning tool
first — the month view exists for the secondary case of looking ahead.

## Data flow

Each `features/<domain>` folder owns its TanStack Query hooks (e.g.
`useClients`, `useCreateClient`) wrapping calls through `lib/api.ts`, and
its own zod-validated form component. Mutations invalidate the relevant
query keys on success (e.g. creating an allocation invalidates that
product's availability query and the calendar queries) so the UI reflects
server state immediately without manual refetch calls scattered through
components.

## Error handling

- Form-level: zod validation runs client-side first for instant feedback;
  a failed server validation (400 `VALIDATION_ERROR`) surfaces as a
  generic form error banner, since the backend doesn't return field-level
  detail beyond the error code today.
- Business-rule errors (409s like `PRODUCT_UNAVAILABLE`,
  `INVALID_ALLOCATION_TRANSITION`, `PRODUCT_NOT_IN_CIRCULATION`,
  `CANNOT_DELETE_WITH_HISTORY`) map to translated, specific messages via a
  lookup table keyed by the backend's error `code` — never hardcoded
  strings, consistent with the i18n design.
- `401` on any request clears the stored token and redirects to login.
- Hosted build: TanStack Query's built-in retry on network failure;
  optimistic UI rollback isn't needed given the domain (allocation
  actions are deliberately not optimistic — a double-booking bug from an
  optimistic UI masking a rejected request would be worse than a brief
  loading spinner).
- Local/Electron build: since the DB is on-disk with no network hop, the
  main process surfaces any child-process (backend) crash or disk I/O
  error as a native dialog rather than a silent failure, per the
  whole-app spec's existing requirement.

## Testing

- **Component tests** (Vitest + React Testing Library) for each feature's
  forms and list views — form validation, status-aware action rendering
  (e.g. an allocation row's buttons matching its status), and the
  availability-aware product picker.
- **E2E test** (Playwright), extending the happy-path test already
  planned at the whole-app level: log in → add client → add dress →
  allocate → check out → return, now driven through the actual UI instead
  of `curl`, verifying the dashboard/calendar reflect each state change.
- Electron-specific: a smoke test that the packaged app launches, spawns
  the backend child process, and reaches the login screen — catches
  packaging/path issues that a browser-only Playwright run can't.

## Open questions for later (not blocking v1)

- Exact Tailwind color tokens/typeface for the "warm boutique" visual
  identity — a follow-up styling pass once the component structure exists,
  not blocking the functional build.
- Photo upload target (local disk in Electron vs. cloud object storage in
  the hosted build) is already decided at the data-model level; the
  upload UI itself (drag-drop vs. file picker) can be decided during
  implementation of the Products screen.
