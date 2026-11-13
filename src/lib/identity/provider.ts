/**
 * How someone proves they are in this league, per fantasy platform.
 *
 * ## Why a challenge and not a login
 *
 * Sleeper has no OAuth and no "Sign in with Sleeper": its API is public and read-only,
 * so every member's username and user id is readable by anyone. A typed username is a
 * claim, never a proof. The proof Sleeper CAN give is something only the account holder
 * can change — their team name in this season's league. We hand out a short code, they
 * put it in their team name, and we read it back from the public league endpoint.
 *
 * Yahoo has real OAuth, so a Yahoo provider would prove membership with a login instead
 * of a challenge. ESPN has no public auth at all and would need a challenge of its own.
 * Both are new files implementing this interface; neither needs a schema change, because
 * `member_identities` and `join_requests` are keyed on (provider, external_user_id).
 *
 * ⚠️ Every method here makes an outbound call. They are reachable only from
 * `/api/onboard` — never from `/api/state`, the draft path, or anything that polls.
 */

export type ProviderId = 'sleeper'

export interface ExternalUser {
  /** The provider's immutable id. Display names change; this does not. */
  userId: string
  /** What the person calls themselves there, for the commissioner to recognise. */
  username: string
}

export type LookupResult =
  | { ok: true; user: ExternalUser }
  | { ok: false; reason: string }

export interface IdentityProvider {
  id: ProviderId
  label: string
  /** Find the account AND confirm it is a member of `leagueId`. */
  lookupMember(username: string, leagueId: string): Promise<LookupResult>
  /** Has this member put `code` where only they could have put it? */
  hasChallenge(userId: string, code: string, leagueId: string): Promise<boolean>
  /** One sentence telling a person where to put the code. */
  instructions(code: string): string
}

/**
 * The challenge code: `FW-` and four digits. Short enough to type into a team name on a
 * phone; it does not need to be unguessable, because knowing it is worthless without the
 * ability to edit that member's team name.
 */
export function newChallengeCode(rand: () => number = Math.random): string {
  return `FW-${String(Math.floor(rand() * 10_000)).padStart(4, '0')}`
}

/** Case- and space-insensitive "does this text carry the code". */
export function containsCode(text: string | null | undefined, code: string): boolean {
  if (!text) return false
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '')
  return norm(text).includes(norm(code))
}

/** How long a code stays valid. Long enough to find the setting in the Sleeper app. */
export const CHALLENGE_MINUTES = 20

/** The signed payload a challenge token carries. See `signPayload` in src/lib/auth.ts. */
export interface ChallengePayload {
  kind: 'join-challenge'
  provider: ProviderId
  userId: string
  username: string
  code: string
  exp: number
}
