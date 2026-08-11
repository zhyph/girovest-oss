import { randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword } from './passwords.js'

/**
 * "Esqueci minha senha" without email/SMS: this app is local-first (some
 * shops run with no shared internet at all -- see connectivityMode), so a
 * mailed reset link isn't always reachable. A recovery code generated once
 * at setup, which the owner is told to save/print, works fully offline and
 * needs nobody else involved -- the tradeoff explicitly asked for over a
 * support-mediated reset.
 */

// No 0/O/1/I/L: a code that has to be handwritten or read aloud over the
// phone must not depend on distinguishing a zero from a letter O. This is 31
// symbols (26 letters minus I/L/O, plus 8 digits minus 0/1) -- deliberately
// NOT assumed to evenly divide 256; see randomAlphabetChar's rejection
// sampling below, which is correct for any alphabet length.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const GROUP_LENGTH = 4
const GROUP_COUNT = 4

/**
 * One uniformly-random symbol. `byte % ALPHABET.length` alone is only
 * unbiased when ALPHABET.length evenly divides 256 (it doesn't here: 31
 * symbols, and 256 % 31 === 8, so a naive modulo would make the first 8
 * symbols ~3% likelier than the rest). Rejection sampling fixes that for any
 * alphabet length: bytes at or above the largest multiple of the alphabet
 * size that fits in a byte are discarded and redrawn, so the accepted range
 * divides evenly no matter what the length is.
 */
function randomAlphabetChar(): string {
  const limit = 256 - (256 % ALPHABET.length)
  for (;;) {
    const byte = randomBytes(1)[0] as number
    if (byte < limit) return ALPHABET[byte % ALPHABET.length] as string
  }
}

/** 16 chars from a 31-symbol alphabet: ~79 bits, grouped like a product key. */
export function generateRecoveryCode(): string {
  const groups: string[] = []
  for (let g = 0; g < GROUP_COUNT; g++) {
    let group = ''
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += randomAlphabetChar()
    }
    groups.push(group)
  }
  return groups.join('-')
}

// Case/whitespace/dash-insensitive: someone retyping a printed code, or
// reading it back over the phone, should not fail on formatting alone.
function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '')
}

// Same bcrypt work factor as a login password: a recovery code is at least
// as sensitive as one (it can mint a brand new password on its own).
export function hashRecoveryCode(code: string): Promise<string> {
  return hashPassword(normalizeRecoveryCode(code))
}

export function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  return verifyPassword(normalizeRecoveryCode(code), hash)
}
