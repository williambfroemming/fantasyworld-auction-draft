/**
 * The playoff bracket, derived from the games on record
 * (docs/archive/PLAYOFF_MODE_ROADMAP.md, step 87).
 *
 * The import writes a playoff game only once it has been played, so a round in
 * progress has no stored row. The bracket is therefore DERIVED: seeds from the
 * regular season, the shape from `bracketOrder()` / `byesFor()`, and stored
 * playoff rows are used only to fill in scores and advance winners.
 *
 * A stored row that disagrees with the derived pairing draws no bracket at all
 * (`null`). A manual re-seed or an odd tiebreak must not produce a confident
 * wrong bracket; the page keeps its table lead instead.
 *
 * Pure: no database, no clock, no randomness.
 */
import type { HistoryMatchup } from './history'
import { bracketOrder, byesFor } from './playoff-odds'
import type { BracketGame, BracketSide, BracketTeam, PlayoffBracket } from './playoff-types'
import { completeWeeks } from './season-so-far'

export interface PlayoffBracketInput {
  season: number
  /** Every season's rows, already truncated to the week being shown. */
  matchups: HistoryMatchup[]
  playoffTeams: number
  regularSeasonWeeks: number
}

/** The id of the game in `round` at position `index` (1-based, bracket order top to bottom). */
export function bracketGameId(round: number, index: number): string {
  return `r${round}-g${index}`
}

/** The id of the third-place game, which sits in the last round's array. */
export function thirdPlaceGameId(lastRound: number): string {
  return `r${lastRound}-third`
}

const round2 = (n: number) => Number(n.toFixed(2))

/**
 * Seed the field from complete regular-season weeks.
 *
 * Order: wins, then points for, then **manager id ascending**. The last step is
 * not a league rule. It exists so two teams level on wins and on points to the
 * cent still come out in the same order on every render; the league's real
 * tiebreak for that case has never been needed and is not on record. If it ever
 * is needed and goes the other way, the stored playoff rows will contradict the
 * derived pairing and the bracket will not be drawn, which is the safe failure.
 *
 * A tie counts as neither a win nor a loss here: "wins" is the win column.
 */
function seedField(rows: HistoryMatchup[], playoffTeams: number): BracketTeam[] | null {
  const byManager = new Map<number, Omit<BracketTeam, 'seed'>>()
  for (const m of rows) {
    const t = byManager.get(m.managerId) ?? {
      managerId: m.managerId, wins: 0, losses: 0, ties: 0, pointsFor: 0,
    }
    if (m.result === 'W') t.wins++
    else if (m.result === 'L') t.losses++
    else t.ties++
    t.pointsFor += m.points
    byManager.set(m.managerId, t)
  }
  if (byManager.size < playoffTeams) return null

  return [...byManager.values()]
    .map((t) => ({ ...t, pointsFor: round2(t.pointsFor) }))
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor || a.managerId - b.managerId)
    .slice(0, playoffTeams)
    .map((t, i) => ({ ...t, seed: i + 1 }))
}

/**
 * One position in a round: a known team, an empty bye slot, or the still
 * undecided winner of a game.
 */
interface Slot {
  bye: boolean
  team: BracketTeam | null
  /** Seeds that can still end up here. One entry when `team` is known. */
  possible: number[]
  /** Set when this slot is the winner of a game in the previous round. */
  feeder: { loser: BracketTeam | null; loserPossible: number[] } | null
}

/**
 * A side of a game.
 *
 * `winnerOf` for an unknown side is `[lowest, highest]` of the seeds that can
 * still arrive there. One round ahead that is exactly the two seeds of the
 * feeder game ([4, 5]). Two rounds ahead (the final before the semi-finals) the
 * feeder game has an undecided side of its own, so the pair is the RANGE of its
 * half of the bracket: [1, 5] means "whoever comes out of the game seed 1 is
 * in, where the worst seed that can face them is 5". The contract's pair of
 * seeds cannot say more than that.
 */
