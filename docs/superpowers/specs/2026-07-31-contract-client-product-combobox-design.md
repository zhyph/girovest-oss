# Contract Form: Client/Product Combobox with Inline Create

Date: 2026-07-31
Status: Approved

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

- **Both id-pickers become a combobox** (`Popover` + a new `Command`
  component from shadcn/`cmdk`, not yet in this repo — add via the shadcn
  CLI). Typing filters the already-fetched `useClients()`/`useProducts()`
  list client-side; no new fetch, no pagination/search params added to
  `/api/clients` or `/api/products`. This mirrors the standing decision in
  `2026-07-25-list-scrolling-search-pagination.md` that client-side
  filtering is fine while these lists stay "already-small, already-loaded"
  — if the product catalog grows well past ~1000 items this assumption
  should be revisited, at which point `listProductsForLocation`'s existing
  `{ search, limit }` support (`server/src/services/productService.ts:172`,
  currently only wired to the mobile photo-session relay endpoint) is the
  natural extension point. Out of scope here.
- **Client rows show name + phone**, product rows show **name + size +
  color**, since either can collide on name alone (e.g. multiple "Vestido
  Longo" entries in different sizes).
- **Both lists end with a `+ Criar <cliente|produto> "<texto digitado>"`
  row**, always visible (not only on zero matches — a same-named
  match might not be who/what she means). Selecting it opens the existing
  drawer (`ClientDrawer` / `ProductDrawer`) in create mode, reused as-is for
  full field parity and validation — no duplicated form logic.
- **`ClientDrawer` gains an `initialName?: string` prop** (used only when
  `client` is `null`), prefilling `defaultValues.name` from the combobox's
  typed text.
- **`ClientDrawer` gains an `onCreated?: (client: Client) => void` prop**,
  called with the result of `createClient.mutateAsync(...)` right before
  `onClose()` in the create branch. `NewContractForm` uses it to
  `setValue('clientId', newClient.id)` and update the combobox's displayed
  selection immediately, without waiting on the `['clients']` query
  invalidation/refetch that `useCreateClient` already triggers.
- **`ProductDrawer` gains the equivalent `initialName?: string` prop.**
  `duplicateDefaults` already prefills category/size/color/price but
  deliberately excludes `name`, so this is additive.
- **`ProductDrawer`'s existing `onCreated` prop changes shape**: today it's
  called with the raw form values (`onCreated?.(normalized)`,
  `ProductDrawer.tsx:113`), which has no `id` to select by. It must instead
  be called with the created `Product` returned from
  `createProduct.mutateAsync(...)`. The one existing consumer
  (`ProductsPage.tsx:144-149`'s "save and add another" flow, which reads
  `category`/`size`/`color`/etc. off the callback argument) keeps working
  unchanged since `Product` is a superset of those fields; its test
  (`ProductDrawer.test.tsx:359`) needs updating to match the new shape.
- **Creating a product inline still requires its full required fields**
  (category, size, color, rental price) — no shortcut, same as today's
  standalone "New product" flow. Only the client side gets a fast path,
  matching how she actually works today (full client record captured on
  the spot; products are pre-stocked inventory, confirmed with the user).
- **Selecting a product from the combobox preserves existing behavior
  unchanged**: `priceCharged` auto-fill from `rentalPrice` and the
  `useProductAvailability` warning both still key off the selected
  `productId` exactly as today — only the picker UI changes.
- **No backend/API changes.** Creation still goes through the existing
  `POST /api/clients` / `POST /api/products` and their existing zod
  validation, untouched.
- **No atomic client+contract (or product+contract) transaction.** Still
  two requests in sequence (create entity, then it's selected in the
  contract form as normal) — not a single combined submit.
- **Scope is limited to `NewContractForm.tsx`, `ClientDrawer.tsx`, and
  `ProductDrawer.tsx`**, plus the new shared combobox UI piece. List-page
  filters on the standalone Clients/Products pages are untouched (confirmed
  with the user as out of scope — those already work differently and
  aren't id-pickers).

## Testing

- Client: combobox filters the existing client/product list by typed text
  (name for clients; name/category/size/color for products); the "create"
  row always appears and opens the right drawer prefilled with the typed
  text; after a successful create, the new client/product is selected in
  the contract form without a manual refetch/re-search step.
- `ClientDrawer` / `ProductDrawer`: `initialName` prefills the name field
  only in create mode; `onCreated` fires with the correct payload shape
  (`Client` / `Product`, including `id`) in the create branch only, never
  in the update branch.
- Regression: `ProductsPage`'s "save and add another" flow still carries
  over category/size/color/price correctly now that `onCreated` receives
  the full `Product` instead of raw form values.
- Regression: selecting a product via the combobox still drives
  `priceCharged` auto-fill and the availability warning exactly as before.
- Manual verification: full walk-in flow — open a new contract, type a
  name that doesn't exist, create the client inline, confirm it's selected
  and the contract can be completed and saved, in one continuous pass
  without leaving the contract sheet.
