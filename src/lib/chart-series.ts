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
import { teamSpend, type SpendColumn, type StatsInput } from './stats'

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

export interface AuctionSpendRow {
  season: number
  spent: number
  /** League-wide dollars at each position that year. */
  byPosition: Record<SpendColumn, number>
}

/**
 * Dollars spent at each position, per auction, league-wide.
 *
 * Goes through `teamSpend()` — the one spend calculation — season by season rather than
 * summing prices here, so this chart and /stats cannot disagree. Positions group on the
 * player's own `position` (K and DEF fall into OTHER), never a lineup slot.
 *
 * `teamSpend` also derives each manager's unspent budget and drift; those need live
 * budgets this history input does not carry, so they are fed zeros and ignored. Only
 * `totals.byPosition` is read. League totals do not depend on who bought whom, but the
 * trade log is passed anyway so the attribution path is the same one /stats uses.
 *
 * Newest season first, matching the Past Auctions list beside it.
 */
export function auctionSpendByPosition(input: HistoryInput): AuctionSpendRow[] {
  const picks = input.picks ?? []
  const trades = input.trades ?? []
  const seasons = [...new Set(picks.map((p) => p.season))].sort((a, b) => b - a)

  return seasons.map((season) => {
    const mine = picks.filter((p) => p.season === season)
    const ids = new Set(mine.map((p) => p.id))
    const stats: StatsInput = {
      season,
      rosterSize: 0,
      startingBudget: 0,
      managers: input.members.map((m) => ({
        id: m.managerId,
        displayName: m.displayName,
        color: m.color,
        draftSlot: 0,
        budget: 0,
        rostered: 0,
      })),
      picks: mine.map((p) => ({
        id: p.id,
        pickNo: 0,
        managerId: p.managerId,
        nominatorId: 0,
        price: p.price,
        position: p.playerPosition,
        name: p.playerName,
        rank: null,
        posRank: null,
      })),
      // Only trades that moved this season's players; a trade never spans two seasons.
      trades: trades.filter(
        (t) => t.players.length > 0 && t.players.every((x) => ids.has(x.pickId)),
      ),
    }
    const { totals } = teamSpend(stats)
    return { season, spent: totals.spent, byPosition: totals.byPosition }
  })
}
