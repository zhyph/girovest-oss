import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { verifyStaffToken } from './jwt.js'

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Missing or malformed Authorization header')
  }

  const token = header.slice('Bearer '.length)
  try {
    req.staff = verifyStaffToken(token)
  } catch {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 401, 'Invalid or expired token')
  }
  next()
}
