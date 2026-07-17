import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { verifyPassword } from './passwords.js'
import { signStaffToken } from './jwt.js'

export const authRouter = Router()

const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'login and password are required')
  }

  const staff = await prisma.staff.findUnique({ where: { login: parsed.data.login } })
  if (!staff) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid login or password')
  }

  const passwordMatches = await verifyPassword(parsed.data.password, staff.passwordHash)
  if (!passwordMatches) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 401, 'Invalid login or password')
  }

  const token = signStaffToken({ staffId: staff.id, role: staff.role as 'owner' | 'staff' })
  res.json({ token })
})
