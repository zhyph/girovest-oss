import { EventEmitter } from 'events'
import type { ProductDTO } from '../services/productService.js'

export interface ProductPhotoEvent {
  productId: string
  locationId: string
  photos: string[]
}

// Emitted when a product is created from the phone's photo-intake page, so a
// desktop list that is only ever refetched on demand can gain the new row
// live. Deliberately a second event name on the same emitter rather than a
// variant of 'photo': the SSE route serializes 'photo' as an unnamed frame
// (EventSource.onmessage) and this one as a named frame, which keeps the
// existing photo wire format byte-identical for older packaged clients.
export interface ProductCreatedEvent {
  locationId: string
  product: ProductDTO
}

export const productPhotoEvents = new EventEmitter()
