# Contract Form: Client/Product Combobox with Inline Create

Date: 2026-07-31
Status: Approved (revised after opus adversarial review — see Revision Notes)

## Goal

Client feedback: with pen and paper she registered a walk-in client on the
spot while writing the contract. In this system, a client must already
exist before a contract can reference them, adding a detour through the
separate Clients page for every first-time renter. Streamline the contract
form so a brand-new client (and, while touching this form, a brand-new
product) can be created without leaving it, and replace both id-pickers
with a searchable combobox so they scale past the current small lists —
confirmed via a codebase scan that
`NewContractForm.tsx`'s client (`NewContractForm.tsx:229-234`) and product
(`ItemRow`, `NewContractForm.tsx:27-137`) selects are the *only* two
client/product id-pickers anywhere in the app, so no other form needs
touching.

## Decisions

### Combobox implementation — build on existing primitives, no new dependency

- **No `cmdk`/shadcn `Command`.** The codebase already has a proven,
  Popover-anchored, keyboard-navigable, accent-folding combobox pattern:
  `AutocompleteInput` (`client/src/components/ui/autocomplete-input.tsx`),
  built on `Popover`/`PopoverAnchor`/`PopoverContent`
  (`client/src/components/ui/popover.tsx`) plus `foldForSearch`
  (`client/src/lib/autocompleteMatch.ts:7`) for pt-BR accent-insensitive
  matching. `PopoverAnchor`'s own doc comment already anticipates this
  exact use ("a combobox opens against the whole field"). Introducing
  `cmdk` would add a second, differently-filtered combobox implementation
  and a second Radix Dialog dependency chain for no benefit — generalize
  the existing pattern instead.
- **New shared component: `EntityCombobox`** (`client/src/components/ui/entity-combobox.tsx`),
  generic over `{ id: string; label: string; sublabel?: string }`-shaped
  rows, following `AutocompleteInput`'s internal structure (open state,
  highlighted index, `foldForSearch`-based filtering, `Popover` +
  `PopoverAnchor` + `PopoverContent`, arrow-key/Enter/Escape handling) but
  selecting an entity id instead of free text, and always rendering one
  trailing "create new" row.
  - `ClientCombobox` and `ProductCombobox` are thin wrappers around
    `EntityCombobox` that map `Client[]`/`Product[]` into rows: client rows
    show `label = name`, `sublabel = phone`; product rows show
    `label = name`, `sublabel = "${size} · ${color}"`.
  - Filtering matches against **both** `label` and `sublabel`
    (`foldForSearch(name) + foldForSearch(sublabel)`), since a returning
    walk-in is as likely to be found by phone as by name.
  - The "create new" row is always the **last** row regardless of match
    count (a same-named match might not be who/what she means), so
    Enter/arrow-down-then-Enter on an empty highlight never accidentally
    creates a duplicate — the first real match stays first and highlighted
    by default. If the typed text is an exact case/accent-insensitive match
    for an existing row's `label`, the create row's text gains a small
    "already exists with this name" hint (no hard block — some walk-ins
    do share a name — but it stops the classic accidental-duplicate case
    for a returning client no one recognized).
  - Row/placeholder/hint/create-label strings are i18next keys (new keys
    under the `contracts`/`clients`/`products` namespaces as appropriate),
    not literal Portuguese text.

### React Hook Form wiring

- **Both `clientId` and `productId` become `Controller`-driven fields**,
  not `register`. `EntityCombobox` is a button-triggered popover, not a
  native input — `register`'s `{name,onChange,onBlur,ref}` contract assumes
  a DOM input element and RHF's `shouldFocusError` cannot focus a
  non-input ref, so the required-field error UX would silently degrade
  under `register`. This matches the file's existing convention: every
  non-native field here (`DateInput`, `CurrencyInput`) already uses
  `Controller`.
- **`priceCharged` auto-fill moves out of the `register` option bag.**
  Today (`NewContractForm.tsx:60-70`) it reads `event.target.value` off a
  native `<select>` change event inside `register`'s options — a
  `Controller`-driven combobox never fires that event, so this logic must
  move into the combobox's `onSelect(productId)` callback (or a
  `useEffect` keyed on the watched `productId`), setting
  `priceCharged` from the selected product's `rentalPrice` there instead.
  `useProductAvailability`'s wiring is unaffected — it already reads via
  `useWatch`, not the native event.

### Instant selection of a just-created entity

