/**
 * Title odds and win probabilities once the bracket is set: play what is left of
 * the bracket thousands of times, from where it actually stands.
 *
 * ## The model
 *
 * The same one `playBracket()` in `playoff-odds.ts` uses, so a title percentage
 * here means what `titlePct` meant all season:
 *
 *   - each simulation first draws a "true" rating for every team, around its
 *     rating with spread `ratingSd` (the rating is an estimate, not a known);
 *   - each game is two draws around those truths with spread `sigma`, and the
 *     higher score advances (`a` on an exact tie, as `playBracket()` does).
 *
 * Games already played are fixed: their winner advances in every simulation.
 *
 * ## Ratings are the regular season's
 *
 * `ratings` is `teamRatings()` over the complete regular-season weeks and is not
 * re-rated from playoff games (docs/PLAYOFF_MODE_ROADMAP.md, section 3): it is the
 * rating shown everywhere else, and one or two playoff games, zero for a bye
 * team, would add noise unevenly.
 *
 * ## Its own generators, and the draw order
 *
 * Nothing here touches the stream inside `playoffOdds()`; this file has its own
 * copy of the generator and the normal draw rather than importing them. Two
 * streams, both seeded from season and `bracket.throughWeek`:
 *
 *   1. `rand`, per simulation: one truth per team in `bracket.teams` order
 *      (every team, eliminated or not), then every unplayed championship-path
 *      game in round order and array order, side `a` before side `b`.
 *   2. `thirdRand`, per simulation: the third-place game, `a` then `b`, and
 *      only while that game is pending.
 *
 * The third-place game reads the truths but draws its scores from the second
 * stream, so the title odds are identical whether or not it is pending. Seeded,
 * so two calls agree exactly and a reload does not wobble a number.
 */
import type { TeamRatings } from './playoff-odds'
import type { BracketGame, BracketOdds, BracketSide, PlayoffBracket } from './playoff-types'

export const BRACKET_SIMULATIONS = 10_000

/**
 * Mixed into the seed so this stream is neither `playoffOdds()`'s main stream
 * nor its `bracketRand` (which uses 0x5bd1e995).
 */
const BRACKET_ODDS_SEED = 0x9e3779b9
const THIRD_PLACE_SEED = 0x85ebca6b

/** mulberry32. A copy of the one in playoff-odds.ts, which is not exported. */
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