function sideOf(team: BracketTeam | null, possible: number[]): BracketSide {
  if (team) return { managerId: team.managerId, seed: team.seed, points: null, winnerOf: null }
  return {
    managerId: null,
    seed: null,
    points: null,
    winnerOf: [Math.min(...possible), Math.max(...possible)],
  }
}

/**
 * The bracket as it stands after the last week in `matchups`.
 *
 * Returns null when:
 * - any regular-season week 1..`regularSeasonWeeks` is not complete (as
 *   `completeWeeks()` defines complete), or the settings do not fit the rows;
 * - a stored championship-path or third-place row contradicts the derived
 *   pairing: wrong opponents, a team that should not be playing, a tie, a round
 *   played before the game that feeds it, or a game with only one of its two
 *   rows.
 *
 * Rows that are simply absent mean "not yet played" and nothing more.
 * Fifth-place rows (`playoffPlacement` 5, or any placement other than 3) are
 * ignored: that game is played in the semi-final week and is not drawn.
 *
 * Shape: game ids are `r{round}-g{n}`, n counted top to bottom in bracket
 * order, so for six teams `r1-g1` is 4 v 5, `r1-g2` is 3 v 6, `r2-g1` is seed 1
 * v the 4-5 winner, `r2-g2` is seed 2 v the 3-6 winner and `r3-g1` is the
 * final. Side `a` is always the upper slot (the better original seed line).
 * The third-place game is `r{last}-third`, the LAST entry of the last round's
 * array, with `placement: 3`. Its sides are the semi-final LOSERS, and while
 * one is unknown its `winnerOf` names the semi-final it comes from, exactly as
 * the final's does. Read it with `placement`: on a placement-3 game the side is
 * the loser of that pairing, not the winner.
 *
 * `alive` is in seed order and holds only the champion once the final is
 * played. `currentRound` counts the third-place game, so it is null only when
 * every drawn game has a result.
 */
