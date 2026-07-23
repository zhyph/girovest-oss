# Rental Contract Design

Date: 2026-07-23
Status: Approved

## Goal

Replace the paper "Contrato de Compromisso" pad (Priscila Moda Festa) with a
full in-app rental contract: same required fields, same legal clauses, same
sequential numbering, printable, and signable either by hand or remotely via
a phone over the local network. The goal is for staff to never need to fall
back to the paper form because something is missing.

Two constraints shape every decision below:

- **Not Brazil-only.** The project's original design already commits to a
  locale-agnostic backend and an i18n layer built (but not yet used) to
  support more than `pt-BR`. Nothing new in this feature may hardcode a
  Brazil-specific document, address shape, or payment method into the schema
  or backend logic.
- **Full parity or it's not good enough.** Every field on the paper contract
  becomes required in the app; anything already in the schema that isn't on
  the paper contract stays optional.

## Decisions

- Multiple rented pieces per event are modeled as a new **Contract** entity
  that groups existing **Allocation** rows — each item keeps its own
  checkout/return/deposit/condition-notes lifecycle; the Contract adds the
  event date, contract number, payment method, and installment schedule on
  top.
- Contract becomes the **required entry point for booking** — the standalone
  single-item "New Allocation" flow is replaced by a multi-step "New
  Contract" flow. `AllocationsPage`/`NewAllocationForm` become
  `ContractsPage`/`NewContractForm`; per-item checkout/return actions move
  under each Contract's line-item list, otherwise unchanged.
- Client identity documents (CPF/RG equivalents) and address are modeled as
  **repeatable label/value lists**, not fixed columns — no assumption about
  how many ID documents or address lines any given country uses.
- Payment method (Dinheiro/Cheque/PIX) is a **freeform string**, with the
  offered options driven by a per-locale configured list — PIX is a
  Brazil-specific instant-payment system and can't be a hardcoded enum value.
- Installments are **entered manually, one row at a time** (date + amount +
  paid/unpaid), matching the paper table exactly rather than assuming a
  payment cadence.
- Legal clause text is **editable per Location**, not hardcoded — a shop's
  terms can change without a code change.
- Line items must be **catalog Products only** — no free-text "extra" items
  that would leave the system unable to account for something that changed
  hands.
- Signing supports **both** pen-on-paper printing and remote signing: staff
  hands the client a dedicated phone/tablet, which scans a QR code, opens a
  signing page over the local network, and the resulting signature image
  embeds into the same printable document (no separate "signed" vs "unsigned"
  document shape).
- The remote-signing surface is a **second, minimal Express server** bound to
  the LAN interface, in the same backend process, exposing only the sign/
  submit routes — the existing authenticated API server keeps binding to
  `127.0.0.1` exactly as it does today, untouched.
- Existing hardcoded `pt-BR`/`BRL` formatting (`CurrencyInput`, `DateInput`,
  and several scattered `Intl.DateTimeFormat('pt-BR', ...)` call sites) gets
  fixed as part of this work, since installments and contract totals are the
  heaviest new consumer of exactly that hardcoding.

## Data model

```prisma
model ClientIdentityDocument {
  id       String @id @default(uuid())
  clientId String
  label    String   // "CPF", "RG", "Passport" — whatever the locale calls it
  value    String
  maskKey  String?  // stable key (e.g. "br-cpf") driving input masking;
                     // independent of the editable label
  client   Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

model ClientAddressLine {
  id        String @id @default(uuid())
  clientId  String
  label     String   // "Endereço", "Bairro", "Cidade", "Estado" — locale-defined
  value     String
  sortOrder Int
  maskKey   String?
  client    Client @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

model Contract {
  id              String    @id @default(uuid())
  number          Int       // sequential per Location, assigned on creation
  locationId      String
  clientId        String
  staffId         String
  eventDate       DateTime
  paymentMethod   String    // freeform, locale-configured list in the UI
  signatureStatus String    @default("unsigned") // unsigned | signed
  signatureImage  String?   // captured PNG once signed
  signedAt        DateTime?
  createdAt       DateTime  @default(now())

  location     Location      @relation(fields: [locationId], references: [id])
  client       Client        @relation(fields: [clientId], references: [id])
  staff        Staff         @relation(fields: [staffId], references: [id])
  allocations  Allocation[]
  installments Installment[]

  @@unique([locationId, number])
}

model Installment {
  id         String    @id @default(uuid())
  contractId String
  dueDate    DateTime
  amount     Float
  paid       Boolean   @default(false)
  paidAt     DateTime?
  contract   Contract  @relation(fields: [contractId], references: [id], onDelete: Cascade)
}

model LocationContractClause {
  id         String   @id @default(uuid())
  locationId String
  sortOrder  Int
  text       String
  location   Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
}
```

