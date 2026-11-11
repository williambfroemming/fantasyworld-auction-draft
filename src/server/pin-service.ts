import { hashPin, isValidPinFormat, verifyPin } from '@/lib/auth'
import { LOCKOUT_MINUTES, MAX_PIN_ATTEMPTS, lockedMessage, wrongPinMessage } from '@/lib/pin-lockout'
import { getSql } from './sql'

export type SignInResult =
  | { ok: true; managerId: number; displayName: string }
  | { ok: false; reason: string; status: 400 | 401 | 404 | 409 | 429 }

/**
 * Claim a seat (first PIN) or sign in to one, with a lockout on wrong guesses.
 *
 * ## Why the attempt is counted BEFORE the PIN is checked
 *
 * The sign-in screen is public, so guessing has to be capped. If we checked first and
 * counted after, ten parallel requests would each see "0 attempts so far", each verify,
 * and each fail — the cap would hold only against a patient attacker. Instead one UPDATE
 * both reserves an attempt and refuses outright if the seat is locked, so concurrent
 * guesses each take their own number and the sixth onwards never reach `verifyPin`.
 *
 * A correct PIN then zeroes the counter. The fifth attempt is therefore still allowed
 * to succeed; only a wrong fifth locks the seat.
 *
 * An unclaimed seat (no PIN yet) is not counted: there is nothing to guess.
 */
export async function signIn(managerId: number, pin: string): Promise<SignInResult> {
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'PIN must be 4 digits', status: 400 }

  const sql = getSql()
  const [manager] = await sql`SELECT id, display_name, pin_hash FROM managers WHERE id = ${managerId}`
  if (!manager) return { ok: false, reason: 'Unknown manager', status: 404 }
  const displayName = manager.display_name as string

  if (manager.pin_hash === null) {
    // Unclaimed seat: set the PIN, but only if it is still unclaimed at write time, so
    // two people claiming the same seat at the same moment cannot both succeed.
    const claimed = await sql`
      UPDATE managers SET pin_hash = ${await hashPin(pin)}, pin_attempts = 0, pin_locked_until = NULL
      WHERE id = ${managerId} AND pin_hash IS NULL
      RETURNING id`
    if (claimed.length === 0) {
      return { ok: false, reason: 'That seat was just claimed by someone else', status: 409 }
    }
    return { ok: true, managerId, displayName }
  }

  // Reserve an attempt, or find out the seat is locked. An expired lock starts a fresh
  // count at 1. The UPDATE's right-hand sides all see the OLD row.
  const reserved = await sql`
    UPDATE managers SET
      pin_attempts = CASE WHEN pin_locked_until IS NOT NULL AND pin_locked_until <= now()
                          THEN 1 ELSE pin_attempts + 1 END,
      pin_locked_until = CASE
        WHEN (CASE WHEN pin_locked_until IS NOT NULL AND pin_locked_until <= now()
                   THEN 1 ELSE pin_attempts + 1 END) >= ${MAX_PIN_ATTEMPTS}
        THEN now() + make_interval(mins => ${LOCKOUT_MINUTES})
        ELSE NULL END
    WHERE id = ${managerId} AND (pin_locked_until IS NULL OR pin_locked_until <= now())
    RETURNING pin_hash, pin_attempts, pin_locked_until`
  if (reserved.length === 0) {
    const [row] = await sql`SELECT pin_locked_until FROM managers WHERE id = ${managerId}`
    return { ok: false, reason: lockedMessage(new Date(row.pin_locked_until as string)), status: 429 }
  }

  const { pin_hash, pin_attempts, pin_locked_until } = reserved[0]
  if (await verifyPin(pin, pin_hash as string)) {
    await sql`UPDATE managers SET pin_attempts = 0, pin_locked_until = NULL WHERE id = ${managerId}`
    return { ok: true, managerId, displayName }
  }

  if (pin_locked_until) {
    return { ok: false, reason: lockedMessage(new Date(pin_locked_until as string)), status: 429 }
  }
  return { ok: false, reason: wrongPinMessage(pin_attempts as number), status: 401 }
}
