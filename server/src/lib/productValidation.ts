import { z } from 'zod'

/**
 * The field shape shared by every path that creates a product: the
 * authenticated desktop route (`POST /api/products`, which adds `locationId`
 * and `photos`) and the token-authorized phone route
 * (`POST /product-photos/:token/products`, which adds nothing — its location
 * comes from the token row). Keeping one definition is what guarantees the
 * phone can't slip through a payload the desktop would have rejected.
 *
 * `locationId` is deliberately absent here rather than optional: the phone
 * endpoint must never honour a caller-supplied location, and a field that
 * doesn't exist can't be forgotten in a `.omit()` somewhere.
 *
 * The length/amount caps are new relative to the original desktop-only
 * schema. They exist because the phone endpoint is authorized by a 12-hour,
 * reusable, LAN-visible token and nothing else, so unbounded strings would be
 * a way to fill the database for anyone who ever saw the QR code. The bounds
 * are far above any real dress name, size or price, so no legitimate desktop
 * entry is affected.
 */
const MAX_PRICE = 1_000_000

export const productCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).max(100),
  size: z.string().min(1).max(100),
  color: z.string().min(1).max(100),
  rentalPrice: z.number().nonnegative().max(MAX_PRICE),
  depositAmount: z.number().nonnegative().max(MAX_PRICE),
})
