/**
 * The positional scorecard: for each manager, how many points their STARTERS scored at
 * each position, against what the average manager's starters scored there.
 *
 * (docs/ANALYTICS_ROADMAP.md step 50)
 *
 * ## Three rules this file exists to keep
 *
 * **Group on the player's position, never the lineup slot.** A WR started in FLEX is a WR;
 * a QB started in SUPER_FLEX is a QB. Grouping on `slot` would credit the receiver's points
 * to "FLEX" and make the WR column look worse than the receivers were. (The stored `slot`
 * column is also not trustworthy: this league's data has RBs in a "WR" slot and TEs in a
 * "QB" slot. `position` is the player's own.) The input type carries `slot` only so a test
 * can prove it is ignored.
 *
 * **Compare within a position, never across.** The league mean is per position, so a
 * manager is measured against other managers' receivers, not against their own quarterback.
 * A cross-position comparison does not measure strength; it rediscovers that quarterbacks
 * score more than tight ends. The differences at each position sum to zero across the
 * league, and a test pins that.
 *
 * **Null is unknown, never zero.** A row with no position (or one this league does not
 * play) goes to an "unknown" bucket that is REPORTED, so a manager's positions plus
 * `unknown` always add up to their started total. Nothing is dropped.
 *
 * Regular season only: the caller passes the week keys (`regularSeasonWeekKeys()` in
 * history.ts), so this cannot disagree with the all-play and efficiency columns about
 * which weeks count. Weekly data begins in 2020.
 */

/** The positions a fantasy lineup can hold, in the order a reader expects them. */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
export type Position = (typeof POSITIONS)[number]

const KNOWN = new Set<string>(POSITIONS)

/** One player's week, as stored in `player_weeks`. */
export interface StarterRow {
  season: number
  week: number
  managerId: number
  /** The player's own position. Null when unknown. */
  position: string | null
  isStarter: boolean
  points: number
  /** The lineup slot. Present only so it can be ignored on purpose. */
  slot?: string | null
}

export interface PositionCell {
  /** Started points at this position this season. */
  points: number
  /** The mean of every manager's started points at this position. */
  leagueMean: number
  /** `points - leagueMean`. Positive means they out-scored the typical manager there. */
  diff: number
}

export interface PositionalRow {
  managerId: number
  byPosition: Partial<Record<Position, PositionCell>>
  /** Started points with no recognised position. Reported, never dropped. */
  unknown: number
  /** All started points: the positions plus `unknown`. */
  total: number
}

export interface PositionalScorecard {
  season: number
  /** Only positions that appear in the data, in lineup order: no empty K column. */
  positions: Position[]
  /** Distinct regular-season weeks counted. */
  weeks: number
  rows: PositionalRow[]
  /** Started rows whose position was null or unrecognised, league-wide. */
  unknownRows: number
}

export function positionalScorecard(
  rows: StarterRow[],
  season: number,
  weekKeys: Set<string>,
): PositionalScorecard {
  const starts = rows.filter(
    (r) => r.season === season && r.isStarter && weekKeys.has(`${season}:${r.week}`),
  )

  const managers = [...new Set(starts.map((r) => r.managerId))].sort((a, b) => a - b)
  const weeks = new Set(starts.map((r) => r.week)).size

  const present = new Set<Position>()
  const pts = new Map<number, Map<Position, number>>(managers.map((m) => [m, new Map()]))
  const unknown = new Map<number, number>(managers.map((m) => [m, 0]))
  let unknownRows = 0

  for (const r of starts) {
    if (r.position !== null && KNOWN.has(r.position)) {
      const pos = r.position as Position
      present.add(pos)
      const mine = pts.get(r.managerId)!
      mine.set(pos, (mine.get(pos) ?? 0) + r.points)
    } else {
      unknownRows++
      unknown.set(r.managerId, unknown.get(r.managerId)! + r.points)
    }
  }

  const positions = POSITIONS.filter((p) => present.has(p))
  // A manager who started nobody at a position scored 0 there, and counts as a 0 in the
  // mean: they are in the field, and "scored nothing at TE" is a fact about their season.
  const mean = new Map<Position, number>(
    positions.map((p) => [
      p,
      managers.reduce((sum, m) => sum + (pts.get(m)!.get(p) ?? 0), 0) / Math.max(1, managers.length),
    ]),
  )

  return {
    season,
    positions,
    weeks,
    unknownRows,
    rows: managers.map((managerId) => {
      const byPosition: PositionalRow['byPosition'] = {}
      let total = unknown.get(managerId)!
      for (const p of positions) {
        const points = pts.get(managerId)!.get(p) ?? 0
        total += points
        byPosition[p] = { points, leagueMean: mean.get(p)!, diff: points - mean.get(p)! }
      }
      return { managerId, byPosition, unknown: unknown.get(managerId)!, total }
    }),
  }
}

export interface MemberPositionalSeason {
  season: number
  weeks: number
  /** The signed difference at each position, for the positions that season had. */
  diffs: Partial<Record<Position, number>>
  total: number
}

/** One manager's line from each season's scorecard, newest first. Seasons they have no row in are skipped. */
export function memberPositional(
  scorecards: PositionalScorecard[],
  managerId: number,
): MemberPositionalSeason[] {
  return [...scorecards]
    .sort((a, b) => b.season - a.season)
    .flatMap((sc) => {
      const row = sc.rows.find((r) => r.managerId === managerId)
      if (!row) return []
      const diffs: MemberPositionalSeason['diffs'] = {}
      for (const p of sc.positions) diffs[p] = row.byPosition[p]!.diff
      return [{ season: sc.season, weeks: sc.weeks, diffs, total: row.total }]
    })
}
