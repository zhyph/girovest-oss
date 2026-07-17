import jwt from 'jsonwebtoken'

export interface StaffTokenPayload {
  staffId: string
  role: 'owner' | 'staff'
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not set')
  }
  return secret
}

export function signStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '12h' })
}

export function verifyStaffToken(token: string): StaffTokenPayload {
  return jwt.verify(token, getSecret()) as StaffTokenPayload
}
