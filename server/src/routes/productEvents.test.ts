import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app.js'
import { prisma } from '../db/client.js'
import { mintSseTicket } from '../services/sseTicketService.js'
import { productPhotoEvents } from '../events/productPhotoEvents.js'

let locationId: string
let otherLocationId: string

beforeEach(async () => {
  const location = await prisma.location.create({ data: { name: 'L', address: 'A' } })
  locationId = location.id
  const otherLocation = await prisma.location.create({ data: { name: 'L2', address: 'A2' } })
  otherLocationId = otherLocation.id
})

afterEach(async () => {
  await prisma.location.deleteMany()
})

function waitForData(req: request.Test): Promise<string> {
  return new Promise((resolve, reject) => {
    req.on('response', (res) => {
      res.on('data', (chunk: Buffer) => resolve(chunk.toString('utf8')))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(() => {
      // supertest requires .end() to actually send the request; the real
      // assertions happen via the 'response'/'data' listeners above, not
      // this callback.
    })
  })
}

describe('GET /api/products/events', () => {
  it('streams a photo event for a matching location and not for a different one', async () => {
    const { ticket } = mintSseTicket('staff-1', locationId)
    // supertest's Test constructor unconditionally calls `.buffer()` (true),
    // which makes superagent withhold the 'response' event until the
    // response stream ends. An SSE stream never ends, so without this
    // override the test would hang until Vitest's test timeout. Passing
    // `false` restores superagent's normal unbuffered mode, where 'response'
    // fires as soon as headers arrive and 'data' events are re-emitted live.
    const req = request(app).get('/api/products/events').query({ ticket }).buffer(false)
    const dataPromise = waitForData(req)

    // Give the SSE connection a moment to establish before emitting.
    await new Promise((r) => setTimeout(r, 50))
    productPhotoEvents.emit('photo', { productId: 'other-location-product', locationId: otherLocationId, photos: [] })
    productPhotoEvents.emit('photo', { productId: 'p1', locationId, photos: ['/api/products/p1/photos/a.jpg'] })

    const chunk = await dataPromise
    expect(chunk).toContain('"productId":"p1"')
    expect(chunk).not.toContain('other-location-product')
    req.abort()
  })

  it('rejects a missing or invalid ticket with 401 and does not hang the connection open', async () => {
    const res = await request(app).get('/api/products/events').query({ ticket: 'not-a-real-ticket' })
    expect(res.status).toBe(401)
  })

  it('rejects a request with no ticket at all', async () => {
    const res = await request(app).get('/api/products/events')
    expect(res.status).toBe(401)
  })
})
