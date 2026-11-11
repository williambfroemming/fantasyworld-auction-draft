import { draftersByPick, type StatsTrade } from '@/lib/stats'

/**
 * How the roster was built: for one season, where each manager's STARTED points came from.
 *
 * (docs/ANALYTICS_ROADMAP.md step 52)
 *
 * - `drafted`       the manager bought the player at that season's auction (and still has them)
 * - `tradedAtDraft` the player was bought by someone else and reached this manager in a trade
 * - `addedLater`    the player is on no auction pick of this manager's: waiver, free agency,
 *                   or a player nobody bought. When the season's transactions are supplied
 *                   it is split, and the parts always add up to it, into `waiver`,
 *                   `freeAgent`, `tradedLater` (traded for after the draft) and `otherAdded`
 *                   (a commissioner move, or no add on record).
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

/** A completed add, from `season_transactions`: how a manager came to hold a player. */
export interface OriginAcquisition {
  season: number
  /** Sleeper's filing week. The player's first game for the manager is the NEXT week. */
  week: number
  managerId: number
  playerId: string
  kind: 'waiver' | 'free_agent' | 'trade' | 'commissioner'
}

export interface RosterOrigin {
  managerId: number
  drafted: number
  tradedAtDraft: number
  addedLater: number
  /** The four below add up to `addedLater`. All zero when no transactions were supplied. */
  waiver: number
  freeAgent: number
  tradedLater: number
  otherAdded: number
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
  /** Completed adds for the season. Omit to leave `addedLater` unsplit. */
  acquisitions?: OriginAcquisition[],
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

  // (manager, player) -> adds, oldest first, so the row's own acquisition is the latest one
  // before it.
  const adds = new Map<string, OriginAcquisition[]>()
  for (const a of acquisitions ?? []) {
    if (a.season !== season) continue
    const key = `${a.managerId}:${a.playerId}`
    const list = adds.get(key) ?? []
    list.push(a)
    adds.set(key, list)
  }
  const KIND = { waiver: 'waiver', free_agent: 'freeAgent', trade: 'tradedLater', commissioner: 'otherAdded' } as const
  /** How he got there: the latest add before this week (week 1 also takes a week-1 add, which is pre-kickoff). */
  const howAdded = (row: OriginRow): 'waiver' | 'freeAgent' | 'tradedLater' | 'otherAdded' => {
    let found: OriginAcquisition | null = null
    for (const a of adds.get(`${row.managerId}:${row.playerId}`) ?? []) {
      if ((a.week < row.week || (a.week === 1 && row.week === 1)) && (!found || a.week >= found.week)) found = a
    }
    return found ? KIND[found.kind] : 'otherAdded'
  }

  const out = new Map<number, RosterOrigin>()
  const get = (managerId: number) => {
    let r = out.get(managerId)
    if (!r) {
      r = {
        managerId,
        drafted: 0,
        tradedAtDraft: 0,
        addedLater: 0,
        waiver: 0,
        freeAgent: 0,
        tradedLater: 0,
        otherAdded: 0,
        unknown: 0,
        total: 0,
      }
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
    if (part === 'addedLater' && acquisitions) r[howAdded(row)] += row.points
    r.total += row.points
  }
  return [...out.values()].sort((a, b) => a.managerId - b.managerId)
}

export const ORIGIN_PARTS = [
  'drafted',
  'tradedAtDraft',
  'waiver',
  'freeAgent',
  'tradedLater',
  'addedLater',
  'otherAdded',
  'unknown',
] as const
export type OriginPart = (typeof ORIGIN_PARTS)[number]

export const ORIGIN_LABELS: Record<OriginPart, string> = {
  drafted: 'Drafted',
  tradedAtDraft: 'Traded at the draft',
  waiver: 'Waiver claim',
  freeAgent: 'Free agent',
  tradedLater: 'Traded for in season',
  addedLater: 'Added later',
  otherAdded: 'Other or unrecorded',
  unknown: 'Unknown',
}

const SPLIT = ['waiver', 'freeAgent', 'tradedLater', 'otherAdded'] as const

/**
 * The parts worth drawing for a season. A part that is zero for EVERY manager is dropped, so
 * a chart never carries a legend entry that is always empty: imported seasons have no recorded
 * draft-night trades, and `unknown` is zero unless a pick could not be matched. `drafted` is
 * always kept, because it is the question the chart asks.
 *
 * The added-later share is drawn split (waiver, free agent, traded for, other) when the
 * season's transactions were supplied, and whole (`addedLater`) when they were not. Never
 * both: the split parts add up to `addedLater`, so drawing both would count them twice.
 */
export function visibleParts(rows: RosterOrigin[]): OriginPart[] {
  const split = rows.some((r) => SPLIT.some((p) => r[p] > 0))
  return ORIGIN_PARTS.filter((p) => {
    if (p === 'drafted') return true
    if (p === 'addedLater') return !split
    if (p === 'waiver' || p === 'freeAgent') return split
    return rows.some((r) => r[p] > 0)
  })
}

export interface MemberOriginSeason {
  season: number
  parts: OriginPart[]
  row: RosterOrigin
}

/** One manager's line from each season, newest first. A season they have no started points in is skipped. */
export function memberRosterOrigin(
  seasons: Array<{ season: number; rows: RosterOrigin[] }>,
  managerId: number,
): MemberOriginSeason[] {
  return [...seasons]
    .sort((a, b) => b.season - a.season)
    .flatMap((s) => {
      const row = s.rows.find((r) => r.managerId === managerId)
      return row ? [{ season: s.season, parts: visibleParts(s.rows), row }] : []
    })
}
