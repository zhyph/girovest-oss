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
 * One endpoint carries images; every other one carries a form's worth of
 * text, and the default 100 kB limit is the right ceiling for those.
 *
 * Scoped by an explicit path test rather than by mounting a wider parser on
 * `/api/products`, so raising the ceiling for photo upload cannot also raise
 * it for product create/update. body-parser marks the request as parsed, so
 * the general parser below simply skips a body this one already read.
 */
const PHOTO_UPLOAD_PATH = /^\/api\/products\/[^/]+\/photos\/?$/
const photoUploadJson = express.json({ limit: '12mb' })
app.use((req, res, next) => {
  if (req.method === 'POST' && PHOTO_UPLOAD_PATH.test(req.path)) {
    return photoUploadJson(req, res, next)
  }
  next()
})
app.use(express.json())

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