Changes to existing models:

- `Allocation` gains a required `contractId` FK — every Allocation now
  belongs to exactly one Contract.
- `Location` gains `phone String?` (for the printed header) and the
  `LocationContractClause` relation above.
- A Contract's printed total ("VALOR TOTAL") is derived as
  `sum(allocations.priceCharged)`, never stored separately, so it can't drift
  out of sync with its line items.

Nothing here encodes what "CPF" or "Bairro" mean, or what PIX is — those are
labels and configured options, never schema or backend logic. Required-ness
of specific documents/address lines/payment methods lives entirely in a
per-locale UI template (below), not in the database.

`signatureImage` is a captured drawing, not an uploaded photo: the signing
canvas itself is fixed-size and downsampled before submit (target: a few
tens of KB as a base64 PNG), so storing it inline as a `String` in SQLite
stays a deliberate, bounded size budget rather than an open-ended blob.

## Data migration

This app auto-updates live installs (per the in-progress v0.2.3→v0.2.4
rollout), so existing production databases already have `Allocation` rows
with no `Contract` to attach to. `Allocation.contractId` can't simply be
added as required — the migration needs a backfill step first.

**Decision: one synthetic Contract per existing Allocation (1:1), not
grouping by client/date.** Grouping heuristically (e.g. same client within
a date window) risks silently bundling unrelated rentals under one
contract number; a 1:1 mapping is safe, reversible, and doesn't need to
guess intent.

Migration steps, run once as part of the standard startup migration path
(`runMigrations` in `client/electron/main.ts`, same as every other schema
change), for both the SQLite and PostgreSQL schema directories:

1. Add `Allocation.contractId` as **nullable** first — a required column
   can't be added directly to a non-empty table with no static default that
   fits every row.
2. For every existing `Allocation`, create one `Contract` row:
   - `locationId` — derived via `allocation.product.locationId` (already
     reliable; `Product` has always had a location).
   - `clientId`, `staffId` — copied directly from the `Allocation`.
   - `eventDate` — defaulted to the `Allocation`'s `checkoutDate` (the best
     available proxy; nothing better exists pre-migration).
   - `paymentMethod` — defaulted to a clearly-labeled placeholder (e.g.
     `"(não informado)"`), never left blank, since the column stays
     required and there's no historical record of how these were paid.
   - `signatureStatus` — `unsigned` (accurate: no digital signature ever
     existed for these).
   - `number` — assigned sequentially per `locationId`, ordered by the
     original `Allocation.createdAt`, so historical ordering is preserved
     and the sequence continues contiguously for new contracts created
     after the migration.
   - Set the new `Allocation.contractId` to point at the Contract just
     created for it.
3. Alter `Allocation.contractId` to **required**, now that every row has
   one.
4. Seed `LocationContractClause` with the six paper clauses (translated,
   pt-BR) for every existing `Location`, so printing works immediately
   after upgrade instead of producing a contract with a blank legal
   section until a human retypes them.

Covered by a dedicated migration test: seed a pre-migration-shaped
database (Allocations with no Contract), run the migration, assert every
Allocation now has exactly one Contract, numbering is unique and
sequential per location, and every existing Location has clause text.

## Locale template

One `pt-BR` template object drives what the "New Contract" flow pre-seeds and
requires — parallel to the existing translation JSON files, referenced only
by the frontend:

```ts
{
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
  paymentMethods: ['Dinheiro', 'Cheque', 'PIX'],
}
```

