/**
 * PIN hashing and signed session cookies.
 *
 * This is a friendly 10-person league, not a bank. The threat model is a shared
 * laptop and a misclick, not an attacker: the PIN exists so that nobody bids
 * $200 as someone else by sitting down at the wrong seat. It is still stored
 * hashed and salted rather than in plaintext, because there is no reason not to.
 *
 * Uses node:crypto scrypt — no native dependency to fail an engines check, which
 * matters on this project (see PROGRESS_LOG.md, steps 3-4).
 */
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const KEYLEN = 32

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await scryptAsync(pin, salt, KEYLEN)
  return `${salt}:${key.toString('hex')}`
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const [salt, keyHex] = stored.split(':')
  if (!salt || !keyHex) return false
  const key = await scryptAsync(pin, salt, KEYLEN)
  const expected = Buffer.from(keyHex, 'hex')
  // Lengths must match before timingSafeEqual, which throws on mismatch.
  if (expected.length !== key.length) return false
  return timingSafeEqual(expected, key)
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'fw_draft_session'

/**
 * A session is just `managerId.signature`. Signed rather than encrypted — the
 * manager id isn't a secret, we only need it to be unforgeable so nobody can
 * hand-edit a cookie and start bidding as another manager.
 */
export function signSession(managerId: number, secret: string): string {
  const payload = String(managerId)
  return `${payload}.${hmac(payload, secret)}`
}

export function verifySession(token: string | undefined, secret: string): number | null {
  if (!token) return null
  const idx = token.lastIndexOf('.')
  if (idx === -1) return null
  const payload = token.slice(0, idx)
  const sig = token.slice(idx + 1)

  const expected = hmac(payload, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const id = Number(payload)
  return Number.isInteger(id) && id > 0 ? id : null
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * The signing secret. Falls back to a fixed dev value so local work doesn't
 * need env setup, but refuses to do that in production — an unset secret in
 * prod would make every session forgeable.
 */
export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production')
  }
  return 'dev-only-insecure-secret'
}

/** Cookie options: the draft runs for hours, so this outlives a dead phone battery. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // a week, so the rehearsal and the real draft both fit
  secure: process.env.NODE_ENV === 'production',
} as const
