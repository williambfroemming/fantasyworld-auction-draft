import { describe, expect, it } from 'vitest'
import { BRACKET_SIMULATIONS, bracketOdds } from './playoff-bracket-odds'
import { PRIOR_WEEKS, formatOdds, playoffOdds, teamRatings, type ScheduledGame, type TeamRatings } from './playoff-odds'
import type { BracketGame, BracketSide, PlayoffBracket } from './playoff-types'
import type { HistoryMatchup } from './history'

// ---------------------------------------------------------------------------
// A six-team bracket in the 2025 shape, built by hand: seeds 1 and 2 have byes,
// round one is 4 v 5 and 3 v 6, round two is 1 v winner(4,5) and 2 v winner(3,6),
// round three is the final and the third-place game. The lower seed wins every
// played game except the semi-finals, as in 2025 (5 and 6 won round one, then
// lost to 1 and 2).
// ---------------------------------------------------------------------------

/** Manager id for a seed, unless the test supplies its own. */
const DEFAULT_MANAGERS = [11, 12, 13, 14, 15, 16]

type Stage =
  | 'round-one-pending' // through week 14
  | 'semis-pending' // through week 15
  | 'one-semi-played' // seed 1 has won its semi, the other is still to play
  | 'final-pending' // through week 16
  | 'decided' // through week 17

function bracketAt(stage: Stage, managers: number[] = DEFAULT_MANAGERS): PlayoffBracket {
  const id = (seed: number) => managers[seed - 1]
  const known = (seed: number, points: number | null = null): BracketSide => ({
    managerId: id(seed),
    seed,
    points,
    winnerOf: null,
  })
  const waitingOn = (a: number, b: number): BracketSide => ({
    managerId: null,
    seed: null,
    points: null,
    winnerOf: [a, b],
  })
  const game = (
    gameId: string,
    round: number,
    a: BracketSide,
    b: BracketSide,
    winnerSeed: number | null,
    placement: null | 3 = null,
  ): BracketGame => ({
    id: gameId,
    round,
    week: 14 + round,
    placement,
    a,
    b,
    status: winnerSeed !== null ? 'played' : a.managerId !== null && b.managerId !== null ? 'pending' : 'waiting',
    winnerManagerId: winnerSeed === null ? null : id(winnerSeed),
  })

  const order: Stage[] = ['round-one-pending', 'semis-pending', 'one-semi-played', 'final-pending', 'decided']
  const at = order.indexOf(stage)
  const r1Done = at >= 1
  const semiOneDone = at >= 2
  const semisDone = at >= 3
  const finalDone = at >= 4

  const rounds: BracketGame[][] = [
    [
      game('r1-g1', 1, known(4, r1Done ? 101 : null), known(5, r1Done ? 120 : null), r1Done ? 5 : null),
      game('r1-g2', 1, known(3, r1Done ? 99 : null), known(6, r1Done ? 130 : null), r1Done ? 6 : null),
    ],
    [
      game(
        'r2-g1',
        2,
        known(1, semiOneDone ? 140 : null),
        r1Done ? known(5, semiOneDone ? 110 : null) : waitingOn(4, 5),
        semiOneDone ? 1 : null,
      ),
      game(
        'r2-g2',
        2,
        known(2, semisDone ? 150 : null),
        r1Done ? known(6, semisDone ? 90 : null) : waitingOn(3, 6),
        semisDone ? 2 : null,
      ),
    ],
    [
      game(
        'r3-g1',
        3,
        semiOneDone ? known(1, finalDone ? 100 : null) : waitingOn(1, 4),
        semisDone ? known(2, finalDone ? 125 : null) : waitingOn(2, 3),
        finalDone ? 2 : null,
      ),
      game(
        'r3-third',
        3,
        semiOneDone ? known(5, finalDone ? 111 : null) : waitingOn(1, 4),
        semisDone ? known(6, finalDone ? 95 : null) : waitingOn(2, 3),
        finalDone ? 5 : null,
        3,
      ),
    ],
  ]

  const aliveSeeds = finalDone ? [2] : semisDone ? [1, 2] : semiOneDone ? [1, 2, 6] : r1Done ? [1, 2, 5, 6] : [1, 2, 3, 4, 5, 6]
  return {
    season: 2025,
    teams: managers.map((managerId, i) => ({
      managerId,
      seed: i + 1,
      wins: 9 - Math.floor(i / 2),
      losses: 5 + Math.floor(i / 2),
      ties: 0,
      pointsFor: 1900 - i * 20,
    })),
    byes: [id(1), id(2)],
    rounds,
    throughWeek: finalDone ? 17 : semisDone ? 16 : r1Done ? 15 : 14,
    currentRound: finalDone ? null : semisDone ? 3 : r1Done ? 2 : 1,
    alive: aliveSeeds.map(id),
    championManagerId: finalDone ? id(2) : null,
  }
}

