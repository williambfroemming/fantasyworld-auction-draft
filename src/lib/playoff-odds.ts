/**
 * Playoff odds for the season in progress: play the rest of the regular season
 * thousands of times and count how often each team finishes in the top six.
 *
 * ## The model, and why each piece is there
 *
 *   - **Every team scores from a normal distribution** around its own rating.
 *     Fantasy weekly scores are close enough to normal that anything fancier is
 *     precision this sample size cannot support.
 *   - **The rating is shrunk toward the league mean** by `PRIOR_WEEKS` phantom
 *     average weeks. Three weeks in, a team that has scored 150 a week is not a
 *     150-a-week team; it is a good team that has also been lucky. Without the
 *     shrink, week-two odds read 99% and 1%, which is a confident wrong answer.
 *   - **The rating itself is uncertain**, so each simulated season draws a
 *     fresh "true" rating first. Using one fixed rating for every simulation is
 *     the classic way a Monte Carlo becomes overconfident: it treats a
 *     three-week average as a known quantity.
 *   - **The remaining schedule is the real one.** That is the point of the
 *     exercise — two 3-2 teams are not equally placed if one still has to play
 *     the top three. It comes from `season_schedule`, never from a guess.
 *   - **Seeding is wins, then points for**, which is how Sleeper seeds this
 *     league. Points for is simulated alongside wins, so a tiebreaker that is
 *     still live is decided by the simulation rather than frozen at today's PF.
 *
 * ## What it deliberately does not do
 *
 * It does not count the median game. `league_average_match` is off in Sleeper,
 * so the median is a way of *reading* a record, not part of the one that seeds
 * the bracket — odds built on it would be odds for a league that does not exist.
 *
 * ## Deterministic on purpose
 *
 * The random stream is seeded by season and week, so every reader sees the same
 * numbers all week and a reload does not wobble a 41% into a 43%. A number that
 * changes when you refresh the page reads as a number nobody should trust.
 */
import type { HistoryMatchup } from './history'

export interface ScheduledGame {
  week: number
  managerId: number
  opponentManagerId: number
}

export interface PlayoffOddsRow {
  managerId: number
  /** 0–1. Finished in the top `playoffTeams`. */
  playoffPct: number
  /** 0–1. Finished in a bye seat. Zero when the bracket has no byes. */
  byePct: number
  /** Mean final win total across the simulations. */
  projectedWins: number
  /** Mean rating of the opponents still to play. Null with nothing left. */
  remainingSos: number | null
  /** The team's own rating — the per-week score the simulation expects. */
  rating: number
}

export interface PlayoffOdds {
  throughWeek: number
  regularSeasonWeeks: number
  remainingWeeks: number
  playoffTeams: number
  byes: number
  simulations: number
  rows: PlayoffOddsRow[]
}

/** Phantom league-average weeks every rating starts with. */
export const PRIOR_WEEKS = 3
export const SIMULATIONS = 10_000

