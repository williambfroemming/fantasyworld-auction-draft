/**
 * The PIN lockout policy, as words and numbers. The counting itself happens in one SQL
 * statement (src/server/pin-service.ts); this is only the policy and how it is phrased.
 *
 * Five wrong PINs lock the seat for fifteen minutes. The commissioner resetting a PIN
 * unlocks it at once. Deliberately blunt: this is light authentication for a ten-person
 * league, not a bank.
 *
 * ⚠️ A side effect worth knowing: anyone can lock anyone else's seat by getting a PIN
 * wrong five times. It costs the victim fifteen minutes, and it is the price of having
 * a lockout on a public sign-in screen at all.
 */
export const MAX_PIN_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

/** Whole minutes until `until`, never less than one (so it never says "0 minutes"). */
export function minutesUntil(until: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000))
}

export function lockedMessage(until: Date, now: Date = new Date()): string {
  const m = minutesUntil(until, now)
  return `Too many wrong PINs. Try again in ${m} ${m === 1 ? 'minute' : 'minutes'}, or ask the commissioner to reset it.`
}

/** What to say after a wrong PIN that did not lock the seat. */
export function wrongPinMessage(attemptsUsed: number): string {
  const left = Math.max(0, MAX_PIN_ATTEMPTS - attemptsUsed)
  return `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before this seat locks.`
}