/** Hand-made ratings, one per seed. */
function ratingsOf(perSeed: number[], managers: number[] = DEFAULT_MANAGERS): TeamRatings {
  return {
    leagueMean: 120,
    sigma: 25,
    teams: managers.map((managerId, i) => ({ managerId, games: 14, rating: perSeed[i], ratingSd: 25 / Math.sqrt(17) })),
  }
}
const level = ratingsOf([125, 124, 123, 122, 121, 120])
const flat = ratingsOf([120, 120, 120, 120, 120, 120])

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const titleOf = (odds: NonNullable<ReturnType<typeof bracketOdds>>, managerId: number) =>
  odds.title.find((t) => t.managerId === managerId)?.titlePct

describe('bracketOdds', () => {
  it('gives every team a title chance with round one pending, summing to one', () => {
    const odds = bracketOdds(bracketAt('round-one-pending'), level, 2025)!
    expect(odds.simulations).toBe(BRACKET_SIMULATIONS)
    expect(odds.simulations).toBe(10_000)
    expect(odds.title.map((t) => t.managerId)).toEqual([11, 12, 13, 14, 15, 16])
    expect(sum(odds.title.map((t) => t.titlePct))).toBeCloseTo(1, 10)
    for (const t of odds.title) expect(t.titlePct).toBeGreaterThan(0)
    // Two games have both sides known; the semis and the final are still waiting.
    expect(odds.games.map((g) => g.gameId)).toEqual(['r1-g1', 'r1-g2'])
    // Two in round one, two semis, the final. Not the third-place game.
    expect(odds.gamesRemaining).toBe(5)
  })

  it('leaves eliminated teams out entirely', () => {
    const odds = bracketOdds(bracketAt('semis-pending'), level, 2025)!
    expect(odds.title.map((t) => t.managerId)).toEqual([11, 12, 15, 16])
    expect(titleOf(odds, 13)).toBeUndefined()
    expect(titleOf(odds, 14)).toBeUndefined()
    expect(sum(odds.title.map((t) => t.titlePct))).toBeCloseTo(1, 10)
    expect(odds.games.map((g) => g.gameId)).toEqual(['r2-g1', 'r2-g2'])
    expect(odds.gamesRemaining).toBe(3)
  })

  it('has no pending-game entry for a semi-final that is already won', () => {
    const odds = bracketOdds(bracketAt('one-semi-played'), level, 2025)!
    // Seed 1 is through and waiting: its semi is played and its final has no opponent yet.
    expect(odds.games.map((g) => g.gameId)).toEqual(['r2-g2'])
    expect(odds.title.map((t) => t.managerId)).toEqual([11, 12, 16])
    expect(sum(odds.title.map((t) => t.titlePct))).toBeCloseTo(1, 10)
    expect(odds.gamesRemaining).toBe(2)
    // One game from the title against two for the others.
    expect(titleOf(odds, 11)!).toBeGreaterThan(titleOf(odds, 12)!)
  })

  it('prices the final and the third-place game once both are pending', () => {
    const odds = bracketOdds(bracketAt('final-pending'), level, 2025)!
    expect(odds.games.map((g) => g.gameId)).toEqual(['r3-g1', 'r3-third'])
    expect(odds.title.map((t) => t.managerId)).toEqual([11, 12])
    expect(odds.gamesRemaining).toBe(1)
    // With one game left, winning it and winning the title are the same event.
    expect(odds.games[0].aWinPct).toBe(titleOf(odds, 11))
    expect(titleOf(odds, 11)! + titleOf(odds, 12)!).toBeCloseTo(1, 10)
    for (const g of odds.games) {
      expect(g.aWinPct).toBeGreaterThan(0)
      expect(g.aWinPct).toBeLessThan(1)
    }
  })

  it('gives the same title odds whether or not the third-place game is pending', () => {
    const withThird = bracketAt('final-pending')
    const without = bracketAt('final-pending')
    without.rounds[2] = without.rounds[2].filter((g) => g.placement === null)
    const stillWaiting = bracketAt('final-pending')
    const third = stillWaiting.rounds[2].find((g) => g.placement === 3)!
    third.status = 'waiting'
    third.b = { managerId: null, seed: null, points: null, winnerOf: [2, 6] }

    const a = bracketOdds(withThird, level, 2025)!
    const b = bracketOdds(without, level, 2025)!
    const c = bracketOdds(stillWaiting, level, 2025)!
    expect(b.title).toEqual(a.title)
    expect(c.title).toEqual(a.title)
    expect(b.games).toEqual([a.games[0]])
    expect(c.games).toEqual([a.games[0]])
    expect(b.gamesRemaining).toBe(a.gamesRemaining)
  })

  it('agrees with itself exactly, and moves with the season and the week', () => {
    const bracket = bracketAt('semis-pending')
    const first = bracketOdds(bracket, level, 2025)!
    expect(bracketOdds(bracket, level, 2025)).toEqual(first)
    expect(bracketOdds(bracketAt('semis-pending'), level, 2025)).toEqual(first)
    expect(bracketOdds(bracket, level, 2026)).not.toEqual(first)
    expect(bracketOdds({ ...bracket, throughWeek: 16 }, level, 2025)).not.toEqual(first)
  })

  it('is null once the bracket is decided', () => {
    expect(bracketOdds(bracketAt('decided'), level, 2025)).toBeNull()
    // The final is on record but the champion has not been written yet.
    expect(bracketOdds({ ...bracketAt('decided'), championManagerId: null }, level, 2025)).toBeNull()
  })

  it('is null rather than a guess when a bracket team has no rating', () => {
    const missing: TeamRatings = { ...level, teams: level.teams.filter((t) => t.managerId !== 13) }
    expect(bracketOdds(bracketAt('round-one-pending'), missing, 2025)).toBeNull()
    // Even an eliminated team: it may still be in the third-place game.
    expect(bracketOdds(bracketAt('semis-pending'), missing, 2025)).toBeNull()
  })

  it('is null when a played game names no winner', () => {
    const bracket = bracketAt('semis-pending')
    bracket.rounds[0][0].winnerManagerId = null
    expect(bracketOdds(bracket, level, 2025)).toBeNull()
  })

  it('never lets formatOdds print a certainty while a game remains', () => {
    const lopsided = ratingsOf([400, 120, 120, 120, 120, 120])
    for (const stage of ['round-one-pending', 'semis-pending', 'one-semi-played', 'final-pending'] as const) {
      const odds = bracketOdds(bracketAt(stage), lopsided, 2025)!
      expect(odds.gamesRemaining).toBeGreaterThan(0)
      for (const t of odds.title) {
        expect(['100%', '0%']).not.toContain(formatOdds(t.titlePct, odds.gamesRemaining))
      }
    }
    const runaway = bracketOdds(bracketAt('final-pending'), lopsided, 2025)!
    expect(formatOdds(titleOf(runaway, 11)!, runaway.gamesRemaining)).toBe('>99%')
    expect(formatOdds(titleOf(runaway, 12)!, runaway.gamesRemaining)).toBe('<1%')
  })

  describe('the model', () => {
    it('is a coin flip between equal teams, and a bye is worth a round', () => {
      const final = bracketOdds(bracketAt('final-pending'), flat, 2025)!
      expect(final.games[0].aWinPct).toBeGreaterThan(0.47)
      expect(final.games[0].aWinPct).toBeLessThan(0.53)

      const start = bracketOdds(bracketAt('round-one-pending'), flat, 2025)!
      // A bye team needs two wins (1 in 4), a round-one team three (1 in 8).
      for (const id of [11, 12]) expect(titleOf(start, id)!).toBeCloseTo(0.25, 1)
      for (const id of [13, 14, 15, 16]) expect(titleOf(start, id)!).toBeCloseTo(0.125, 1)
    })

    it('favours the better-rated team', () => {
      const odds = bracketOdds(bracketAt('final-pending'), ratingsOf([150, 110, 120, 120, 120, 120]), 2025)!
      expect(odds.games[0].aWinPct).toBeGreaterThan(0.75)
    })

    it('fixes played games: a team that lost cannot come back through the bracket', () => {
      // Seed 4 would win everything on rating, but it lost in round one.
      const odds = bracketOdds(bracketAt('semis-pending'), ratingsOf([120, 120, 120, 400, 120, 120]), 2025)!
      expect(titleOf(odds, 14)).toBeUndefined()
      expect(sum(odds.title.map((t) => t.titlePct))).toBeCloseTo(1, 10)
    })
  })

  describe('waiting sides', () => {
    // Seed 2 is hopeless, so whoever comes out of 3 v 6 walks into the final, while the
    // 4 v 5 winner still has to beat a real seed 1. Seeds 3 and 6 must therefore be well
    // ahead of 4 and 5; feed the semis the wrong way round and it flips.
    const weakTwo = ratingsOf([120, 20, 120, 120, 120, 120])
    const expectThreeSixSide = (bracket: PlayoffBracket) => {
      const odds = bracketOdds(bracket, weakTwo, 2025)!
      for (const through of [13, 16]) {
        for (const blocked of [14, 15]) expect(titleOf(odds, through)!).toBeGreaterThan(titleOf(odds, blocked)! + 0.05)
      }
      expect(sum(odds.title.map((t) => t.titlePct))).toBeCloseTo(1, 10)
    }

    it('follows the seeds in winnerOf', () => {
      expectThreeSixSide(bracketAt('round-one-pending'))
    })

    it('follows winnerOf even when round one is listed in the other order', () => {
      const bracket = bracketAt('round-one-pending')
      bracket.rounds[0].reverse()
      expectThreeSixSide(bracket)
    })

    it('falls back to bracket position when winnerOf is missing', () => {
      const bracket = bracketAt('round-one-pending')
      for (const round of bracket.rounds) {
        for (const g of round) {
          for (const side of [g.a, g.b]) side.winnerOf = null
        }
      }
      expectThreeSixSide(bracket)
    })
  })
})

