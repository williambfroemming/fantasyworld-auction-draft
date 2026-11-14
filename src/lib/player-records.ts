/**
 * The player record book: single weeks and seasons by individual players, from
 * `player_weeks` (docs/archive/ANALYTICS_ROADMAP.md step 55).
 *
 * Rostered players only, weekly era (2020 on), regular season only, complete weeks only
 * (the caller passes the week keys, so this agrees with every other page about which weeks
 * count). A player nobody rostered has no row, so "best ever" here means best among players
 * somebody had.
 *
 * ## Rules this file exists to keep
 *
 * **Never compare across positions.** A quarterback's 40-point week and a tight end's 40-point
 * week are different events. "Best week by a starter" is the one league-wide list because it
 * is a plain statement about points scored; every SEASON total is ranked within its own
 * position, and there is deliberately no overall winner among them. Positions come from the
 * player's own `position`, never the lineup slot.
 *
 * **A bench record never returns a starter.** The bench list is filtered to `isStarter ===
 * false` before it is ranked, and a test pins it.
 *
 * **Every entry names the manager who had the player**, taken from the weekly row itself,
 * which records who actually held him that week. No trade rewind is needed: this is
 * ownership, not a money question.
 *
 * Null is unknown: a null position puts a player in no positional list rather than a made-up
 * one; a null name falls back to the Sleeper id.
 */

export interface PlayerWeekRow {
  season: number
  week: number
  managerId: number
  /** A Sleeper id. */
  playerId: string
  playerName: string | null
  position: string | null
  isStarter: boolean
  points: number
}

export interface GameResult {
  season: number
  week: number
  managerId: number
  result: 'W' | 'L' | 'T' | null | string
}

export interface PlayerRecordEntry {
  managerId: number
  season: number
  /** Null for a season or career total. */
  week: number | null
  /** The number the record is about. */
  value: number
  playerId: string | null
  playerName: string | null
  position: string | null
  /** Extra context, already worded. */
  detail: string | null
}

export interface PlayerRecordList {
  key: string
  label: string
  /** Best first; entry one is the record. At most `top` long. */
  entries: PlayerRecordEntry[]
}

