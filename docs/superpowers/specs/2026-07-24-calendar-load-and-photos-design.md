# Calendar: Hundreds-of-Items Behavior + Product Photos

Date: 2026-07-24
Status: Approved

## Goal

Two client-reported items, combined because they touch the same calendar
list-rendering surfaces:

1. Verify (and fix if broken) how the calendar behaves when a single day has
   hundreds of allocations — a real scenario for this shop.
2. Show product photos in the calendar, so staff can visually identify what's
   going out/coming back without opening each product individually.

Empirical investigation (Playwright, 300 same-day allocations seeded) found:
Agenda view renders 300 items without crashing (~212ms, no jank), but as one
long unpaginated scroll. Month view has a **real functional bug**: clicking
the "+N more" overflow link on a busy day bounces back to Agenda view instead
of showing the day's items, because `MonthView.tsx` routes `onSelectSlot`/
`onDrillDown`/`onSelectEvent` all through the same `onSelectDay` handler
instead of using react-big-calendar's dedicated `onShowMore(events, date)`
callback for the overflow-link click.

The user also wants the whole calendar page to stay within one viewport (no
page-level scroll growing with item count) — investigation found the root
cause is in the shared `AppLayout.tsx` (`min-h-screen` instead of `h-screen`,
which leaves `main`'s existing `overflow-y-auto` unable to activate), not
anything calendar-specific.

## Decisions

- **Fix `AppLayout.tsx` globally**, not just for Calendar: `min-h-screen` →
  `h-screen` on the outer shell. `main`'s existing `flex-1 overflow-y-auto`
  then correctly becomes the app's one internal scroll region, capping every
  page at 100vh. This is a considered global change (not a calendar-local
  workaround) — it's the correct general app-shell pattern and every other
  page already assumes `main` scrolls internally (that class was already
  there, just inert).
- **One shared paginated list component**, `CalendarDayItemsList`,
  used by both Agenda view (each day-group renders through it, replacing the
  current flat unbounded `.map()`) and Month view (opened in a `Modal` on
  `onShowMore`, replacing the broken drill-down routing). Default page size
  20. Each row: a small thumbnail (`product.photos[0]`, reusing
  `ProductDrawer.tsx`'s existing `h-8 w-8 rounded object-cover` pattern),
  product name, client name, date.
- **New read-only `ProductDetailModal`**, opened by clicking a row in the
  shared list. Shows full product info (name, category, size, color, rental
  price, deposit, description, all photos). `ProductDrawer.tsx` has no
  view-only mode (always an editable form), so this is a new, separate,
  read-only component — not a repurposed `ProductDrawer`, to avoid exposing
  edit actions from a calendar-browsing context.
- **Month view's overflow click uses `onShowMore(events, date)`** (react-big-
  calendar's dedicated callback for the "+N more" link, confirmed via
  Context7 docs), not the library's own built-in `popup` overlay — this
  gives full control to reuse the same paginated/thumbnail/click-through list
  as Agenda, instead of two different overflow UX patterns.
- **No API/schema changes.** `Product.photos` is already parsed to `string[]`
  by the time it reaches the client (`productSchemas.ts`); the shared list
  and detail modal reuse the existing `useProducts()` call already made by
  `CalendarPage.tsx` for both the thumbnail lookup and the detail-modal data
  — no new fetch.
- **Pagination, not infinite scroll**, for the fixed-height list — simpler,
  predictable performance at any volume, no virtualization/intersection-
  observer complexity needed. (User's explicit choice.)
- **Out of scope, flagged for later, not fixed here:** `useProducts()`/
  `useClients()` fetch all rows unfiltered on every Calendar visit — currently
  trivial (2 products, 2 clients in dev), but the client's separately-stated
  plan for ~1500 products means this fetch will grow independently of
  same-day item volume. Worth a future look, not part of this fix.
- **Reusable load-test seed script.** Formalize the investigation's throwaway
  seed (`server/seed-calendar-load-test-tmp.mjs`) into
  `server/seed-e2e-calendar-load.ts`, following the existing `seed-e2e*.ts`
  pattern (fixed IDs, idempotent upserts) — ~300 same-day allocations for
  regression testing and any future manual load testing.

## Testing

- Vitest: the shared paginated list component renders the correct page size,
  paginates correctly at volume, and renders a thumbnail from
  `product.photos[0]` (falling back gracefully when a product has no photos).
- Playwright e2e, using the formalized seed script:
  - Month view's "+N more" link opens the shared list (populated, paginated)
    instead of bouncing to Agenda — direct regression test for the bug found.
  - Agenda view's per-group pagination works at ~300 items in one group.
  - Clicking a row opens `ProductDetailModal` with the right product's data.
  - The app stays within one viewport (no page-level scroll) at this volume
    — a basic check that `AppLayout`'s fix holds under load, not just in the
    empty/small-data case.
- Existing `AgendaView.test.tsx` / `MonthView.test.tsx` / `CalendarPage.test.tsx`
  keep passing, updated only where the paginated-list refactor changes what
  they need to assert (e.g. no longer asserting every allocation renders as a
  flat list, since that's no longer how it renders).
