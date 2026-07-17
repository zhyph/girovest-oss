import express from 'express'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { authRouter } from './auth/authRoutes.js'
import { clientsRouter } from './routes/clients.js'

export const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRouter)
app.use('/api/clients', clientsRouter)

// Later tasks mount routers here.
// Always add new routers ABOVE this comment and BELOW it stays last:

app.use(errorMiddleware)
