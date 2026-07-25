# Photo Intake Redesign — Session-Based, Camera-First, Multi-Photo

Date: 2026-07-24
Status: Approved

## Goal

Post-merge manual walkthrough surfaced that the just-shipped per-product photo
intake flow doesn't actually serve its stated purpose — fast, low-friction
photo attachment while registering ~1500 dresses. Client feedback (relayed by
the user) identified concrete problems:

1. Only one photo is accepted per session (should be many).
2. The phone page defaults to a file picker instead of the camera.
3. No visual confirmation of what was uploaded, on either side.
4. The QR/token is scoped to one product and must be re-scanned for every
   new product — the whole point of registering 1500 dresses fast is
   defeated if attaching photos requires re-opening a QR modal per item.
5. Photos currently can only be sent to an already-saved product, forcing
   staff to save first, then re-open to edit and attach photos — extra
   clicks multiplied by 1500.

This redesign replaces the per-product token model from the just-merged
feature with a session-based one that lets a single QR scan serve an entire
registration batch.

## Decisions

- **Session-level token, not per-product.** Replaces `ProductPhotoToken`'s
  per-product, single-use design. A new token is scoped to **staff +
  location**, issued from a new "Enviar fotos remotamente" button on the
  Products page (not inside each product's drawer — it's no longer tied to
  one product). Valid for a full work shift (12 hours) and **reusable across
  many submissions**, not consumed on first use.
  - **Explicit security tradeoff**: a leaked QR/URL could be used many times
    during that window, not just once, unlike the signing-token pattern this
    was originally modeled on. Accepted because the surface is LAN-only
    (never reachable outside the local network, same binding guarantee as
    existing remote signing) and shift-bound (12h TTL caps the blast
    radius) — the alternative (re-scanning per product) is exactly the
    friction this redesign exists to remove.
- **Phone becomes a two-screen flow**, still vanilla HTML/JS, no framework,
  no build step (matching the existing signing/photo page style):
  1. **Product picker**: a recency-sorted (`createdAt desc`) list of the
     location's products, with a text search box as a fallback. Polls
     periodically so a product saved moments ago on desktop appears without
     the phone page needing to reload.
  2. **Camera capture**, scoped to the tapped product's id, reusing the
     existing canvas-compression logic (max 1600px, JPEG ~0.7 quality) —
     but fixing the multi-photo bug and rebuilding the primary affordance:
     a prominent "Tirar Foto" button on a hidden file input with
     `capture="environment"` (invokes the camera directly on most mobile
     browsers), with a smaller, secondary "Escolher da Galeria" link
     (no `capture` attribute) for gallery access. Staff can take/add several
     photos before sending; "Enviar" submits all of them together, then
     shows "X fotos adicionadas" and returns to the product picker (not a
     terminal success/dead-end screen) — sending 1500 dresses through this
     flow means staying on this page all day.
- **This lets photos be attached during a create-then-continue batch
  workflow** without ever requiring a product to be saved-then-reopened:
  staff saves a product on desktop (optionally via "save and add another"),
  it appears in the phone's product list within one poll interval, staff
  taps it there and sends photos while continuing to type the next product
  on desktop. No per-product QR round-trip on the desktop side after the
  initial scan.
- **Visual feedback on the desktop side.** Confirm/ensure `ProductDrawer`
  (and anywhere else product photos render, e.g. the calendar's day-items
  list from the previous feature) shows real, appropriately-sized photo
  thumbnails once photos exist — this was reported as effectively invisible
  in the shipped version.
- **Server-side model change**: the new session token is not tied to a
  `productId` at issuance time; `productId` becomes part of each individual
  submit request instead, validated server-side against the token's own
  `locationId` (a staff can't attach a photo to another location's product
  even with a valid session token). The product-list endpoint the phone page
  polls is scoped the same way.
- **Replaces, not extends, the just-merged per-product flow.** The existing
  `ProductPhotoToken` model, `productPhotoTokenService.ts`,
  `AddPhotosRemotelyModal.tsx`, and the per-product route/button are reworked
  substantially rather than kept alongside a second parallel mechanism —
  having two different "send a photo remotely" flows would be confusing, not
  additive.
- **Seed data gets a real photo fixture.** The existing seed scripts use
  placeholder/`example.com` URLs or trivial 1x1 test images, which made the
  shipped feature impossible to visually verify. Add one real small JPEG
  fixture file to the repo and reference it from whichever seed script(s)
  create demo/test products, so photo-related features are visually
  checkable during manual testing going forward.

## Out of scope (separate items from the same feedback round, tracked
## separately, not part of this spec)

- Contracts list performance + pagination/search.
- App-wide "long list loses its header while scrolling" fix across
  Products/Clients/Painel(dashboard)/Contracts.

## Testing

- Server: session-token issuance/expiry/reissue tests (mirroring the prior
  plan's service tests, adapted for the non-single-use model); the
  product-list endpoint's location-scoping and recency ordering; the
  photo-submit endpoint's `productId` validation against the token's own
  location.
- Client: the product-picker phone-page screen (search, recency order,
  polling picks up newly-created products); the camera-capture screen
  (multi-photo genuinely works — a regression test for the original bug);
  `ProductsPage`'s new session-QR trigger; `ProductDrawer`/wherever else
  renders photos, confirming thumbnails are actually visible.
- Manual verification: a real end-to-end walkthrough (as was done for the
  prior version) — scan once, create two products in a row on desktop, send
  photos to each from the phone without re-scanning, confirm both appear
  correctly on the desktop side.
