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
   single-use token for that Contract, expiring in ~15 minutes.
2. Desktop renders a QR code for `http://<lan-ip>:<lan-port>/sign/<token>`,
   using the machine's detected LAN IPv4, and starts watching that Contract's
   status live (SSE/poll against the *main* localhost API — the desktop
   never talks to `signingApp` directly).
3. The client's phone scans the code, loads the signing page, signs.
4. On submit, `signingApp` validates and stores; the desktop's live view
   updates automatically and staff can print the completed document.

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

- `contractService.test.ts` / `installmentService.test.ts` — creation,
  numbering race, locking after signature, cancel cascade.
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
