import { z } from 'zod'

/**
 * The payload schemas for the two token-authorized phone submissions
 * (signature, photo batch), shared by BOTH transports that can carry them:
 * LAN mode's Express routes in `signingApp.ts` and relay mode's
 * `dispatchRelayMessage` in `network/relayClient.ts`.
 *
 * They live here, next to `productValidation.ts` (which the create-product
 * path already shares for the same reason), specifically so the two modes can
 * never validate differently again: under the relay these routes are reachable
 * from the internet for the token's whole TTL instead of being implicitly
 * gated by LAN proximity, so relay is the path that needs the checks MORE, not
 * less.
 */

// Constrained to exactly what canvas.toDataURL('image/png') produces in
// signingPage.ts's own script — this is an unauthenticated endpoint (the
// token is the only access control), so the payload shape can't be trusted
// beyond "some string": a well-formed PNG data URL rules out other MIME
// types (e.g. an SVG data URL, which can carry a <script>) ending up stored
// and later rendered via <img src=...> in the print view. The length cap is
// generous relative to the fixed 600x200 canvas's expected output (a few
// tens of KB) while still bounding worst-case storage.
const SIGNATURE_IMAGE_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

// Minted client-side as crypto.randomUUID() (36 chars); the cap only exists
// so an attacker can't use the key as an unbounded-string storage channel.
const idempotencyKeySchema = z.string().min(1).max(128).optional()

export const submitSignatureSchema = z.object({
  signatureImage: z.string().min(1).max(500_000).regex(SIGNATURE_IMAGE_PATTERN),
  idempotencyKey: idempotencyKeySchema,
})

export const submitPhotosSchema = z.object({
  productId: z.string().min(1),
  // The phone page compresses to <=1600px JPEG at quality 0.7 before
  // submitting, which lands far below this cap; the cap bounds what a raw
  // POST against the internet-reachable relay path can make the shop process
  // buffer and write per photo. The whole batch is additionally bounded to
  // 5 MB by the transport on both paths (express.json's limit on LAN, the
  // Worker's content-length check on relay).
  photos: z.array(z.string().min(1).max(2_000_000)).min(1).max(10),
  idempotencyKey: idempotencyKeySchema,
})