A future locale ships its own version of this object — no schema, backend
route, or print/signing logic changes. The mask registry (`br-cpf` → CPF
formatter `000.000.000-00`; `br-rg` → best-effort grouping formatter
`00.000.000-0` with an optional trailing letter, since RG has no single
national standard — neither is validated for correctness, only formatted as
typed) lives next to this template, following the same
formatter-function-plus-controlled-input pattern already used by
`PhoneInput`/`CurrencyInput`.

Rows without a recognized `maskKey` (a custom staff-added document, or a
locale that hasn't defined one) render as plain text input.

## Required-ness scope

Identity documents and address lines are **not** required to save a Client —
`ClientDrawer` stays lightweight (name + phone, as today), so a casual
contact can be added before they've committed to renting. They're required
to **finalize a Contract**: step 1 of "New Contract" checks the selected
client against the locale template and surfaces any missing required
document/address rows inline, filled in without leaving the flow.

## Workflow

`NewContractForm` steps:

1. **Client** — pick or create a client; fill any missing required
   identity/address rows inline if needed.
2. **Event** — event date.
3. **Items** — add one or more catalog Products; each becomes a line item
   with its own checkout/due date and price, reusing the existing per-product
   availability check.
4. **Payment** — payment method (from the locale-configured list) and
   installment rows (date + amount + paid/unpaid), added one at a time.
5. **Review & create** — submits Contract + Allocations + Installments
   together; assigns the next sequential contract number for the Location,
   using the same serializable-transaction-with-retry pattern already in
   `allocationService.ts` (`MAX_WRITE_CONFLICT_RETRIES`) so concurrent
   contract creation can't collide on a number.

After creation, the Contract detail view offers **Print** and **Sign
remotely (QR)**.

`ContractsPage` replaces `AllocationsPage` as the sidebar's primary
"Contratos" entry; each Contract row expands to its line items with the
existing per-item checkout/return/cancel actions, unchanged in behavior.

## Print

The final contract is a React view rendered in the Electron app (Location
header, client info, line items, installment table, clauses, signature area)
printed via Electron's native print/print-to-PDF — no new dependency for
this part. If signed remotely, the captured signature image renders into the
same signature line a hand-signed copy would leave blank; there is exactly
one document shape either way.

## Remote signing

A second `express()` app (`signingApp`) runs in the same backend process
already spawned by Electron, bound to the LAN interface, exposing only:

- `GET /sign/:token` — a small standalone mobile signature page (plain
  HTML/JS, no CDN dependencies, everything bundled — the signing phone can't
  be assumed to have general internet access), with a draw-to-sign canvas.
- `POST /sign/:token/submit` — accepts the signature image, validates the
  token (not expired, not already used), stores it, marks the Contract
  signed.

The existing authenticated API server (`app`) keeps binding to `127.0.0.1`
exactly as today; both apps share the same Prisma/SQLite connection within
the one process, so a submission on `signingApp` is immediately visible to
`app`.

Flow:

1. Staff clicks "Sign remotely" → the authenticated, localhost API creates a
   single-use token for that Contract, expiring in ~15 minutes. The token is
   the *only* access control on an unauthenticated, LAN-exposed endpoint, so
   it's generated with `crypto.randomBytes(32).toString('base64url')` (256
   bits of entropy from Node's built-in `crypto` module, no new dependency)
   — never a sequential ID or anything guessable.
2. Desktop renders a QR code for `http://<lan-ip>:<lan-port>/sign/<token>`,
   using the machine's detected LAN IPv4, and starts watching that Contract's
   status live (SSE/poll against the *main* localhost API — the desktop
   never talks to `signingApp` directly).
3. The client's phone scans the code, loads the signing page, signs.
4. On submit, `signingApp` validates and stores; the desktop's live view
   updates automatically and staff can print the completed document.

**LAN IP selection.** `os.networkInterfaces()` commonly returns more than
one candidate (VPN adapters, Docker/virtualization bridges, etc.), and
silently picking the wrong one produces a QR code the phone can never
reach. Selection rule: filter to non-internal IPv4 addresses in RFC1918
private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and
exclude interface names matching known virtual-adapter patterns (`docker`,
`veth`, `vmnet`, `vboxnet`, `utun`/`tun`/`tap`, common VPN naming). If
exactly one candidate survives, use it automatically. If more than one
survives, show a small picker in the "Sign remotely" dialog (interface
name + IP) instead of guessing — this is a real, distinct failure mode
from "no interface found" and needs its own affordance, not just a silent
default to the first match.

Edge cases: an expired or already-used token shows a clear
"ask staff for a new code" message on the phone; staff can generate a fresh
token at any time, invalidating the previous one. No usable LAN interface
detected disables "Sign remotely" with an explanation; print is unaffected
either way. If the phone can't reach the machine at all (e.g. router client
isolation), print-and-pen still works — a Contract's validity never depends
on the digital path.