// ---------------------------------------------------------------------------
// teamRatings: the extraction from playoffOdds().
// ---------------------------------------------------------------------------

function roundRobin(weeks: number[]): ScheduledGame[] {
  const out: ScheduledGame[] = []
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  for (const w of weeks) {
    const r = (w - 1) % 9
    const rot = [ids[0], ...ids.slice(1).map((_, k) => ids[1 + ((k + r) % 9)])]
    for (let k = 0; k < 5; k++) {
      out.push({ week: w, managerId: rot[k], opponentManagerId: rot[9 - k] })
      out.push({ week: w, managerId: rot[9 - k], opponentManagerId: rot[k] })
    }
  }
  return out
}

const score = (id: number, w: number) => 100 + id * 6 + ((id * 7 + w * 13) % 11) - 5
const schedule = roundRobin([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
const playedThrough = (week: number): HistoryMatchup[] =>
  schedule
    .filter((g) => g.week <= week)
    .map((g) => {
      const mine = score(g.managerId, g.week)
      const theirs = score(g.opponentManagerId, g.week)
      return {
        season: 2026,
        week: g.week,
        managerId: g.managerId,
        points: mine,
        opponentManagerId: g.opponentManagerId,
        opponentPoints: theirs,
        isPlayoff: false,
        playoffRound: null,
        playoffPlacement: null,
        result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
      }
    })

describe('teamRatings', () => {
  it('is null with nothing played', () => {
    expect(teamRatings([])).toBeNull()
  })

  it('takes the games and nothing else: no generator, no seed', () => {
    expect(teamRatings.length).toBe(1)
    const played = playedThrough(8)
    expect(teamRatings(played)).toEqual(teamRatings(played))
  })

  it('is the rating playoffOdds() prints, before rounding', () => {
    const played = playedThrough(8)
    const ratings = teamRatings(played)!
    const odds = playoffOdds({ season: 2026, played, schedule, regularSeasonWeeks: 14, playoffTeams: 6, simulations: 200 })!
    expect(ratings.teams.map((t) => t.managerId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    for (const t of ratings.teams) {
      expect(odds.rows.find((r) => r.managerId === t.managerId)!.rating).toBe(Number(t.rating.toFixed(1)))
    }
  })

  it('shrinks toward the league mean and gets surer with more weeks', () => {
    const early = teamRatings(playedThrough(3))!
    const late = teamRatings(playedThrough(14))!
    const best = (r: TeamRatings) => r.teams.find((t) => t.managerId === 10)!
    const mean = (week: number) => {
      const xs = playedThrough(week).filter((m) => m.managerId === 10).map((m) => m.points)
      return sum(xs) / xs.length
    }
    for (const [ratings, week] of [[early, 3], [late, 14]] as const) {
      expect(best(ratings).games).toBe(week)
      expect(best(ratings).rating).toBeLessThan(mean(week))
      expect(best(ratings).rating).toBeGreaterThan(ratings.leagueMean)
      expect(best(ratings).ratingSd).toBe(ratings.sigma / Math.sqrt(week + PRIOR_WEEKS))
      expect(ratings.sigma).toBeGreaterThanOrEqual(15)
    }
    expect(best(late).ratingSd).toBeLessThan(best(early).ratingSd)
  })

  it('feeds bracketOdds directly', () => {
    const ratings = teamRatings(playedThrough(14))!
    // Team id is quality in this league, so the seeds run 10 down to 5.
    const managers = [10, 9, 8, 7, 6, 5]
    const odds = bracketOdds(bracketAt('round-one-pending', managers), ratings, 2026)!
    expect(odds.title.map((t) => t.managerId)).toEqual(managers)
    expect(sum(odds.title.map((t) => t.titlePct))).toBeCloseTo(1, 10)
    expect(titleOf(odds, 10)!).toBeGreaterThan(titleOf(odds, 5)!)
  })
})
