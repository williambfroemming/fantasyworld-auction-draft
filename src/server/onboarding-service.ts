/**
 * Sign-up for someone NEW to the league: prove you are in it, choose a name and a PIN,
 * and wait for the commissioner to give you a seat.
 *
 * The ten existing seats never come through here — they were linked to their Sleeper
 * accounts by scripts/migrate-accounts.ts and sign in exactly as before.
 *
 * ## The proof
 *
 * A typed username proves nothing (src/lib/identity/provider.ts). So:
 *
 *   1. `startChallenge` — look the account up, confirm it is in THIS season's league and
 *      not already linked to a seat, and hand back a code plus a signed token that binds
 *      the code to that account for twenty minutes.
 *   2. The person puts the code in their team name on Sleeper.
 *   3. `submitJoinRequest` — check the token, read the league again, and only if the code
 *      is in that account's team name, store the request.
 *
 * The token is signed, not stored: two people asking for a code at once each get their
 * own, and neither can overwrite the other's. Knowing someone else's code is worthless,
 * because it only passes when it appears in THAT account's team name.
 *
 * Approval and decline are commissioner actions and live in commish-service.ts.
 *
 * ⚠️ Every function here that takes a provider makes an outbound call. This service is
 * reachable only from `/api/onboard`, which nothing polls.
 */
import { hashPin, isValidPinFormat, sessionSecret, signPayload, verifyPayload } from '@/lib/auth'
import { SLEEPER_LEAGUE_IDS } from '@/lib/history-identity'
import {
  CHALLENGE_MINUTES,
  newChallengeCode,
  type ChallengePayload,
  type IdentityProvider,
  type ProviderId,
} from '@/lib/identity/provider'
import { sleeperProvider } from '@/lib/identity/sleeper'
import { getSql } from './sql'

export const PROVIDERS: Record<ProviderId, IdentityProvider> = { sleeper: sleeperProvider }

export type OnboardResult<T> = { ok: true; data: T } | { ok: false; reason: string }

export const MAX_DISPLAY_NAME = 24

/** This season's Sleeper league: the stored id, or the pinned constant. Never by name. */
export async function currentLeagueId(provider: ProviderId): Promise<string | null> {
  if (provider !== 'sleeper') return null
  const [row] = await getSql()`
    SELECT d.season, s.sleeper_league_id
    FROM draft d LEFT JOIN seasons s ON s.season = d.season
    WHERE d.id = 1`
  if (!row) return null
  return (row.sleeper_league_id as string | null) ?? SLEEPER_LEAGUE_IDS[Number(row.season)] ?? null
}

async function linkedSeat(provider: ProviderId, userId: string): Promise<number | null> {
  const [row] = await getSql()`
    SELECT manager_id FROM member_identities WHERE provider = ${provider} AND external_user_id = ${userId}`
  return row ? Number(row.manager_id) : null
}

const ALREADY_LINKED =
  'That account already has a seat here. Sign in with your PIN, or ask the commissioner for a reset link.'

export interface Challenge {
  token: string
  code: string
  username: string
  instructions: string
  expiresAt: string
}

export async function startChallenge(
  providerId: ProviderId,
  username: string,
  provider: IdentityProvider = PROVIDERS[providerId],
  now: number = Date.now(),
): Promise<OnboardResult<Challenge>> {
  const leagueId = await currentLeagueId(providerId)
  if (!leagueId) return { ok: false, reason: 'This season has no league on record for that platform yet.' }

  const found = await provider.lookupMember(username, leagueId)
  if (!found.ok) return found
  if ((await linkedSeat(providerId, found.user.userId)) !== null) return { ok: false, reason: ALREADY_LINKED }

  const code = newChallengeCode()
  const exp = now + CHALLENGE_MINUTES * 60_000
  const payload: ChallengePayload = {
    kind: 'join-challenge',
    provider: providerId,
    userId: found.user.userId,
    username: found.user.username,
    code,
    exp,
  }
  return {
    ok: true,
    data: {
      token: signPayload(payload, sessionSecret()),
      code,
      username: found.user.username,
      instructions: provider.instructions(code),
      expiresAt: new Date(exp).toISOString(),
    },
  }
}

