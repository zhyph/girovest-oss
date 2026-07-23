import express from 'express'
import cors from 'cors'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { authRouter } from './auth/authRoutes.js'
import { setupRouter } from './routes/setup.js'
import { clientsRouter } from './routes/clients.js'
import { productsRouter } from './routes/products.js'
import { allocationsRouter } from './routes/allocations.js'
import { calendarRouter } from './routes/calendar.js'
import { contractsRouter } from './routes/contracts.js'

export const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/setup', setupRouter)
app.use('/api/auth', authRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/products', productsRouter)
app.use('/api/allocations', allocationsRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/contracts', contractsRouter)

// Always add new routers ABOVE this comment and BELOW it stays last:

app.use(errorMiddleware)
