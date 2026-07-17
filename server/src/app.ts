import express from 'express'
import { errorMiddleware } from './errors/errorMiddleware.js'

export const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Later tasks mount routers here, e.g.:
//   app.use('/api/auth', authRouter)
//   app.use('/api/clients', clientsRouter)
// Always add new routers ABOVE this comment and BELOW it stays last:

app.use(errorMiddleware)