export interface PlayerRecordBook {
  /** One-off league-wide lists. */
  records: PlayerRecordList[]
  /** Best season total, one list per position that appears, in lineup order. Never merged. */
  bySeasonPosition: PlayerRecordList[]
  seasons: number[]
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

const nameOf = (r: { playerName: string | null; playerId: string }) => r.playerName ?? r.playerId

/** Stable best-first sort: a tie keeps the earliest, so a record has one holder. */
function top<T>(rows: T[], by: (r: T) => number, n: number): T[] {
  return rows
    .map((r) => ({ v: by(r), r }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.r)
}

export function playerRecords(
  rows: PlayerWeekRow[],
  results: GameResult[],
  weekKeys: Set<string>,
  topN = 5,
): PlayerRecordBook {
  const inScope = rows.filter((r) => weekKeys.has(`${r.season}:${r.week}`))
  const seasons = [...new Set(inScope.map((r) => r.season))].sort((a, b) => a - b)

  const weekEntry = (r: PlayerWeekRow): PlayerRecordEntry => ({
    managerId: r.managerId,
    season: r.season,
    week: r.week,
    value: r.points,
    playerId: r.playerId,
    playerName: nameOf(r),
    position: r.position,
    detail: null,
  })

  // --- single weeks ---------------------------------------------------------
  const startedBest = top(
    inScope.filter((r) => r.isStarter),
    (r) => r.points,
    topN,
  ).map(weekEntry)
  const benchBest = top(
    inScope.filter((r) => !r.isStarter),
    (r) => r.points,
    topN,
  ).map(weekEntry)

  // --- most bench points by one team in a loss ------------------------------
  const lost = new Set(
    results.filter((g) => g.result === 'L').map((g) => `${g.season}:${g.week}:${g.managerId}`),
  )
  const teamWeeks = new Map<string, { sum: number; best: PlayerWeekRow; rows: PlayerWeekRow[] }>()
  for (const r of inScope) {
    if (r.isStarter) continue
    const key = `${r.season}:${r.week}:${r.managerId}`
    if (!lost.has(key)) continue
    const tw = teamWeeks.get(key)
    if (tw) {
      tw.sum += r.points
      tw.rows.push(r)
      if (r.points > tw.best.points) tw.best = r
    } else teamWeeks.set(key, { sum: r.points, best: r, rows: [r] })
  }
  const benchLoss = top([...teamWeeks.values()], (t) => t.sum, topN).map(
    (t): PlayerRecordEntry => ({
      managerId: t.best.managerId,
      season: t.best.season,
      week: t.best.week,
      value: t.sum,
      playerId: null,
      playerName: null,
      position: null,
      detail: `best on the bench: ${nameOf(t.best)} ${t.best.points.toFixed(1)}`,
    }),
  )

  // --- per player, per manager, per season ----------------------------------
  const stints = new Map<
    string,
    { row: PlayerWeekRow; points: number; started: number; weeks: number }
  >()
  for (const r of inScope) {
    const key = `${r.season}:${r.managerId}:${r.playerId}`
    const s = stints.get(key)
    if (s) {
      s.points += r.points
      s.weeks += 1
      if (r.isStarter) s.started += 1
    } else stints.set(key, { row: r, points: r.points, weeks: 1, started: r.isStarter ? 1 : 0 })
  }

  // Season totals: points scored while ONE manager rostered the player, so the entry has one
  // manager. Ranked within a position, never across.
  const positions = [...new Set([...stints.values()].map((s) => s.row.position))].filter(
    (p): p is string => p !== null,
  )
  positions.sort((a, b) => {
    const ia = POSITION_ORDER.indexOf(a)
    const ib = POSITION_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })
  const bySeasonPosition = positions.map((p): PlayerRecordList => {
    const list = top(
      [...stints.values()].filter((s) => s.row.position === p),
      (s) => s.points,
      topN,
    )
    return {
      key: `bestSeason:${p}`,
      label: `Best season, ${p}`,
      entries: list.map((s) => ({
        managerId: s.row.managerId,
        season: s.row.season,
        week: null,
        value: s.points,
        playerId: s.row.playerId,
        playerName: nameOf(s.row),
        position: p,
        detail: `${s.started} of ${s.weeks} weeks started`,
      })),
    }
  })

  // Most weeks started for one manager, across every season.
  const careers = new Map<string, { row: PlayerWeekRow; started: number; seasons: Set<number> }>()
  for (const s of stints.values()) {
    if (s.started === 0) continue
    const key = `${s.row.managerId}:${s.row.playerId}`
    const c = careers.get(key)
    if (c) {
      c.started += s.started
      c.seasons.add(s.row.season)
      if (s.row.season > c.row.season) c.row = s.row
    } else careers.set(key, { row: s.row, started: s.started, seasons: new Set([s.row.season]) })
  }
  const mostStarted = top([...careers.values()], (c) => c.started, topN).map(
    (c): PlayerRecordEntry => ({
      managerId: c.row.managerId,
      season: c.row.season,
      week: null,
      value: c.started,
      playerId: c.row.playerId,
      playerName: nameOf(c.row),
      position: c.row.position,
      detail: `across ${c.seasons.size} season${c.seasons.size === 1 ? '' : 's'}`,
    }),
  )

  const records: PlayerRecordList[] = [
    { key: 'bestStarterWeek', label: 'Best week by a starter', entries: startedBest },
    { key: 'bestBenchWeek', label: 'Best week left on a bench', entries: benchBest },
    { key: 'benchInLoss', label: 'Most bench points in a loss', entries: benchLoss },
    { key: 'mostWeeksStarted', label: 'Most weeks started for one manager', entries: mostStarted },
  ]
  return { records, bySeasonPosition, seasons }
}
