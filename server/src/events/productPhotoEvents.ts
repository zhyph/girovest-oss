import { EventEmitter } from 'events'

export interface ProductPhotoEvent {
  productId: string
  locationId: string
  photos: string[]
}

export const productPhotoEvents = new EventEmitter()
