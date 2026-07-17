# Dress Store Rental Management App — Design

## Problem

The client runs a single-location dress rental store and currently has no
system to track which dresses are with which clients and when they're due
back. They want to (a) register clients and products, (b) allocate a dress
to a client so it becomes unavailable to everyone else, and (c) see when
each dress is going out and coming back. They plan to expand to more
locations in the future, and want both a local desktop app and a hosted
web app.

## Goals

- Track clients and products (dresses) as first-class records.
- Allocate a dress to a client for a date range; prevent double-booking.
- Show a calendar/list of upcoming checkouts and returns, including overdue
  items.
- Ship as both a local desktop app (offline, single location) and a hosted
  web app (accessible remotely), from one codebase.
- Data model ready for multiple locations later, without a v1 migration.

## Non-goals (v1)

- Real payment processing (card capture, refunds) — only price/deposit
  record-keeping.
- Multi-location UI (location switcher, cross-location transfers) — the
  `location` field exists in the schema but v1 only ever has one row.
- SMS reminders — only in-app overdue flags and optional email alerts.
- Public-facing customer portal — staff-only tool.

## Architecture

One Node/TypeScript backend (REST API) and one React frontend, sharing a
single Prisma schema. Two deployment targets consume the same codebase:

- **Local build**: Electron shell spawns the backend as a child process on
  localhost, backed by a SQLite file on disk. No internet dependency.
- **Hosted build**: backend deployed normally (e.g. Render/Railway),
  backed by Postgres. Frontend served the same way as in the Electron
  shell, just over the internet instead of localhost.

The only difference between targets is the database connection string and
how the server process is started. All business logic, validation, and UI
are identical, so the two builds cannot drift apart in behavior.

## Data model

- **Location** — `id`, `name`, `address`. Seeded with a single row in v1.
- **Staff** — `id`, `name`, `login`, `password_hash`, `role`
  (`owner` | `staff`), `location_id`. Used for login and to record who
  checked a dress in/out.
- **Client** — `id`, `name`, `phone`, `email`, `notes`, `created_at`.
- **Product** (a dress) — `id`, `location_id`, `name`/style code,
  `description`, `category`, `size`, `color`, `rental_price`,
  `deposit_amount`, `photos` (list of file references), `status`
  (`available` | `reserved` | `rented` | `maintenance` | `retired`),
  `created_at`. Photo files are stored on local disk under the app's data
  directory in the Electron build, and in cloud object storage (e.g. S3 or
  the hosting provider's equivalent) in the hosted build; only the file
  reference/URL is stored in the database in both cases.
- **Allocation** — `id`, `product_id`, `client_id`, `staff_id`,
  `checkout_date`, `due_date`, `actual_return_date`, `status`
  (`reserved` | `checked_out` | `returned` | `cancelled`), `price_charged`,
  `deposit_collected`, `deposit_returned`, `condition_notes_out`,
  `condition_notes_in`, `created_at`.

Availability is not a stored boolean on `Product`. It's derived: a product
is unavailable for a requested date range if there exists an `Allocation`
in status `reserved` or `checked_out` whose `[checkout_date, due_date]`
range overlaps the requested range. This keeps the source of truth in one
place and avoids status drift between `Product.status` and reality.

## Core workflows

1. **Register client** — create/edit/search `Client` records.
2. **Register product** — create/edit dresses with photos, price, deposit,
   category/size/color, and status.
3. **Allocate** — pick a client + product + date range. Server checks for
   overlapping active allocations on that product inside a DB transaction
   (prevents two staff members double-booking the same dress
   concurrently), then creates the `Allocation` in `reserved` or
   `checked_out` status and flips `Product.status` accordingly.
4. **Check out** — mark a `reserved` allocation as `checked_out`, record
   condition notes and deposit collected.
5. **Return** — mark `checked_out` as `returned`, record
   `actual_return_date`, condition notes on return, and deposit returned
   (if applicable); `Product.status` flips back to `available` (or
   `maintenance` if condition notes flag damage).
6. **Cancel** — void a `reserved` allocation before checkout.
7. **Calendar/list views** — per-dress calendar of its allocations; a
   global "going out this week" / "due back this week" view; an overdue
   view (`due_date` in the past, status still `checked_out`).

## Error handling

- Required-field validation on client/product forms (server-side, not
  just UI).
- `due_date >= checkout_date` validated on allocation creation.
- Overlap check + allocation insert happen in a single DB transaction to
  prevent race conditions between concurrent staff actions.
- Hosted build: standard web error handling (request retries, optimistic
  UI rollback on failed mutations).
- Local build: no network-loss handling needed (DB is on-disk), but disk
  I/O errors should surface as a visible error rather than fail silently.

## Testing

- **Unit tests** (Vitest) for the availability-overlap logic and
  allocation status transitions — this is the one rule that must never be
  wrong, since a bug here means double-booking a physical dress.
- **Integration tests** for the allocation CRUD flow against a throwaway
  SQLite database.
- **E2E test** (Playwright) for the happy path: add client → add dress →
  allocate → check out → return, verifying the dress becomes unavailable
  during the rental and available again after return.

## Open questions for later (not blocking v1)

- Exact email provider/SMTP setup for overdue alerts — deferred until
  hosting is chosen.
- Whether `maintenance` status needs a separate workflow (e.g. cleaning
  turnaround time) beyond a manual status flip.
