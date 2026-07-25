import express from 'express'
import { z } from 'zod'
import { AppError } from './errors/AppError.js'
import { ErrorCodes } from './errors/errorCodes.js'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { checkTokenValidity as checkSigningTokenValidity, submitSignature } from './services/signingService.js'
import {
  checkTokenValidity as checkPhotoTokenValidity,
  submitPhotos,
} from './services/productPhotoTokenService.js'
import { getSigningPageHtml } from './signingPage.js'
import { getProductPhotoPageHtml } from './productPhotoPage.js'

export const signingApp = express()
signingApp.disable('x-powered-by')
signingApp.use(express.json({ limit: '5mb' }))

signingApp.get('/sign/:token', async (req, res) => {
  const status = await checkSigningTokenValidity(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(getSigningPageHtml(status))
})

// Constrained to exactly what canvas.toDataURL('image/png') produces in
// signingPage.ts's own script — this is an unauthenticated endpoint (the
// token is the only access control), so the payload shape can't be trusted
// beyond "some string": a well-formed PNG data URL rules out other MIME
// types (e.g. an SVG data URL, which can carry a <script>) ending up stored
// and later rendered via <img src=...> in the print view. The length cap is
// generous relative to the fixed 600x200 canvas's expected output (a few
// tens of KB) while still bounding worst-case storage.
const SIGNATURE_IMAGE_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/
const submitSchema = z.object({
  signatureImage: z.string().min(1).max(500_000).regex(SIGNATURE_IMAGE_PATTERN),
})

signingApp.post('/sign/:token/submit', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid signature payload')
  }
  await submitSignature(req.params.token, parsed.data.signatureImage)
  res.json({ status: 'ok' })
})

signingApp.get('/product-photos/:token', async (req, res) => {
  const status = await checkPhotoTokenValidity(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(getProductPhotoPageHtml(status))
})

const submitPhotosSchema = z.object({
  productId: z.string().min(1),
  photos: z.array(z.string().min(1)).min(1).max(10),
})

signingApp.post('/product-photos/:token/submit', async (req, res) => {
  const parsed = submitPhotosSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid photo payload')
  }
  await submitPhotos(req.params.token, parsed.data.productId, parsed.data.photos)
  res.json({ status: 'ok' })
})

signingApp.use(errorMiddleware)