- **`onCreated` must seed the TanStack Query cache directly**, not rely on
  `setValue(id)` alone. `selectedClient` (`NewContractForm.tsx:177`) and
  `activeProducts` (`:209`) are both derived by scanning the
  `useClients()`/`useProducts()` list; a brand-new row isn't in that list
  until the `invalidateQueries` refetch from `useCreateClient`/
  `useCreateProduct` lands, which is not synchronous with the mutation
  resolving. Without seeding the cache: the combobox trigger has nothing
  to display as the current selection, the missing-fields readiness
  banner and its pre-submit confirmation gate (`:178`, `:194-200`) both
  silently evaluate as "nothing missing" for a client who was *just*
  created with only the fields she had time to type, and the product's
  price/size/color lookup misses entirely.
  - Fix: on create success, both `useCreateClient` and `useCreateProduct`
    (or the `onCreated` handlers in `NewContractForm`) call
    `queryClient.setQueryData(CLIENTS_KEY, (old) => [created, ...(old ?? [])])`
    / the product equivalent, so the new row is in the list immediately,
    ahead of the background refetch that later confirms it.
  - `setValue('clientId', newClient.id, { shouldDirty: true, shouldValidate: true })`
    (and the equivalent for `items.${index}.productId`) — bare `setValue`
    without `shouldDirty` would leave `isDirty` false if the inline-create
    path was the *only* interaction so far, meaning
    `useUnsavedChangesGuard` (`:175`) wouldn't arm and closing the sheet
    right after an inline create would silently discard the whole
    in-progress contract without confirmation.

### Drawer reuse for inline create

- **`ClientDrawer` gains `initialName?: string`** (used only when `client`
  is `null`), prefilling `defaultValues.name` from the combobox's typed
  text.
- **`ClientDrawer` gains `onCreated?: (client: Client) => void`**, called
  with the result of `createClient.mutateAsync(...)` right before
  `onClose()` in the create branch only (never on update).
- **`ProductDrawer` gains the equivalent `initialName?: string`.**
  `duplicateDefaults` already prefills category/size/color/price but
  deliberately excludes `name`, so this is additive.
