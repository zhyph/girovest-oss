import type { ErrorCode } from './errorCodes.js'

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly status: number

  constructor(code: ErrorCode, status: number, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
  }
}
