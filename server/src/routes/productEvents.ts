import { Router } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { checkSseTicket } from '../services/sseTicketService.js'
import {
  productPhotoEvents,
  type ProductCreatedEvent,
  type ProductPhotoEvent,
} from '../events/productPhotoEvents.js'

export const productEventsRouter = Router()

productEventsRouter.get('/events', (req, res) => {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : undefined
  const claim = ticket ? checkSseTicket(ticket) : null
  if (!claim) {
    throw new AppError(ErrorCodes.SSE_TICKET_INVALID, 401, 'Invalid or expired SSE ticket')
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()

  const listener = (event: ProductPhotoEvent) => {
    if (event.locationId !== claim.locationId) return
    res.write(`data: ${JSON.stringify({ productId: event.productId, photos: event.photos })}\n\n`)
  }
  productPhotoEvents.on('photo', listener)

  // Deliberately a NAMED frame while the photo frame above stays unnamed:
  // EventSource delivers named frames only to addEventListener('product-created'),
  // so an older packaged client that knows nothing about this event keeps
  // receiving exactly the same photo stream it always did.
  const createdListener = (event: ProductCreatedEvent) => {
    if (event.locationId !== claim.locationId) return
    res.write(`event: product-created\ndata: ${JSON.stringify(event.product)}\n\n`)
  }
  productPhotoEvents.on('product-created', createdListener)

  req.on('close', () => {
    productPhotoEvents.off('photo', listener)
    productPhotoEvents.off('product-created', createdListener)
  })
})
