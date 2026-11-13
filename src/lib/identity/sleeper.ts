import { fetchLeagueUsers } from '@/lib/sleeper'
import { containsCode, type IdentityProvider, type LookupResult } from './provider'

/**
 * Sleeper, proved by the team-name challenge. See src/lib/identity/provider.ts for why.
 *
 * The team name lives in `league/<id>/users[].metadata.team_name`, which is per user, so
 * on a co-managed roster each co-owner proves themselves with their own.
 */

type LeagueUser = Awaited<ReturnType<typeof fetchLeagueUsers>>[number]

/** Sleeper usernames are what people type; the API is case-insensitive about them. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '')
}

/** Pure: is `userId` in this league, and does their team name carry the code? */
export function leagueUserHasCode(users: LeagueUser[], userId: string, code: string): boolean {
  const u = users.find((x) => x.user_id === userId)
  return !!u && containsCode(u.metadata?.team_name, code)
}

async function fetchUser(username: string): Promise<{ user_id: string; display_name?: string; username?: string } | null> {
  const res = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sleeper returned ${res.status}`)
  // An unknown username is a 200 with a literal `null` body.
  return (await res.json()) as { user_id: string; display_name?: string; username?: string } | null
}

export const sleeperProvider: IdentityProvider = {
  id: 'sleeper',
  label: 'Sleeper',

  async lookupMember(raw: string, leagueId: string): Promise<LookupResult> {
    const username = normalizeUsername(raw)
    if (!/^[A-Za-z0-9_.-]{2,40}$/.test(username)) {
      return { ok: false, reason: 'That does not look like a Sleeper username.' }
    }
    let user
    let members
    try {
      ;[user, members] = await Promise.all([fetchUser(username), fetchLeagueUsers(leagueId)])
    } catch {
      return { ok: false, reason: 'Could not reach Sleeper. Try again in a minute.' }
    }
    if (!user?.user_id) return { ok: false, reason: `No Sleeper account called “${username}”.` }
    if (!members.some((m) => m.user_id === user.user_id)) {
      return { ok: false, reason: `${username} is not in this season’s league on Sleeper.` }
    }
    return { ok: true, user: { userId: user.user_id, username: user.display_name ?? user.username ?? username } }
  },

  async hasChallenge(userId: string, code: string, leagueId: string): Promise<boolean> {
    return leagueUserHasCode(await fetchLeagueUsers(leagueId), userId, code)
  },

  instructions(code: string): string {
    return `In the Sleeper app, open this league and edit YOUR team name (not the league name) so it includes ${code} anywhere. Save it, then come back here. You can change it back as soon as this is done.`
  },
}
