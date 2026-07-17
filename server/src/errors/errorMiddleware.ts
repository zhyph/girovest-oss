import type { NextFunction, Request, Response } from 'express'
import { AppError } from './AppError.js'
import { ErrorCodes } from './errorCodes.js'

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ code: ErrorCodes.INTERNAL_ERROR, message: 'Internal server error' })
}
