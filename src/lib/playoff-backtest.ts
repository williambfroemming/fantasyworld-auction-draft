/**
 * How the playoff odds would have done in every finished season — and whether
 * the record-by-week history would have done better.
 *
 * Run every offseason (`npm run odds:backtest`). The question it exists to
 * answer is one nobody can settle by looking at the front page: is the model
 * still honest, and has the history grown enough to be worth folding in? Six
 * seasons said "not yet" in October 2026 — the history is too thin, and four
 * 0-4 teams would overrule the model for everybody. The answer changes as
 * seasons accumulate, and this is how we find out when.
 *
 * ## Leave one season out
 *
 * ⚠️ The history is scored **without the season being predicted**. Scoring
 * 2024's 0-4 team against a cell that already contains 2024's 0-4 team is the
 * history grading its own homework, and it would always look better than the
 * model for exactly that reason.
 */
import { playoffOdds } from './playoff-odds'
import { recordCell, recordPaths, MIN_SAMPLE } from './record-paths'
import { completeWeeks } from './season-so-far'
import type { HistoryMatchup, HistorySeason, HistoryStanding } from './history'

export const CHECKPOINTS = [2, 4, 6, 8, 10]

export interface BacktestBucket {
  label: string
  teams: number
  /** Mean predicted probability in the bucket. */
  predicted: number
  /** Share that actually made it. */
  actual: number
}

export interface BacktestResult {
  seasons: number[]
  predictions: number
  /** Share of all team-seasons that made it: what a no-information guess says. */
  baseRate: number
  /** Mean squared error, lower is better. */
  brier: { model: number; history: number; baseline: number }
  buckets: BacktestBucket[]
}

const EDGES = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0001]

export function backtest(input: {
  matchups: HistoryMatchup[]
  standings: HistoryStanding[]
  seasons: HistorySeason[]
  /** Playoff field per season. Seasons without one are skipped. */
  playoffTeams: Map<number, number>
  simulations?: number
}): BacktestResult | null {
  const { matchups, standings, seasons, playoffTeams } = input
  const made = new Set(
    standings.filter((s) => s.madePlayoffs).map((s) => `${s.season}:${s.managerId}`),
  )
  const finished = seasons.filter(
    (s) => s.championManagerId !== null && s.regularSeasonWeeks && playoffTeams.get(s.season),
  )

  const rows: Array<{ model: number; history: number; hit: number }> = []
  const counted: number[] = []
  let teamSeasons = 0
  let madeTotal = 0

  for (const s of finished) {
    const { regular, complete } = completeWeeks(matchups, s.season)
    if (complete.length === 0) continue
    counted.push(s.season)
    const ids = [...new Set(regular.map((m) => m.managerId))]
    teamSeasons += ids.length
    madeTotal += ids.filter((id) => made.has(`${s.season}:${id}`)).length

    // History from every OTHER finished season.
    const others = seasons.filter((x) => x.season !== s.season)
    const paths = recordPaths({ matchups, standings, seasons: others, currentSeason: null })
    const fallback = playoffTeams.get(s.season)! / ids.length

    const schedule = regular.map((m) => ({
      week: m.week,
      managerId: m.managerId,
      opponentManagerId: m.opponentManagerId,
    }))
    for (const week of CHECKPOINTS) {
      if (week >= s.regularSeasonWeeks!) continue
      const played = complete.filter(([w]) => w <= week).flatMap(([, r]) => r)
      const odds = playoffOdds({
        season: s.season,
        played,
        schedule,
        regularSeasonWeeks: s.regularSeasonWeeks!,
        playoffTeams: playoffTeams.get(s.season)!,
        simulations: input.simulations,
      })
      if (!odds) continue
      for (const r of odds.rows) {
        const mine = played.filter((m) => m.managerId === r.managerId)
        const wins = mine.filter((m) => m.result === 'W').length
        const losses = mine.filter((m) => m.result === 'L').length
        const tied = mine.some((m) => m.result === 'T')
        const cell = tied ? undefined : recordCell(paths, week, wins, losses)
        const history =
          cell && cell.teams >= MIN_SAMPLE ? cell.made / cell.teams : fallback
        rows.push({ model: r.playoffPct, history, hit: made.has(`${s.season}:${r.managerId}`) ? 1 : 0 })
      }
    }
  }

  if (rows.length === 0) return null
  const baseRate = madeTotal / teamSeasons
  const mse = (f: (r: (typeof rows)[number]) => number) =>
    rows.reduce((t, r) => t + (f(r) - r.hit) ** 2, 0) / rows.length

  const buckets: BacktestBucket[] = []
  for (let i = 0; i < EDGES.length - 1; i++) {
    const inside = rows.filter((r) => r.model >= EDGES[i] && r.model < EDGES[i + 1])
    if (!inside.length) continue
    const hi = Math.min(Math.round(EDGES[i + 1] * 100), 100)
    buckets.push({
      label: `${Math.round(EDGES[i] * 100)}–${hi}%`,
      teams: inside.length,
      predicted: inside.reduce((t, r) => t + r.model, 0) / inside.length,
      actual: inside.reduce((t, r) => t + r.hit, 0) / inside.length,
    })
  }

  return {
    seasons: counted,
    predictions: rows.length,
    baseRate,
    brier: { model: mse((r) => r.model), history: mse((r) => r.history), baseline: mse(() => baseRate) },
    buckets,
  }
}
