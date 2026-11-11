import { draftersByPick, type StatsTrade } from '@/lib/stats'

/**
 * How the roster was built: for one season, where each manager's STARTED points came from.
 *
 * (docs/ANALYTICS_ROADMAP.md step 52)
 *
 * - `drafted`       the manager bought the player at that season's auction (and still has them)
 * - `tradedAtDraft` the player was bought by someone else and reached this manager in a trade
 * - `addedLater`    the player is on no auction pick of this manager's: waiver, free agency,
 *                   or a player nobody bought. Step 61 will split this into waiver and trade.
 * - `unknown`       the manager owns or bought an auction pick that has no `player_sleeper_id`,
 *                   and this started player matches no other pick, so he may be that player.
 *
 * ## Rules this file exists to keep
 *
 * **Match on Sleeper id, never on name.** `player_weeks.player_id` is a Sleeper id and so is
 * `picks.player_sleeper_id`. A pick without one cannot be matched, and the matcher refuses to
 * guess (AGENTS.md); a wrong match would credit one man's points to another's price.
 *
 * **Unmatched is not "added later".** If a manager has an unresolvable pick, an unmatched
 * starter of theirs is reported as `unknown`: calling him a waiver pickup would be a confident
 * wrong answer. Managers with no unresolvable pick get `addedLater` as normal.
 *
 * **The buyer comes from `draftersByPick`.** `picks.manager_id` is current ownership. A player
 * counts as `tradedAtDraft` only when a trade actually moved that pick to the manager holding
 * him, so someone who bought a player, dropped him, and watched a rival claim him is
 * `addedLater` for the rival, not "traded".
 *
 * Every started point lands in exactly one bucket, so the four parts always sum to the
 * manager's started total. The caller passes the week keys (`season:week`), so this cannot
 * disagree with the other columns about which weeks count.
 */

export interface OriginRow {
  season: number
  week: number
  managerId: number
  /** A Sleeper id. */
  playerId: string
  isStarter: boolean
  points: number
}

export interface OriginPick {
  id: number
  season: number
  /** CURRENT owner; the buyer is resolved through the trade log. */
  managerId: number
  sleeperId: string | null
}

export interface RosterOrigin {
  managerId: number
  drafted: number
  tradedAtDraft: number
  addedLater: number
  unknown: number
  /** All started points: the four parts added up. */
  total: number
}

export function rosterOrigin(
  rows: OriginRow[],
  picks: OriginPick[],
  trades: StatsTrade[],
  season: number,
  weekKeys: Set<string>,
): RosterOrigin[] {
  const seasonPicks = picks.filter((p) => p.season === season)
  const buyer = draftersByPick(seasonPicks, trades)

  // sleeper id -> pick. If two picks shared an id the second would silently win, so keep
  // the first and let it be; the importer never produces duplicates within a season.
  const bySleeper = new Map<string, OriginPick>()
  for (const p of seasonPicks)
    if (p.sleeperId && !bySleeper.has(p.sleeperId)) bySleeper.set(p.sleeperId, p)

  // pick id -> managers a trade moved it to.
  const movedTo = new Set<string>()
  for (const t of trades) for (const m of t.players) movedTo.add(`${m.pickId}:${m.toManagerId}`)

  // Managers who bought or hold a pick we cannot match.
  const hasUnresolved = new Set<number>()
  for (const p of seasonPicks) {
    if (p.sleeperId) continue
    hasUnresolved.add(p.managerId)
    const b = buyer.get(p.id)
    if (b !== undefined) hasUnresolved.add(b)
  }

  const out = new Map<number, RosterOrigin>()
  const get = (managerId: number) => {
    let r = out.get(managerId)
    if (!r) {
      r = { managerId, drafted: 0, tradedAtDraft: 0, addedLater: 0, unknown: 0, total: 0 }
      out.set(managerId, r)
    }
    return r
  }

  for (const row of rows) {
    if (row.season !== season || !row.isStarter) continue
    if (!weekKeys.has(`${row.season}:${row.week}`)) continue
    const r = get(row.managerId)
    const pick = bySleeper.get(row.playerId)
    let part: 'drafted' | 'tradedAtDraft' | 'addedLater' | 'unknown'
    if (pick && buyer.get(pick.id) === row.managerId) part = 'drafted'
    else if (pick && movedTo.has(`${pick.id}:${row.managerId}`)) part = 'tradedAtDraft'
    else if (!pick && hasUnresolved.has(row.managerId)) part = 'unknown'
    else part = 'addedLater'
    r[part] += row.points
    r.total += row.points
  }
  return [...out.values()].sort((a, b) => a.managerId - b.managerId)
}