## Locking and cancellation

- Once a Contract's `signatureStatus` is `signed`, its terms (line items,
  payment plan, event date) become read-only. Operational actions (per-item
  checkout/return, marking an installment paid) stay available regardless.
- Cancelling a whole Contract cascades to cancel only its still-`reserved`
  Allocations (the same rule `cancelAllocation` already enforces per item) —
  items already checked out or returned are unaffected. `Contract` has no
  separate `status` column for this: whether a contract reads as active or
  cancelled is derived from its Allocations' statuses, the same way product
  availability is already derived rather than stored
  (`domain/occupancy.ts`'s `derivedAvailability`).

## Locale plumbing fix

Existing gap found while designing this feature: `CurrencyInput` hardcodes
`Intl.NumberFormat('pt-BR', { currency: 'BRL' })`, `DateInput` hand-rolls a
fixed `DD/MM/AAAA` mask, and several files (`AgendaView`, `DashboardPage`,
the allocations date formatter) construct their own hardcoded
`Intl.DateTimeFormat('pt-BR', ...)`. `Location.locale` already exists
server-side for exactly this purpose but isn't surfaced to the frontend at
all. Fixed as part of this work, since installments and contract totals are
the heaviest new consumer of this exact hardcoding:

- `GET /api/auth/me` adds `locale: staff.location.locale` to its response.
- New `useLocale()` hook reads `useAuth().staff?.locale`, falling back to
  `'pt-BR'` for the pre-auth window (login screen).
- A small locale-config map (client-side, next to the identity/address/
  payment-method templates above) pairs each locale with its currency code
  and date-mask pattern, e.g. `{ 'pt-BR': { currency: 'BRL', dateMask:
  'DD/MM/YYYY' } }`. `CurrencyInput` and `DateInput` read this via
  `useLocale()` instead of a literal.
- The scattered display-only date formatters consolidate into one shared
  `formatDate(date, locale)` helper.
- `i18n.ts`'s initial `lng: 'pt-BR'` stays as the pre-auth default; once
  `staff` loads, `i18n.changeLanguage(staff.locale)` is called — a no-op
  today (only `pt-BR` resources are registered) but the mechanism is in
  place for a second locale.
- `MonthView`'s calendar `culture="pt-BR"` is left as-is functionally:
  `react-big-calendar` needs an actual locale pack per language, which
  doesn't exist for anything but `pt-BR` yet — nothing to wire dynamically
  until one is added.

## Testing

Following the existing per-layer pattern (`*Service.test.ts`,
`*Schemas.test.ts`, route tests, component tests):

- **Migration test** (see Data migration above) — pre-migration-shaped
  fixture in, assert every Allocation gets exactly one Contract, numbering
  is unique/sequential per location, every Location gets seeded clause
  text.
- `contractService.test.ts` / `installmentService.test.ts` — creation,
  numbering race (including the DB-level `@@unique([locationId, number])`
  constraint catching what the transaction retry logic misses), locking
  after signature, cancel cascade.
- `signingService.test.ts` — token issuance/expiry/single-use, and that
  `signingApp` truly exposes nothing beyond the sign/submit routes.
- `clientSchemas.test.ts` updates — identity document / address line
  validation.
- Mask formatter unit tests (`br-cpf`, `br-rg`), same style as the existing
  `formatPhone` tests.
- `NewContractForm.test.tsx`, `ContractsPage.test.tsx` — multi-step flow,
  inline client-completion step.
- `useLocale`/`CurrencyInput`/`DateInput` tests updated for locale-driven
  formatting instead of a hardcoded literal.
- Print view — structure/snapshot test rather than visual, no headless print
  pipeline needed.
