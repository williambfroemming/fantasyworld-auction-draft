/**
 * The numbers behind the league charts (docs/ANALYTICS_ROADMAP.md step 46).
 *
 * Pure: every function takes a `HistoryInput` and returns plain data the chart kit can
 * draw. Nothing here reads the database, and nothing recomputes what `leagueSummary()`
 * already derives — `titlesAndMoney` reuses it, and a test pins that the final cumulative
 * win total equals the summary's.
 *
 * Coverage: standings reach back to 2011. Nothing here touches weekly data.
 */
import { leagueSummary, type HistoryInput, type HistoryStanding } from './history'

export interface SeriesPoint {
  /** A season. */
  x: number
  /** Null is unknown, never zero: a manager who had not joined yet, or has no place on record. */
  y: number | null
}

export interface MemberSeries {
  managerId: number
  points: SeriesPoint[]
}

export interface CumulativeReport {
  /** Every season with a standings row, ascending. The x axis. */
  seasons: number[]
  series: MemberSeries[]
  /**
   * Seasons a manager has a standings row but no figure for. The running total carries
   * through them unchanged, which understates it, so the page can say so.
   */
  missing: Array<{ managerId: number; season: number }>
}

function standingSeasons(standings: HistoryStanding[]): number[] {
  return [...new Set(standings.map((s) => s.season))].sort((a, b) => a - b)
}

/**
 * Running total of `pick(standing)` by season, per manager.
 *
 * Before a manager's first season the value is null (they were not in the league, which
 * is not the same as having won nothing). From their first season on, a season in which
 * they have no standings row carries the total forward flat.
 */
function cumulative(
  input: HistoryInput,
  pick: (s: HistoryStanding) => number | null,
): CumulativeReport {
  const seasons = standingSeasons(input.standings)
  const missing: CumulativeReport['missing'] = []
  const series: MemberSeries[] = []

  for (const m of input.members) {
    const mine = new Map(
      input.standings.filter((s) => s.managerId === m.managerId).map((s) => [s.season, s]),
    )
    if (mine.size === 0) continue // never in the league's standings: nothing to draw

    let running = 0
    let started = false
    const points: SeriesPoint[] = seasons.map((x) => {
      const row = mine.get(x)
      if (row) {
        started = true
        const v = pick(row)
        if (v === null) missing.push({ managerId: m.managerId, season: x })
        else running += v
      }
      return { x, y: started ? Number(running.toFixed(2)) : null }
    })
    series.push({ managerId: m.managerId, points })
  }
  return { seasons, series, missing }
}

export const cumulativeWins = (input: HistoryInput) => cumulative(input, (s) => s.wins)

export const cumulativePoints = (input: HistoryInput) => cumulative(input, (s) => s.pointsFor)

export interface FinishReport {
  seasons: number[]
  /** The worst place anyone finished, for the size of the axis. */
  worst: number
  series: MemberSeries[]
}

/**
 * REGULAR-SEASON place per manager per season — NOT the bracket. `season_standings.place`
 * is the regular season (AGENTS.md); the champion is in `seasons`. A season with no place
 * on record is null, so the line breaks there rather than dropping to last.
 */
export function finishBySeason(input: HistoryInput): FinishReport {
  const seasons = standingSeasons(input.standings)
  const series: MemberSeries[] = []
  for (const m of input.members) {
    const mine = new Map(
      input.standings.filter((s) => s.managerId === m.managerId).map((s) => [s.season, s]),
    )
    if (mine.size === 0) continue
    series.push({
      managerId: m.managerId,
      points: seasons.map((x) => ({ x, y: mine.get(x)?.place ?? null })),
    })
  }
  const places = series.flatMap((s) => s.points.flatMap((p) => (p.y === null ? [] : [p.y])))
  return { seasons, worst: places.length ? Math.max(...places) : 0, series }
}

export interface TitleMoneyRow {
  managerId: number
  titles: number
  /** Gross prize money. Null when nothing is known, which is not $0. */
  moneyWon: number | null
  /** Prizes minus entry fees over the seasons with a buy-in on record; null if none. */
  netWinnings: number | null
}

/** Titles and money, straight from `leagueSummary()` — nothing is recomputed here. */
export function titlesAndMoney(input: HistoryInput): {
  rows: TitleMoneyRow[]
  coverage: ReturnType<typeof leagueSummary>['titles']
  moneyUnknownSeasons: number[]
} {
  const report = leagueSummary(input)
  const unknown = new Set<number>()
  const rows = report.rows.map((r) => {
    r.allTime.moneyUnknownSeasons.forEach((s) => unknown.add(s))
    return {
      managerId: r.member.managerId,
      titles: r.allTime.titles,
      moneyWon: r.allTime.moneyWon,
      netWinnings: r.allTime.netWinnings,
    }
  })
  return { rows, coverage: report.titles, moneyUnknownSeasons: [...unknown].sort((a, b) => a - b) }
}
