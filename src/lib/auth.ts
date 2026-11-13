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
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
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
// One-time PIN reset links
// ---------------------------------------------------------------------------

/** How long a reset link works for. Long enough to survive "I'll do it tonight". */
export const RESET_LINK_HOURS = 24

/**
 * The secret in a reset link: 32 random bytes, URL-safe. Unguessable, which is why
 * redeeming one needs no attempt counter the way a 4-digit PIN does.
 */
export function newResetToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * What is stored for a reset link. A plain SHA-256 is enough — the token is 256 bits of
 * randomness, not a human-chosen secret — and it means a copy of the database cannot be
 * used to take over a seat.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Shape check before touching the database: base64url of 32 bytes is 43 characters. */
export function isResetTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

// ---------------------------------------------------------------------------
// Signed, expiring payloads (the sign-up challenge)
// ---------------------------------------------------------------------------

/**
 * `base64url(json).hmac`. Signed, not encrypted: nothing in it is secret, it only has to
 * be unforgeable and expire. Used so the sign-up challenge needs no table row — one
 * person asking for a code can never overwrite another's.
 */
export function signPayload(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(`payload:${body}`, secret)}`
}

export function verifyPayload<T extends { exp: number }>(
  token: string,
  secret: string,
  now: number = Date.now(),
): T | null {
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const body = token.slice(0, idx)
  const a = Buffer.from(token.slice(idx + 1))
  const b = Buffer.from(hmac(`payload:${body}`, secret))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
    if (typeof parsed?.exp !== 'number' || parsed.exp <= now) return null
    return parsed
  } catch {
    return null
  }
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
  maxAge: 60 * 60 * 24 * 90, // the whole site sits behind this, so don't make people re-enter a PIN weekly
  secure: process.env.NODE_ENV === 'production',
} as const