export function playoffBracket(input: PlayoffBracketInput): PlayoffBracket | null {
  const { season, playoffTeams, regularSeasonWeeks } = input
  if (!Number.isInteger(playoffTeams) || playoffTeams < 2) return null
  if (!Number.isInteger(regularSeasonWeeks) || regularSeasonWeeks < 1) return null

  // --- the regular season must be finished ---------------------------------
  const { complete } = completeWeeks(input.matchups, season)
  const completeByWeek = new Map(complete)
  const regular: HistoryMatchup[] = []
  for (let week = 1; week <= regularSeasonWeeks; week++) {
    const rows = completeByWeek.get(week)
    if (!rows) return null
    regular.push(...rows)
  }

  const teams = seedField(regular, playoffTeams)
  if (!teams) return null

  // --- stored playoff rows, keyed so a derived game can look itself up ------
  const size = 2 ** Math.ceil(Math.log2(playoffTeams))
  const rounds = Math.log2(size)
  const key = (round: number, placement: null | 3, managerId: number, opponent: number) =>
    `${round}:${placement ?? 'path'}:${managerId}:${opponent}`

  const stored = new Map<string, HistoryMatchup>()
  for (const m of input.matchups) {
    if (m.season !== season || !m.isPlayoff) continue
    // A playoff row inside the regular season means the settings handed in do
    // not describe this data. Nothing derived from them can be trusted.
    if (m.week <= regularSeasonWeeks) return null
    if (m.playoffPlacement !== null && m.playoffPlacement !== 3) continue
    const round = m.week - regularSeasonWeeks
    if (round > rounds) return null
    if (m.playoffRound !== null && m.playoffRound !== round) return null
    const k = key(round, m.playoffPlacement, m.managerId, m.opponentManagerId)
    if (stored.has(k)) return null
    stored.set(k, m)
  }
  const consumed = new Set<string>()
  let contradiction = false

  /** Fill a game from its two stored rows, if they exist. */
  const resolve = (game: BracketGame, a: BracketTeam | null, b: BracketTeam | null) => {
    if (!a || !b) return null
    const ka = key(game.round, game.placement, a.managerId, b.managerId)
    const kb = key(game.round, game.placement, b.managerId, a.managerId)
    const ra = stored.get(ka)
    const rb = stored.get(kb)
    if (!ra && !rb) {
      game.status = 'pending'
      return null
    }
    consumed.add(ka)
    consumed.add(kb)
    // Half a game, two rows that tell different stories, or a tie: none of
    // these is a result this bracket can advance.
    if (
      !ra || !rb ||
      ra.points !== rb.opponentPoints || rb.points !== ra.opponentPoints ||
      ra.points === rb.points ||
      ra.result !== (ra.points > rb.points ? 'W' : 'L') ||
      rb.result !== (rb.points > ra.points ? 'W' : 'L')
    ) {
      contradiction = true
      return null
    }
    game.a.points = ra.points
    game.b.points = rb.points
    game.status = 'played'
    const aWon = ra.points > rb.points
    game.winnerManagerId = aWon ? a.managerId : b.managerId
    return aWon ? { winner: a, loser: b } : { winner: b, loser: a }
  }

  // --- walk the rounds ------------------------------------------------------
  let slots: Slot[] = bracketOrder(size).map((seed) =>
    seed <= playoffTeams
      ? { bye: false, team: teams[seed - 1], possible: [seed], feeder: null }
      : { bye: true, team: null, possible: [], feeder: null },
  )

  const out: BracketGame[][] = []
  const eliminated = new Set<number>()

  for (let round = 1; round <= rounds; round++) {
    const week = regularSeasonWeeks + round
    const games: BracketGame[] = []
    const next: Slot[] = []

    for (let k = 0; k < slots.length; k += 2) {
      const x = slots[k]
      const y = slots[k + 1]
      if (x.bye || y.bye) {
        // A bye is not a game: the team passes through untouched.
        next.push({ ...(x.bye ? y : x), feeder: null })
        continue
      }
      const game: BracketGame = {
        id: bracketGameId(round, games.length + 1),
        round, week, placement: null,
        a: sideOf(x.team, x.possible),
        b: sideOf(y.team, y.possible),
        status: 'waiting',
        winnerManagerId: null,
      }
      const result = resolve(game, x.team, y.team)
      games.push(game)
      const possible = [...x.possible, ...y.possible]
      if (result) {
        eliminated.add(result.loser.managerId)
        next.push({
          bye: false, team: result.winner, possible: [result.winner.seed],
          feeder: { loser: result.loser, loserPossible: [result.loser.seed] },
        })
      } else {
        next.push({ bye: false, team: null, possible, feeder: { loser: null, loserPossible: possible } })
      }
    }

    // The third-place game: the two semi-final losers, in the final's week.
    // Only when both finalists come out of a game, so there are two losers.
    if (round === rounds && slots.length === 2 && slots[0].feeder && slots[1].feeder) {
      const [x, y] = [slots[0].feeder, slots[1].feeder]
      const game: BracketGame = {
        id: thirdPlaceGameId(round),
        round, week, placement: 3,
        a: sideOf(x.loser, x.loserPossible),
        b: sideOf(y.loser, y.loserPossible),
        status: 'waiting',
        winnerManagerId: null,
      }
      resolve(game, x.loser, y.loser)
      games.push(game)
    }

    out.push(games)
    slots = next
  }

  // Every stored championship-path or third-place row must belong to a game
  // the derivation drew, between the two teams it drew there. Anything left
  // over is a team that should not be playing, the wrong opponent, or a round
  // on record before the game that feeds it.
  if (contradiction || consumed.size !== stored.size) return null

  const all = out.flat()
  const played = all.filter((g) => g.status === 'played')
  const firstOpen = all.find((g) => g.status !== 'played')
  const final = out[rounds - 1].find((g) => g.placement === null) ?? null

  return {
    season,
    teams,
    byes: teams.slice(0, Math.min(byesFor(playoffTeams), playoffTeams)).map((t) => t.managerId),
    rounds: out,
    throughWeek: Math.max(regularSeasonWeeks, ...played.map((g) => g.week)),
    currentRound: firstOpen ? firstOpen.round : null,
    alive: teams.filter((t) => !eliminated.has(t.managerId)).map((t) => t.managerId),
    championManagerId: final?.winnerManagerId ?? null,
  }
}