/** mulberry32 — small, fast, and good enough for counting outcomes. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller. Uses one of the pair; the speed is not worth the bookkeeping. */
function normal(rand: () => number) {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/**
 * Byes in a single-elimination bracket of `teams`: the gap to the next power
 * of two. Six teams in three rounds is two byes, which is this league.
 */
export function byesFor(teams: number) {
  if (teams <= 1) return 0
  return 2 ** Math.ceil(Math.log2(teams)) - teams
}

/**
 * Odds from the games played so far and the games still on the schedule.
 *
 * `played` must already be the complete regular-season weeks — the same rows
 * `seasonSoFar` counts — so the record here cannot disagree with the record
 * drawn beside it. Returns null when there is nothing to project from, or when
 * the remaining schedule is not on record: a projection that silently invented
 * the matchups would be the one number on the page with no basis at all.
 */
export function playoffOdds(input: {
  season: number
  played: HistoryMatchup[]
  schedule: ScheduledGame[]
  regularSeasonWeeks: number
  playoffTeams: number
  simulations?: number
}): PlayoffOdds | null {
  const { season, played, regularSeasonWeeks, playoffTeams } = input
  const simulations = input.simulations ?? SIMULATIONS
  if (played.length === 0) return null

  const throughWeek = Math.max(...played.map((m) => m.week))
  const remaining = input.schedule.filter(
    (g) => g.week > throughWeek && g.week <= regularSeasonWeeks,
  )
  const remainingWeeks = Math.max(0, regularSeasonWeeks - throughWeek)
  // Every remaining week must be on the schedule, or the odds would quietly be
  // computed over a shorter season than the one being played.
  const scheduledWeeks = new Set(remaining.map((g) => g.week))
  if (scheduledWeeks.size < remainingWeeks) return null

  // --- where everybody stands ------------------------------------------------
  const ids = [...new Set(played.map((m) => m.managerId))].sort((a, b) => a - b)
  const index = new Map(ids.map((id, i) => [id, i]))
  const n = ids.length
  const wins = new Float64Array(n)
  const pf = new Float64Array(n)
  const scores: number[][] = ids.map(() => [])
  for (const m of played) {
    const i = index.get(m.managerId)!
    wins[i] += m.result === 'W' ? 1 : m.result === 'T' ? 0.5 : 0
    pf[i] += m.points
    scores[i].push(m.points)
  }

  // --- ratings ---------------------------------------------------------------
  const all = scores.flat()
  const leagueMean = all.reduce((s, x) => s + x, 0) / all.length
  // Pooled within-team spread: how much a team varies around its own level,
  // not how much the league varies — the second is mostly differences between
  // teams, which the ratings already carry.
  let ss = 0
  let dof = 0
  for (const list of scores) {
    if (list.length < 2) continue
    const mean = list.reduce((s, x) => s + x, 0) / list.length
    for (const x of list) ss += (x - mean) ** 2
    dof += list.length - 1
  }
  const leagueSd = Math.sqrt(all.reduce((s, x) => s + (x - leagueMean) ** 2, 0) / all.length)
  // Week one has no within-team spread to measure; the league's is the best
  // available stand-in. A floor stops a freakishly even fortnight from
  // producing a league where nobody's score ever moves.
  const sigma = Math.max(dof > 0 ? Math.sqrt(ss / dof) : leagueSd, 15)

  const games = scores.map((l) => l.length)
  const rating = scores.map((list, i) => {
    const sum = list.reduce((s, x) => s + x, 0)
    return (sum + PRIOR_WEEKS * leagueMean) / (games[i] + PRIOR_WEEKS)
  })
  // The uncertainty in the rating itself, which shrinks as weeks accumulate.
  const ratingSd = games.map((g) => sigma / Math.sqrt(g + PRIOR_WEEKS))

  // --- the games left, as index pairs, each played once -----------------------
  const fixtures: Array<[number, number]> = []
  for (const g of remaining) {
    const a = index.get(g.managerId)
    const b = index.get(g.opponentManagerId)
    if (a === undefined || b === undefined) continue
    if (a < b) fixtures.push([a, b])
  }
  const opponents: number[][] = ids.map(() => [])
  for (const [a, b] of fixtures) {
    opponents[a].push(b)
    opponents[b].push(a)
  }

  // --- simulate --------------------------------------------------------------
  const byes = Math.min(byesFor(playoffTeams), playoffTeams)
  const rand = rng(season * 100 + throughWeek)
  const made = new Float64Array(n)
  const bye = new Float64Array(n)
  const winTotal = new Float64Array(n)
  const simWins = new Float64Array(n)
  const simPf = new Float64Array(n)
  const truth = new Float64Array(n)
  const order = ids.map((_, i) => i)

  for (let s = 0; s < simulations; s++) {
    for (let i = 0; i < n; i++) {
      simWins[i] = wins[i]
      simPf[i] = pf[i]
      truth[i] = rating[i] + ratingSd[i] * normal(rand)
    }
    for (const [a, b] of fixtures) {
      const pa = truth[a] + sigma * normal(rand)
      const pb = truth[b] + sigma * normal(rand)
      simPf[a] += pa
      simPf[b] += pb
      if (pa > pb) simWins[a]++
      else if (pb > pa) simWins[b]++
      else {
        simWins[a] += 0.5
        simWins[b] += 0.5
      }
    }
    order.sort((x, y) => simWins[y] - simWins[x] || simPf[y] - simPf[x])
    for (let seed = 0; seed < n; seed++) {
      const i = order[seed]
      if (seed < playoffTeams) made[i]++
      if (seed < byes) bye[i]++
    }
    for (let i = 0; i < n; i++) winTotal[i] += simWins[i]
  }

  const round = (x: number, dp: number) => Number(x.toFixed(dp))
  const rows: PlayoffOddsRow[] = ids.map((managerId, i) => ({
    managerId,
    playoffPct: made[i] / simulations,
    byePct: bye[i] / simulations,
    projectedWins: round(winTotal[i] / simulations, 1),
    remainingSos: opponents[i].length
      ? round(opponents[i].reduce((s, j) => s + rating[j], 0) / opponents[i].length, 1)
      : null,
    rating: round(rating[i], 1),
  }))
  rows.sort((a, b) => b.playoffPct - a.playoffPct || b.byePct - a.byePct || b.projectedWins - a.projectedWins)

  return {
    throughWeek,
    regularSeasonWeeks,
    remainingWeeks,
    playoffTeams,
    byes,
    simulations,
    rows,
  }
}

/**
 * A probability as a reader should see it.
 *
 * ⚠️ Never "100%" or "0%" while games remain. Ten thousand simulations that
 * all agree are not a proof — clinching and elimination are arithmetic about
 * every possible result, and this is a sample of likely ones. Printing 0% next
 * to a team that can still get in is the confident wrong answer this codebase
 * keeps refusing to give. Once the season is over the numbers are facts.
 */
export function formatOdds(p: number, remainingWeeks: number) {
  if (remainingWeeks === 0) return p >= 0.5 ? '100%' : '0%'
  if (p >= 0.995) return '>99%'
  if (p < 0.005) return '<1%'
  return `${Math.round(p * 100)}%`
}
