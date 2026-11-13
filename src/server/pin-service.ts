import { hashPin, hashResetToken, isResetTokenFormat, isValidPinFormat, verifyPin } from '@/lib/auth'
import { LOCKOUT_MINUTES, MAX_PIN_ATTEMPTS, lockedMessage, wrongPinMessage } from '@/lib/pin-lockout'
import { getSql } from './sql'

export type SignInResult =
  | { ok: true; managerId: number; displayName: string }
  | { ok: false; reason: string; status: 400 | 401 | 403 | 404 | 409 | 410 | 429 }

/** A seat with no PIN. Not claimable from the sign-in screen any more — see `signIn`. */
export const NO_PIN_MESSAGE =
  'This seat has no PIN yet. Ask the commissioner for a link to set one.'

/**
 * Sign in to a seat, with a lockout on wrong guesses.
 *
 * ## A seat with no PIN cannot be claimed here
 *
 * It used to be: the first person to type four digits at an empty seat owned it. The
 * sign-in screen is public, so that was a race anyone on the internet could win. An
 * empty seat now gets a PIN only from a commissioner's one-time link
 * (`redeemPinReset`) or from an approved sign-up (src/server/onboarding-service.ts),
 * both of which prove who is on the other end.
 *
 * ## Why the attempt is counted BEFORE the PIN is checked
 *
 * See `checkPin`.
 */
export async function signIn(managerId: number, pin: string): Promise<SignInResult> {
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'PIN must be 4 digits', status: 400 }

  const sql = getSql()
  const [manager] = await sql`SELECT id, display_name, pin_hash FROM managers WHERE id = ${managerId}`
  if (!manager) return { ok: false, reason: 'Unknown manager', status: 404 }
  if (manager.pin_hash === null) return { ok: false, reason: NO_PIN_MESSAGE, status: 403 }

  const checked = await checkPin(managerId, pin)
  if (!checked.ok) return checked
  return { ok: true, managerId, displayName: manager.display_name as string }
}

/**
 * Is `pin` this seat's PIN? Counted against the lockout either way.
 *
 * Shared by sign-in and by "change my PIN" on /account, so the account page cannot be
 * used to guess a PIN without the same five-strikes limit.
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
 */
export async function checkPin(
  managerId: number,
  pin: string,
): Promise<{ ok: true } | { ok: false; reason: string; status: 401 | 429 }> {
  const sql = getSql()
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
    return { ok: true }
  }

  if (pin_locked_until) {
    return { ok: false, reason: lockedMessage(new Date(pin_locked_until as string)), status: 429 }
  }
  return { ok: false, reason: wrongPinMessage(pin_attempts as number), status: 401 }
}

/**
 * Use a commissioner's one-time link to choose a new PIN — and sign in.
 *
 * ONE statement: the WHERE matches only an unexpired link, and the SET clears it, so
 * two people opening the same link at once cannot both succeed (the second finds no
 * row). It also lifts any lockout, which is usually why the link was asked for.
 *
 * No attempt counter: the token is 256 random bits, so there is nothing to guess.
 */
export async function redeemPinReset(token: string, pin: string): Promise<SignInResult> {
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'PIN must be 4 digits', status: 400 }
  const expired = { ok: false as const, reason: 'This link has expired or was already used. Ask the commissioner for a new one.', status: 410 as const }
  if (!isResetTokenFormat(token)) return expired

  const rows = await getSql()`
    UPDATE managers SET
      pin_hash = ${await hashPin(pin)},
      pin_reset_hash = NULL, pin_reset_expires = NULL,
      pin_attempts = 0, pin_locked_until = NULL
    WHERE pin_reset_hash = ${hashResetToken(token)} AND pin_reset_expires > now()
    RETURNING id, display_name`
  if (rows.length === 0) return expired
  return { ok: true, managerId: Number(rows[0].id), displayName: rows[0].display_name as string }
}

/**
 * Change your own PIN from /account. The current PIN is checked through `checkPin`, so a
 * wrong one counts toward the same lockout as the sign-in screen.
 */
export async function changePin(
  managerId: number,
  currentPin: string,
  newPin: string,
): Promise<{ ok: true } | { ok: false; reason: string; status: 400 | 401 | 403 | 429 }> {
  if (!isValidPinFormat(currentPin) || !isValidPinFormat(newPin)) {
    return { ok: false, reason: 'PIN must be 4 digits', status: 400 }
  }
  const checked = await checkPin(managerId, currentPin)
  if (!checked.ok) {
    return checked.status === 401 ? { ...checked, reason: checked.reason.replace(/^Wrong PIN\./, 'Current PIN is wrong.') } : checked
  }
  // A pending reset link is moot once they have chosen a PIN themselves.
  await getSql()`
    UPDATE managers SET pin_hash = ${await hashPin(newPin)}, pin_reset_hash = NULL, pin_reset_expires = NULL
    WHERE id = ${managerId}`
  return { ok: true }
}
