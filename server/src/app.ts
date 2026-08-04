import express from 'express'
import cors from 'cors'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { RENEWED_TOKEN_HEADER } from './auth/authMiddleware.js'
import { authRouter } from './auth/authRoutes.js'
import { setupRouter } from './routes/setup.js'
import { clientsRouter } from './routes/clients.js'
import { productsRouter } from './routes/products.js'
import { productEventsRouter } from './routes/productEvents.js'
import { allocationsRouter } from './routes/allocations.js'
import { calendarRouter } from './routes/calendar.js'
import { contractsRouter } from './routes/contracts.js'
import { locationSettingsRouter } from './routes/locationSettings.js'
import { backupRouter } from './routes/backup.js'

export const app = express()
app.disable('x-powered-by')
// exposedHeaders is load-bearing, not cosmetic: the packaged Electron renderer
// loads over file:// and calls http://localhost:3000, so every API request is
// cross-origin. A response header that is not CORS-safelisted stays invisible
// to JS unless it is named here, and X-Renewed-Token is how sliding session
// renewal reaches the client (see auth/authMiddleware.ts).
app.use(cors({ exposedHeaders: [RENEWED_TOKEN_HEADER] }))

/**
 * One route carries images and needs a much higher body limit than every
 * other route's default 100 kB — but that route also sits behind
 * `requireAuth`. Parsing (and therefore buffering) a large body BEFORE
 * authentication would let an unauthenticated request force the server to
 * buffer and JSON-parse up to the raised limit on every attempt, a large
 * amplification over the default ceiling every other pre-auth path enforces.
 * So this route's own higher-limit parser is mounted directly on it in
 * routes/products.ts, AFTER `productsRouter.use(requireAuth)` — this
 * middleware only keeps the DEFAULT parser below from running (and 413-ing)
 * on that route ahead of time; it does no parsing of its own.
 */
const PHOTO_UPLOAD_PATH = /^\/api\/products\/[^/]+\/photos\/?$/
const defaultJson = express.json()
app.use((req, res, next) => {
  if (req.method === 'POST' && PHOTO_UPLOAD_PATH.test(req.path)) {
    return next()
  }
  return defaultJson(req, res, next)
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/setup', setupRouter)
app.use('/api/auth', authRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/products', productEventsRouter)
app.use('/api/products', productsRouter)
app.use('/api/allocations', allocationsRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/contracts', contractsRouter)
app.use('/api/settings', locationSettingsRouter)
app.use('/api/backup', backupRouter)

// Always add new routers ABOVE this comment and BELOW it stays last:

app.use(errorMiddleware)
