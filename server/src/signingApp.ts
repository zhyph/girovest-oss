import express from 'express'
import { z } from 'zod'
import { AppError } from './errors/AppError.js'
import { ErrorCodes } from './errors/errorCodes.js'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { checkTokenValidity, submitSignature } from './services/signingService.js'
import { getSigningPageHtml } from './signingPage.js'

export const signingApp = express()
signingApp.disable('x-powered-by')
signingApp.use(express.json({ limit: '1mb' }))

signingApp.get('/sign/:token', async (req, res) => {
  const status = await checkTokenValidity(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(getSigningPageHtml(status))
})

const submitSchema = z.object({ signatureImage: z.string().min(1) })

signingApp.post('/sign/:token/submit', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid signature payload')
  }
  await submitSignature(req.params.token, parsed.data.signatureImage)
  res.json({ status: 'ok' })
})

signingApp.use(errorMiddleware)
