import { isCountedPlayoff, type HistoryMatchup } from '@/lib/history'

/**
 * A strength rating for every manager after every game, 2020 on
 * (docs/ANALYTICS_ROADMAP.md step 56).
 *
 * **This is a model, not a record.** It is an Elo rating: everyone starts at 1500, a win
 * against a stronger team moves you more than a win against a weaker one, and a bigger margin
 * moves you more than a narrow one. Nobody's real record changes if a rating does. It answers
 * "how strong has this team looked lately", which a win total cannot, because a win total
 * never forgets an old season.
 *
 * - **K = 20**, expected score from the rating gap in the usual Elo form.
 * - **Margin factor** `ln(|margin| + 1)`, divided by `ln(average margin + 1)` over the games
 *   handed in, so an average-sized win counts exactly once and a blowout counts more. A tie
 *   has no margin to scale by and counts at 1.
 * - **Between seasons** every rating moves one third of the way back to 1500. Rosters are
 *   re-bought every August; last year's strength is only part of the evidence.
 * - **Zero-sum:** whatever one side gains the other loses, so the league's total never moves.
 * - **A win never lowers a rating**: the update is `K * factor * (score - expected)` and
 *   `score - expected` is positive for a win. (A tie against a weaker team can lower yours;
 *   that is what a tie is.)
 *
 * Games: regular season plus the playoff games `isCountedPlayoff()` accepts (the fifth-place
 * game, which nobody plays seriously, is out). Matchups are stored once per side, so each
 * game is processed once, from the side with the lower manager id. Order is season, week,
 * manager id, so the output is identical on every run. Two games in one week never share a
 * manager, so within a week the order cannot matter.
 *
 * A manager with no game in a week has no point that week (a playoff bye, a missing year):
 * unknown, never carried forward as if a rating had been measured.
 */

export const START_RATING = 1500
export const K_FACTOR = 20
/** Share of the way back to the mean that every rating travels between seasons. */
export const REGRESSION = 1 / 3

export interface RatingPoint {
  season: number
  week: number
  /** The rating after this game. */
  rating: number
  /** Change from this game alone (not counting any season-start regression). */
  change: number
  opponentManagerId: number
  result: 'W' | 'L' | 'T'
  isPlayoff: boolean
}

export interface ManagerRating {
  managerId: number
  points: RatingPoint[]
}

export interface RatingExtreme {
  rating: number
  season: number
  week: number
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

/** Every game once, in a fixed order. */
function gamesOnce(matchups: HistoryMatchup[]): HistoryMatchup[] {
  return matchups
    .filter((m) => (!m.isPlayoff || isCountedPlayoff(m)) && m.managerId < m.opponentManagerId)
    .sort((a, b) => a.season - b.season || a.week - b.week || a.managerId - b.managerId)
}

export function ratingHistory(matchups: HistoryMatchup[]): ManagerRating[] {
  const games = gamesOnce(matchups)
  if (games.length === 0) return []

  const margins = games
    .filter((g) => g.result !== 'T')
    .map((g) => Math.abs(g.points - g.opponentPoints))
  const average = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0
  const scale = Math.log(average + 1) || 1

  const rating = new Map<number, number>()
  const out = new Map<number, RatingPoint[]>()
  const get = (id: number) => rating.get(id) ?? START_RATING
  const record = (id: number, p: RatingPoint) => {
    const list = out.get(id) ?? []
    list.push(p)
    out.set(id, list)
  }

  let currentSeason = games[0].season
  for (const g of games) {
    if (g.season !== currentSeason) {
      for (const [id, r] of rating)
        rating.set(id, START_RATING + (r - START_RATING) * (1 - REGRESSION))
      currentSeason = g.season
    }
    const a = g.managerId
    const b = g.opponentManagerId
    const ra = get(a)
    const rb = get(b)
    const score = g.result === 'W' ? 1 : g.result === 'L' ? 0 : 0.5
    const factor =
      g.result === 'T' ? 1 : Math.log(Math.abs(g.points - g.opponentPoints) + 1) / scale
    const delta = K_FACTOR * factor * (score - expectedScore(ra, rb))
    rating.set(a, ra + delta)
    rating.set(b, rb - delta)
    const flip = { W: 'L', L: 'W', T: 'T' } as const
    const shared = { season: g.season, week: g.week, isPlayoff: g.isPlayoff }
    record(a, {
      ...shared,
      rating: ra + delta,
      change: delta,
      opponentManagerId: b,
      result: g.result,
    })
    record(b, {
      ...shared,
      rating: rb - delta,
      change: -delta,
      opponentManagerId: a,
      result: flip[g.result],
    })
  }

  return [...out.entries()]
    .sort(([x], [y]) => x - y)
    .map(([managerId, points]) => ({ managerId, points }))
}

/** A manager's highest and lowest rating and when it happened. Ties keep the earliest. */
export function peakAndLow(
  points: RatingPoint[],
): { peak: RatingExtreme; low: RatingExtreme } | null {
  if (points.length === 0) return null
  let peak = points[0]
  let low = points[0]
  for (const p of points) {
    if (p.rating > peak.rating) peak = p
    if (p.rating < low.rating) low = p
  }
  const pick = (p: RatingPoint): RatingExtreme => ({
    rating: p.rating,
    season: p.season,
    week: p.week,
  })
  return { peak: pick(peak), low: pick(low) }
}

/**
 * Position on a shared x axis: a game week counted across seasons, 1 for the first week on
 * record. Every manager's point in the same `season:week` has the same x, and a season break
 * is just the next integer, so the axis is evenly spaced in games, not in calendar time.
 */
export function weekAxis(history: ManagerRating[]): {
  index: Map<string, number>
  /** First x of each season, for drawing boundaries. */
  seasonStarts: Array<{ season: number; x: number }>
  /** `x` to a label like "2024 wk 3". */
  labels: Record<number, string>
} {
  const keys = new Map<string, { season: number; week: number }>()
  for (const m of history)
    for (const p of m.points) keys.set(`${p.season}:${p.week}`, { season: p.season, week: p.week })
  const sorted = [...keys.entries()].sort(([, a], [, b]) => a.season - b.season || a.week - b.week)
  const index = new Map<string, number>()
  const labels: Record<number, string> = {}
  const seasonStarts: Array<{ season: number; x: number }> = []
  sorted.forEach(([key, v], i) => {
    const x = i + 1
    index.set(key, x)
    labels[x] = `${v.season} wk ${v.week}`
    if (seasonStarts[seasonStarts.length - 1]?.season !== v.season)
      seasonStarts.push({ season: v.season, x })
  })
  return { index, seasonStarts, labels }
}