- **`ProductDrawer`'s existing `onCreated` prop changes shape**: today
  it's called with the raw form values (`onCreated?.(normalized)`,
  `ProductDrawer.tsx:113`), which has no `id` to select by. It must
  instead be called with the created `Product` returned from
  `createProduct.mutateAsync(...)`.
  - The one existing consumer (`ProductsPage.tsx:144-153`'s "save and add
    another" flow) keeps working with one required fix: the server's
    `Product.description` is `string | null`
    (`server/src/services/productService.ts:18`) while the client's
    `ProductFormValues.description` is typed `string | undefined`
    (`productSchemas.ts`) — passing the raw created record straight into
    `defaultValues.description` for the next `register('description')`
    would hand an uncontrolled input a `null` value. `ProductsPage`'s
    callback must map `created.description ?? undefined` explicitly.
  - `ProductDrawer.test.tsx:359`'s mock (`vi.fn().mockResolvedValue(undefined)`)
    must resolve a `Product`-shaped object, not `undefined`, or the
    updated `onCreated` receives `undefined` in the test.
- **Both drawers mount as siblings of the contract `Sheet`, not nested
  inside its `SheetContent`.** This follows the file's own existing
  convention for the client-completion flow — `completingClient` is
  rendered as a sibling `<ClientDrawer>` after the closing `</Sheet>` tag
  (`NewContractForm.tsx:404`), which is also how Radix Dialog-based Sheets
  correctly stack (a Dialog nested inside another Dialog's scrolling
  content is not the same as two sibling Dialogs layered by portal/z-index).
  Two new pieces of state at the `NewContractForm` level:
  `creatingClient: string | null` (the typed name, or null when closed) and
  `creatingProductForIndex: { index: number; name: string } | null`
  (which item row triggered product creation, since items are a field
  array).
- **`ProductDrawer`'s "Salvar e adicionar outro" checkbox
  (`ProductDrawer.tsx:315-324`) must not render when the drawer is opened
  as an inline picker from the contract form.** Left as-is, checking it
  keeps the drawer open and each subsequent `onCreated` fire would
  overwrite the *same* contract line item's `productId`, silently
  discarding earlier creates. Add a boolean prop (e.g.
  `allowSaveAndAddAnother = true`, set to `false` from the contract-form
  call site) that hides the checkbox and forces `onClose()` after create
  regardless of its (now nonexistent, in this mode) checked state.
- **Widen `ItemRow`'s product list prop from `{ id; name; rentalPrice }[]`
  (`NewContractForm.tsx:41`) to the full `Product[]`** — the combobox row
  display needs `size`/`color` for the sublabel, which the narrower type
  doesn't carry today.
- **Creating a product inline still requires its full required fields**
  (category, size, color, rental price) — no shortcut, same as today's
  standalone "New product" flow. Only the client side gets a fast path,
  matching how she actually works today (full client record captured on
  the spot; products are pre-stocked inventory, confirmed with the user).

### Explicitly unaffected / out of scope

- `useProductAvailability`'s warning is unaffected by any of the above —
  it already reads the selected `productId` via `useWatch`, not a native
  change event.
- **No new fetch, pagination, or search params** on `/api/clients` /
  `/api/products` — the combobox filters the already-fetched
  `useClients()`/`useProducts()` list client-side. This mirrors the
  standing decision in `2026-07-25-list-scrolling-search-pagination.md`
  that client-side filtering is fine while these lists stay
  "already-small, already-loaded" — if the product catalog grows well
  past ~1000 items this assumption should be revisited, at which point
  `listProductsForLocation`'s existing `{ search, limit }` support
  (`server/src/services/productService.ts:172`, currently only wired to
  the mobile photo-session relay endpoint) is the natural extension
  point. Out of scope here.
- **No backend/API changes.** Creation still goes through the existing
  `POST /api/clients` / `POST /api/products` and their existing zod
  validation, untouched. No duplicate-detection added server-side for
  clients sharing a name — handled client-side only, as a soft hint (see
  above), not a hard constraint.
- **No atomic client+contract (or product+contract) transaction.** Still
  two requests in sequence (create entity, then it's selected in the
  contract form as normal) — not a single combined submit.
- **Scope is limited to `NewContractForm.tsx`, `ClientDrawer.tsx`,
  `ProductDrawer.tsx`, and the new `entity-combobox.tsx`.** List-page
  filters on the standalone Clients/Products pages are untouched
  (confirmed with the user as out of scope — those already work
  differently and aren't id-pickers).

## Testing

- `EntityCombobox`: filters by both label and sublabel, accent/case
  insensitively (`foldForSearch`); the create row always renders last
  regardless of match count; typing an exact existing-name match shows the
  "already exists" hint without blocking creation; Escape closes the
  popover without closing the parent Sheet; arrow keys / Enter select the
  highlighted row.
- `NewContractForm`: after creating a client inline, the combobox
  immediately displays the new client as selected (no dependency on
  refetch timing); the missing-fields readiness banner and pre-submit
  confirmation gate correctly fire for a client just created with
  incomplete info (this is the highest-risk, currently-easiest-to-miss
  path, since it exists specifically to protect walk-in clients); the form
  becomes dirty (`useUnsavedChangesGuard` arms) after an inline create
  even with no other field touched; required-field validation/error
  display still works for `clientId`/`productId` now that they're
  `Controller`-driven instead of `register`-driven; selecting a product
  via the combobox still drives `priceCharged` auto-fill correctly now
  that the logic lives in `onSelect` rather than a native change event.
- `ClientDrawer` / `ProductDrawer`: `initialName` prefills the name field
  only in create mode; `onCreated` fires with the correct payload shape
  (`Client` / `Product`, including `id`) in the create branch only, never
  in update; `ProductDrawer`'s "save and add another" checkbox is absent
  when `allowSaveAndAddAnother={false}`.
- Regression: `ProductsPage`'s "save and add another" flow still carries
  over category/size/color/price correctly now that `onCreated` receives
  the full `Product` instead of raw form values, including the
  `description: null → undefined` mapping (cover a product saved with no
  description).
- Manual verification: full walk-in flow — open a new contract, type a
  name that doesn't exist, create the client inline with an intentionally
  incomplete field (e.g. no address), confirm the readiness banner still
  catches it before submit, complete and save the contract, all without
  leaving the contract sheet.

## Revision Notes (2026-07-31, post-review)

An opus-tier adversarial review against the actual source caught three
blocking issues in the first draft, since fixed above:
1. The claim that `priceCharged` auto-fill "keys off `productId` exactly
   as today" was false — it lived inside a `register` option reading a
   native change event, incompatible with a non-native combobox trigger.
2. RHF field wiring (`register` → `Controller`) was never addressed for
   either `clientId` or `productId`.
3. `setValue(id)` alone doesn't make the just-created entity resolvable
   from the still-stale query cache, silently breaking the missing-fields
   confirmation gate for exactly the walk-in clients this feature exists
   to help.

It also surfaced that the codebase already has a suitable combobox
primitive (`AutocompleteInput`/`Popover`/`foldForSearch`) — the original
draft's plan to add `cmdk` was accordingly dropped in favor of
generalizing the existing pattern, plus a handful of smaller fixes
(drawer mount location, `description: null` typing gap, the
"save and add another" checkbox leaking into inline-create mode, and
`shouldDirty` on programmatic `setValue`) all folded into the Decisions
above.
