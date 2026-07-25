import { Router } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { checkSseTicket } from '../services/sseTicketService.js'
import { productPhotoEvents, type ProductPhotoEvent } from '../events/productPhotoEvents.js'

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

  req.on('close', () => {
    productPhotoEvents.off('photo', listener)
  })
})