export async function submitJoinRequest(
  input: { token: string; displayName: string; pin: string },
  provider?: IdentityProvider,
): Promise<OnboardResult<{ displayName: string }>> {
  const c = verifyPayload<ChallengePayload>(input.token, sessionSecret())
  if (!c || c.kind !== 'join-challenge' || !(c.provider in PROVIDERS)) {
    return { ok: false, reason: 'That code has expired. Start again for a new one.' }
  }
  const p = provider ?? PROVIDERS[c.provider]

  const displayName = input.displayName.trim().replace(/\s+/g, ' ')
  if (!displayName) return { ok: false, reason: 'Choose a name for the board.' }
  if (displayName.length > MAX_DISPLAY_NAME) {
    return { ok: false, reason: `Keep the name to ${MAX_DISPLAY_NAME} characters or fewer.` }
  }
  if (!isValidPinFormat(input.pin)) return { ok: false, reason: 'PIN must be 4 digits.' }

  const sql = getSql()
  const [taken] = await sql`
    SELECT 1 FROM managers WHERE lower(display_name) = lower(${displayName}) OR lower(name) = lower(${displayName})`
  if (taken) return { ok: false, reason: 'Someone in the league already goes by that name. Pick another.' }
  if ((await linkedSeat(c.provider, c.userId)) !== null) return { ok: false, reason: ALREADY_LINKED }

  const leagueId = await currentLeagueId(c.provider)
  if (!leagueId) return { ok: false, reason: 'This season has no league on record for that platform yet.' }
  let proved: boolean
  try {
    proved = await p.hasChallenge(c.userId, c.code, leagueId)
  } catch {
    return { ok: false, reason: `Could not reach ${p.label}. Try again in a minute.` }
  }
  if (!proved) {
    return {
      ok: false,
      reason: `${c.code} is not in ${c.username}’s team name yet. Save it in ${p.label}, wait a few seconds, and try again.`,
    }
  }

  // One pending request per account: asking again (a new name, a new PIN) replaces it.
  await sql`
    INSERT INTO join_requests (provider, external_user_id, external_username, display_name, pin_hash, verified_at)
    VALUES (${c.provider}, ${c.userId}, ${c.username}, ${displayName}, ${await hashPin(input.pin)}, now())
    ON CONFLICT (provider, external_user_id) DO UPDATE SET
      external_username = EXCLUDED.external_username,
      display_name = EXCLUDED.display_name,
      pin_hash = EXCLUDED.pin_hash,
      verified_at = EXCLUDED.verified_at,
      created_at = now()`
  return { ok: true, data: { displayName } }
}

export interface JoinRequest {
  id: number
  provider: string
  externalUsername: string | null
  displayName: string
  createdAt: string
}

/** For the admin panel. Never selects `pin_hash`. */
export async function listJoinRequests(): Promise<JoinRequest[]> {
  const rows = await getSql()`
    SELECT id, provider, external_username, display_name, created_at
    FROM join_requests ORDER BY created_at`
  return rows.map((r) => ({
    id: Number(r.id),
    provider: r.provider as string,
    externalUsername: (r.external_username as string | null) ?? null,
    displayName: r.display_name as string,
    createdAt: new Date(r.created_at as string).toISOString(),
  }))
}

export interface LinkedAccount {
  provider: string
  externalUsername: string | null
  verified: boolean
}

/** The caller's own linked accounts, for /account. */
export async function listLinkedAccounts(managerId: number): Promise<LinkedAccount[]> {
  const rows = await getSql()`
    SELECT provider, external_username, verified_at FROM member_identities
    WHERE manager_id = ${managerId} ORDER BY provider, id`
  return rows.map((r) => ({
    provider: r.provider as string,
    externalUsername: (r.external_username as string | null) ?? null,
    verified: r.verified_at !== null,
  }))
}
