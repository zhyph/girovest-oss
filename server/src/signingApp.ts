import express from 'express'
import { AppError } from './errors/AppError.js'
import { ErrorCodes } from './errors/errorCodes.js'
import { errorMiddleware } from './errors/errorMiddleware.js'
import { checkTokenValidity as checkSigningTokenValidity, submitSignature } from './services/signingService.js'
import {
  checkTokenValidity as checkPhotoTokenValidity,
  createProductFromPhotoToken,
  submitPhotos,
} from './services/productPhotoTokenService.js'
import { listProductsForLocation } from './services/productService.js'
import { productCreateSchema } from './lib/productValidation.js'
import { submitPhotosSchema, submitSignatureSchema } from './lib/signingValidation.js'
import { getSigningPageHtml } from './signingPage.js'
import { getProductPhotoPageHtml } from './productPhotoPage.js'
import { prisma } from './db/client.js'

export const signingApp = express()
signingApp.disable('x-powered-by')
signingApp.use(express.json({ limit: '5mb' }))

signingApp.get('/sign/:token', async (req, res) => {
  const status = await checkSigningTokenValidity(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(getSigningPageHtml(status))
})

signingApp.post('/sign/:token/submit', async (req, res) => {
  const parsed = submitSignatureSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid signature payload')
  }
  await submitSignature(req.params.token, parsed.data.signatureImage)
  res.json({ status: 'ok' })
})

signingApp.get('/product-photos/:token', async (req, res) => {
  const status = await checkPhotoTokenValidity(req.params.token)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(getProductPhotoPageHtml(status, req.params.token))
})

signingApp.get('/product-photos/:token/products', async (req, res) => {
  const photoToken = await prisma.productPhotoToken.findUnique({ where: { token: req.params.token } })
  if (!photoToken || photoToken.expiresAt.getTime() < Date.now()) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, 'Photo token not found or expired')
  }
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  res.json(await listProductsForLocation(photoToken.locationId, { search }))
})

// The schema has no `locationId` at all, and the service reads the location
// from the token row — a body that carries one is silently dropped by zod
// rather than trusted.
signingApp.post('/product-photos/:token/products', async (req, res) => {
  const parsed = productCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid product payload')
  }
  res.status(201).json(await createProductFromPhotoToken(req.params.token, parsed.data))
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