/** Box–Muller, one of the pair. Also a copy. */
function normal(rand: () => number) {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Where a side's team comes from: a known team, or the winner of an earlier game. */
type Source = { team: number } | { game: number }

interface PathGame {
  game: BracketGame
  /** Fixed winner's team index for a played game, else -1. */
  fixed: number
  a: Source
  b: Source
  /** Every seed that could still come out of this game. */
  seeds: Set<number>
}

/**
 * Title odds for every team still alive and a win probability for every pending
 * game, the third-place game included while it is pending.
 *
 * Null when the bracket is decided (there is nothing left to give odds on), and
 * also when it cannot be simulated honestly: a bracket team with no rating, a
 * played game with no winner, or a waiting side whose feeder game cannot be
 * found. No odds is the right answer to a bracket this function cannot read.
 *
 * `gamesRemaining` counts unplayed championship-path games only, so the
 * third-place game never keeps `formatOdds()` hedging after the final.
 */
export function bracketOdds(
  bracket: PlayoffBracket,
  ratings: TeamRatings,
  season: number,
): BracketOdds | null {
  if (bracket.championManagerId !== null) return null

  // --- teams, in seed order, with their ratings --------------------------------
  const byManager = new Map(ratings.teams.map((t) => [t.managerId, t]))
  const index = new Map<number, number>()
  const rating: number[] = []
  const ratingSd: number[] = []
  for (const team of bracket.teams) {
    const rated = byManager.get(team.managerId)
    if (!rated) return null
    index.set(team.managerId, rating.length)
    rating.push(rated.rating)
    ratingSd.push(rated.ratingSd)
  }
  const n = rating.length
  const { sigma } = ratings

  // --- the championship path, each side resolved to a team or a feeder game ----
  const path: PathGame[] = []
  let previous: number[] = [] // indices into `path` of the round before
  for (const roundGames of bracket.rounds) {
    const current: number[] = []
    const unfed = new Set(previous)
    const waiting: Array<{ entry: PathGame; key: 'a' | 'b'; side: BracketSide }> = []

    for (const game of roundGames) {
      if (game.placement !== null) continue
      const entry: PathGame = { game, fixed: -1, a: { team: -1 }, b: { team: -1 }, seeds: new Set() }
      if (game.status === 'played') {
        const winner = game.winnerManagerId === null ? undefined : index.get(game.winnerManagerId)
        if (winner === undefined) return null
        entry.fixed = winner
      }
      for (const key of ['a', 'b'] as const) {
        const side = game[key]
        if (side.managerId !== null) {
          const team = index.get(side.managerId)
          if (team === undefined) return null
          entry[key] = { team }
          entry.seeds.add(bracket.teams[team].seed)
          // A team that got here by winning last round has used that game up.
          for (const p of unfed) if (path[p].fixed === team) unfed.delete(p)
        } else if (entry.fixed === -1) {
          waiting.push({ entry, key, side })
        }
      }
      current.push(path.length)
      path.push(entry)
    }

    // Waiting sides: first by the seeds the contract names, then by position.
    const feed = (w: (typeof waiting)[number], p: number) => {
      w.entry[w.key] = { game: p }
      for (const seed of path[p].seeds) w.entry.seeds.add(seed)
      unfed.delete(p)
    }
    const unmatched: typeof waiting = []
    for (const w of waiting) {
      const named = w.side.winnerOf
      const p = named && [...unfed].find((q) => named.every((seed) => path[q].seeds.has(seed)))
      if (p === undefined || p === null) unmatched.push(w)
      else feed(w, p)
    }
    for (const w of unmatched) {
      const p = [...unfed][0]
      if (p === undefined) return null
      feed(w, p)
    }
    if (current.length > 0) previous = current
  }

  const open = path.filter((g) => g.fixed === -1)
  if (open.length === 0) return null
  // Whoever wins the last game on the path wins the title, so the last round must
  // be one game, and it must still be unplayed.
  const final = path.length - 1
  if (previous.length !== 1 || path[final].fixed !== -1) return null

  // --- what gets counted --------------------------------------------------------
  const pendingAt = new Int32Array(path.length).fill(-1) // path index -> counter
  const reported: Array<{ gameId: string; counter: number }> = []
  let third: { a: number; b: number; counter: number } | null = null
  const pathIndex = new Map(path.map((g, p) => [g.game, p]))
  for (const roundGames of bracket.rounds) {
    for (const game of roundGames) {
      if (game.status !== 'pending') continue
      const counter = reported.length
      if (game.placement === null) {
        pendingAt[pathIndex.get(game)!] = counter
      } else {
        const a = game.a.managerId === null ? undefined : index.get(game.a.managerId)
        const b = game.b.managerId === null ? undefined : index.get(game.b.managerId)
        // One third-place game. A second, or one with a side missing, is not reported.
        if (a === undefined || b === undefined || third) continue
        third = { a, b, counter }
      }
      reported.push({ gameId: game.id, counter })
    }
  }

  // --- simulate -----------------------------------------------------------------
  const seed = season * 100 + bracket.throughWeek
  const rand = rng(seed ^ BRACKET_ODDS_SEED)
  const thirdRand = rng(seed ^ THIRD_PLACE_SEED)
  const truth = new Float64Array(n)
  const winner = new Int32Array(path.length)
  const titles = new Float64Array(n)
  const aWins = new Float64Array(reported.length)
  const teamOf = (s: Source) => ('team' in s ? s.team : winner[s.game])

  for (let s = 0; s < BRACKET_SIMULATIONS; s++) {
    for (let i = 0; i < n; i++) truth[i] = rating[i] + ratingSd[i] * normal(rand)
    for (let p = 0; p < path.length; p++) {
      const g = path[p]
      if (g.fixed !== -1) {
        winner[p] = g.fixed
        continue
      }
      const a = teamOf(g.a)
      const b = teamOf(g.b)
      const pa = truth[a] + sigma * normal(rand)
      const pb = truth[b] + sigma * normal(rand)
      winner[p] = pa >= pb ? a : b
      if (pendingAt[p] !== -1 && pa >= pb) aWins[pendingAt[p]]++
    }
    titles[winner[final]]++

    if (third) {
      const pa = truth[third.a] + sigma * normal(thirdRand)
      const pb = truth[third.b] + sigma * normal(thirdRand)
      if (pa >= pb) aWins[third.counter]++
    }
  }

  return {
    simulations: BRACKET_SIMULATIONS,
    gamesRemaining: open.length,
    title: bracket.alive
      .filter((managerId) => index.has(managerId))
      .map((managerId) => ({ managerId, titlePct: titles[index.get(managerId)!] / BRACKET_SIMULATIONS })),
    games: reported.map(({ gameId, counter }) => ({ gameId, aWinPct: aWins[counter] / BRACKET_SIMULATIONS })),
  }
}
