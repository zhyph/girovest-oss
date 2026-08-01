export {}

declare global {
  namespace Express {
    interface Request {
      staff?: {
        staffId: string
        role: 'owner' | 'staff'
        locationId: string
      }
    }
  }
}
