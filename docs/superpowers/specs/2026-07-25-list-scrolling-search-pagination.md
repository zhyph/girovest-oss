# List Scrolling, Search, and Contracts Pagination

Date: 2026-07-25
Status: Approved

## Goal

Client feedback flagged two related problems across Products, Clients,
Painel (dashboard), and Contracts pages:

1. Scrolling any long list loses the page title and action buttons — the
   same problem the calendar had before its own fix.
2. Contracts specifically load slowly with many records, and there's no
   way to search for a specific one.

A manual walkthrough of the just-shipped photo-intake redesign also found
`ProductDrawer`'s footer (Cancelar/Salvar/Excluir) overflows below the
viewport once photo thumbnails add height — same root cause, same fix,
scoped to the drawer instead of a full page.

## Decisions

- **Reuse the exact sticky-header/scrollable-middle pattern already shipped
  for the calendar** (`CalendarDayItemsList.tsx`: outer `flex min-h-0
  flex-1 flex-col`, scrollable middle `min-h-0 flex-1 overflow-y-auto`,
  pinned footer `flex-shrink-0`) — not a new pattern. Applied to:
  `ProductsPage`, `ClientsPage`, `ContractsPage`, `DashboardPage`, and
  `ProductDrawer`'s dialog (mirroring how `MonthView`'s day-items `Dialog`
  already does this).
- **`AppLayout.tsx`'s `<main>` stops owning page-level scroll.** Today
  `main` has `overflow-y-auto`, which is exactly what let content grow past
  the viewport with only `main` itself scrolling (title and buttons scroll
  away too). Each page now manages its own internal scroll region instead;
  `main` keeps `flex-1` for sizing but drops `overflow-y-auto`, and its
  inner wrapper propagates height (`flex h-full flex-col`) so each page's
  own `min-h-0 flex-1 overflow-y-auto` region actually has a bounded parent
  to scroll within.
- **Contracts gets real server-side pagination and search** — unlike
  Products/Clients (which already do a client-side filter over an
  already-small, already-loaded list and aren't reported as slow),
  Contracts' slowness is in the *initial fetch itself*
  (`contractService.ts`'s `listContracts` has no `take`/`skip` at all,
  fetching every contract every time). This needs real query-param-driven
  pagination (`page`, `pageSize`) and a search param (contract number or
  client name) on `GET /api/contracts`, not just client-side slicing of an
  already-fully-fetched list. Pagination controls mirror
  `CalendarDayItemsList`'s existing Previous/Next UI for consistency.
- **Painel (dashboard) gets the layout fix only, not a search box.** It's a
  stats/summary view (three stat tiles + an "upcoming" list), not a
  searchable record list — there's nothing to search for. "Add search
  everywhere" is interpreted as "everywhere a searchable list exists";
  Painel's "upcoming" list gets the scrollable-region treatment so it can't
  push the stat tiles off-screen, but no search input is added.
- **Products and Clients already have client-side search** (confirmed by
  reading both pages directly) — no changes needed there beyond the layout
  fix.
- **No change to Products/Clients' fetch strategy.** Their data volume
  isn't reported as slow; only Contracts' initial load is.

## Testing

- Server: `listContracts` pagination (page/pageSize honored, correct
  `hasMore`/total-count shape) and search (matches contract number or
  client name, case-insensitive under both SQLite and Postgres — apply the
  same `DB_PROVIDER`-conditional `mode: 'insensitive'` fix already used for
  product search).
- Client: each page's layout renders with a pinned header and an
  internally-scrolling list at a bounded viewport height (a Playwright
  check, not jsdom, since this is real layout overflow — matching how the
  Month-view dialog overflow bug was caught, jsdom doesn't compute box
  heights); Contracts' pagination controls and search box; `ProductDrawer`'s
  footer stays reachable regardless of photo count.
- Manual verification: the same viewport-overflow measurement approach used
  to find the `ProductDrawer` bug in the first place, re-run against all
  five surfaces after the fix.
