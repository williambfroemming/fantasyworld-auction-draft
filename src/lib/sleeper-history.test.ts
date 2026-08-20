import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  combinePoints,
  hasBeenPlayed,
  optimalLineup,
  pairWeek,
  playerWeeks,
  playoffRound,
  podiumFromBracket,
  slotEligibility,
  standings,
  startingSlots,
  weekLineups,
  type PlayerMap,
  type RawMatchup,
  type RawRoster,
} from './sleeper-history'

describe('combinePoints', () => {
  it('reassembles Sleeper two-integer points', () => {
    expect(combinePoints(1959, 72)).toBe(1959.72)
    expect(combinePoints(1820, 18)).toBe(1820.18)
  })

  it('treats a missing decimal as zero, not as a missing score', () => {
    expect(combinePoints(120, undefined)).toBe(120)
  })

  it('does not truncate — the bug this function exists to prevent', () => {
    // Reading `fpts` alone gives 1959, which looks like rounding and is wrong by
    // most of a point in every season total.
    expect(combinePoints(1959, 72)).not.toBe(1959)
  })
})

describe('startingSlots', () => {
  it('drops bench and reserve slots', () => {
    const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'BN', 'BN', 'IR']
    expect(startingSlots(positions)).toEqual([
      'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DEF',
    ])
  })

  it('reflects this league changing shape in 2022', () => {
    const before = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'BN']
    const after = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'DEF', 'BN']
    expect(startingSlots(before)).toHaveLength(9)
    expect(startingSlots(after)).toHaveLength(10)
    expect(startingSlots(after)).toContain('SUPER_FLEX')
  })
})

describe('slotEligibility', () => {
  it('makes a QB flex-eligible only in SUPER_FLEX', () => {
    expect(slotEligibility('FLEX').has('QB')).toBe(false)
    expect(slotEligibility('SUPER_FLEX').has('QB')).toBe(true)
  })

  it('treats a strict position as a singleton', () => {
    expect([...slotEligibility('TE')]).toEqual(['TE'])
    expect([...slotEligibility('DEF')]).toEqual(['DEF'])
  })
})

describe('optimalLineup', () => {
  const p = (playerId: string, position: string, points: number) => ({ playerId, position, points })

  it('fills strict slots before flex ones', () => {
    const slots = ['RB', 'FLEX']
    const best = optimalLineup(slots, [p('rb1', 'RB', 20), p('rb2', 'RB', 18), p('wr1', 'WR', 19)])
    expect(best.total).toBe(39)
  })

  it('never uses one player twice', () => {
    const best = optimalLineup(['FLEX', 'FLEX'], [p('wr1', 'WR', 25)])
    expect(best.total).toBe(25)
    expect(best.assignment.filter(Boolean)).toHaveLength(1)
  })

  it('puts the second quarterback in SUPER_FLEX', () => {
    // The superflex case: leaving a 25-point QB on the bench because FLEX would
    // not take him under-reports the optimum for every season from 2022.
    const slots = ['QB', 'SUPER_FLEX']
    const best = optimalLineup(slots, [p('qb1', 'QB', 30), p('qb2', 'QB', 25), p('rb1', 'RB', 20)])
    expect(best.total).toBe(55)
  })

  it('does NOT put a quarterback in a plain FLEX', () => {
    const slots = ['QB', 'FLEX']
    const best = optimalLineup(slots, [p('qb1', 'QB', 30), p('qb2', 'QB', 25), p('rb1', 'RB', 20)])
    expect(best.total).toBe(50)
  })

  it('leaves a slot empty rather than filling it with an ineligible player', () => {
    const best = optimalLineup(['DEF'], [p('wr1', 'WR', 40)])
    expect(best.total).toBe(0)
    expect(best.assignment[0]).toBeNull()
  })

  it('records which slot each player filled, in slot order', () => {
    const best = optimalLineup(['QB', 'RB'], [p('qb1', 'QB', 10), p('rb1', 'RB', 5)])
    expect(best.assignment[0]).toMatchObject({ slot: 'QB', playerId: 'qb1' })
    expect(best.assignment[1]).toMatchObject({ slot: 'RB', playerId: 'rb1' })
  })

  it('is at least as good as the lineup actually started', () => {
    const slots = ['QB', 'RB', 'FLEX']
    const roster = [p('qb1', 'QB', 12), p('rb1', 'RB', 8), p('wr1', 'WR', 22), p('rb2', 'RB', 3)]
    expect(optimalLineup(slots, roster).total).toBeGreaterThanOrEqual(12 + 3 + 8)
  })
})

describe('pairWeek', () => {
  const entry = (roster_id: number, matchup_id: number | null, points: number): RawMatchup => ({
    roster_id,
    matchup_id,
    points,
    starters: [],
    players: [],
    players_points: {},
  })

  it('emits two rows per game, one from each side', () => {
    const sides = pairWeek(3, [entry(1, 7, 120.5), entry(2, 7, 99.25)])
    expect(sides).toHaveLength(2)
    expect(sides[0]).toMatchObject({ rosterId: 1, points: 120.5, opponentPoints: 99.25, result: 'W' })
    expect(sides[1]).toMatchObject({ rosterId: 2, points: 99.25, opponentPoints: 120.5, result: 'L' })
  })

  it('records a tie as a tie on both sides', () => {
    const sides = pairWeek(1, [entry(1, 1, 100), entry(2, 1, 100)])
    expect(sides.map((s) => s.result)).toEqual(['T', 'T'])
  })

  it('drops an entry with no matchup rather than inventing an opponent', () => {
    expect(pairWeek(1, [entry(1, null, 100)])).toEqual([])
  })

  it('drops a matchup that does not have exactly two sides', () => {
    // Guessing what a three-sided "game" meant would put a fabricated result in
    // the league's permanent record.
    expect(pairWeek(1, [entry(1, 1, 100), entry(2, 1, 90), entry(3, 1, 80)])).toEqual([])
  })
})

describe('playerWeeks', () => {
  const players: PlayerMap = {
    qb1: ['Josh Allen', 'QB', 'BUF'],
    rb1: ['Bijan Robinson', 'RB', 'ATL'],
    bench1: ['Somebody Else', 'WR', 'SF'],
  }
  const entry: RawMatchup = {
    roster_id: 4,
    matchup_id: 1,
    points: 30,
    starters: ['qb1', '0', 'rb1'],
    players: ['qb1', 'rb1', 'bench1'],
    players_points: { qb1: 20, rb1: 10, bench1: 40 },
  }

  it('records the slot each starter filled, positionally', () => {
    const rows = playerWeeks(5, [entry], ['QB', 'WR', 'RB'], players)
    expect(rows.find((r) => r.playerId === 'qb1')).toMatchObject({ slot: 'QB', isStarter: true })
    expect(rows.find((r) => r.playerId === 'rb1')).toMatchObject({ slot: 'RB', isStarter: true })
  })

  it('keeps bench players, with no slot', () => {
    const rows = playerWeeks(5, [entry], ['QB', 'WR', 'RB'], players)
    expect(rows.find((r) => r.playerId === 'bench1')).toMatchObject({
      isStarter: false,
      slot: null,
      points: 40,
    })
  })

  it("does not treat '0' as a player", () => {
    const rows = playerWeeks(5, [entry], ['QB', 'WR', 'RB'], players)
    expect(rows.map((r) => r.playerId)).not.toContain('0')
    expect(rows).toHaveLength(3)
  })
})

describe('podiumFromBracket', () => {
  it('reads the final and the third-place game', () => {
    const bracket = [
      { r: 1, m: 1, t1: 10, t2: 6, w: 10, l: 6 },
      { r: 3, m: 6, t1: 10, t2: 9, w: 9, l: 10, p: 1 },
      { r: 3, m: 7, t1: 1, t2: 5, w: 1, l: 5, p: 3 },
      { r: 2, m: 5, t1: 6, t2: 4, w: 4, l: 6, p: 5 },
    ]
    expect(podiumFromBracket(bracket)).toEqual({
      championRosterId: 9,
      runnerUpRosterId: 10,
      thirdRosterId: 1,
    })
  })

  it('returns nulls rather than guessing when there is no placement game', () => {
    expect(podiumFromBracket([{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 }])).toEqual({
      championRosterId: null,
      runnerUpRosterId: null,
      thirdRosterId: null,
    })
  })
})

describe('standings', () => {
  const roster = (roster_id: number, wins: number, fpts: number): RawRoster => ({
    roster_id,
    owner_id: `owner-${roster_id}`,
    co_owners: null,
    settings: { wins, losses: 14 - wins, ties: 0, fpts, fpts_decimal: 50 },
  })

  it('ranks by record, then by points for', () => {
    const rows = standings([roster(1, 8, 1500), roster(2, 10, 1400), roster(3, 8, 1600)])
    expect(rows.map((r) => r.rosterId)).toEqual([2, 3, 1])
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3])
  })

  it('carries the decimal into points for', () => {
    expect(standings([roster(1, 8, 1500)])[0].pointsFor).toBe(1500.5)
  })
})

describe('playoffRound', () => {
  it('counts from the first playoff week', () => {
    expect(playoffRound(15, 15)).toBe(1)
    expect(playoffRound(17, 15)).toBe(3)
    // 2020 started its playoffs a week earlier than every later season.
    expect(playoffRound(14, 14)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Against the real committed seasons.
//
// Two different claims are checked here, and the distinction matters.
//
// **Actual points must reconcile exactly.** Sleeper publishes each roster's
// season total (`fpts`), so summing our per-week starter points against it
// proves the whole pipeline — points parsing, the two-integer decimal, slot
// order, and which players were starters. This is an equality, and it holds for
// all sixty manager-seasons.
//
// **The optimum is a recomputation, and is only cross-checked.** Sleeper's
// `ppts` was computed at the time, against per-week roster state — chiefly which
// players sat in an IR slot and so could not be started — that the archived
// matchup payloads no longer expose. Our figure agrees exactly for 46 of 60
// manager-seasons and for every roster in 2022 and 2025; the residuals are small
// and go in **both** directions, which rules out our eligibility rules being
// systematically too generous.
//
// ⚠️ Do not "fix" lineup efficiency by forcing it to match `ppts`. Ours is the
// reproducible number: it is computed the same way for every season including
// the ones Sleeper has no `ppts` for, and it is the only one that can be
// recomputed from the committed data.
// ---------------------------------------------------------------------------

const DATA = join(process.cwd(), 'data', 'sleeper')
const hasData = existsSync(join(DATA, 'players-min.json'))

/** Season totals of actual and optimal points, per roster. */
function seasonTotals(season: number, players: PlayerMap) {
  const dir = join(DATA, String(season))
  const league = JSON.parse(readFileSync(join(dir, 'league.json'), 'utf8'))
  const slots = startingSlots(league.roster_positions)
  const actual = new Map<number, number>()
  const optimal = new Map<number, number>()
  const weekPoints = new Map<number, number>()

  // `fpts` and `ppts` both cover the regular season only.
  for (let week = 1; week < league.settings.playoff_week_start; week++) {
    const file = join(dir, `matchups-${String(week).padStart(2, '0')}.json`)
    if (!existsSync(file)) continue
    const entries = JSON.parse(readFileSync(file, 'utf8')) as RawMatchup[]
    for (const e of entries) {
      weekPoints.set(e.roster_id, (weekPoints.get(e.roster_id) ?? 0) + e.points)
    }
    for (const l of weekLineups(entries, slots, players)) {
      actual.set(l.rosterId, (actual.get(l.rosterId) ?? 0) + l.actual)
      optimal.set(l.rosterId, (optimal.get(l.rosterId) ?? 0) + l.optimal)
    }
  }
  const rosters = JSON.parse(readFileSync(join(dir, 'rosters.json'), 'utf8')) as RawRoster[]
  return { rosters, actual, optimal, weekPoints }
}

describe.runIf(hasData)('against the real committed seasons', () => {
  const players = JSON.parse(readFileSync(join(DATA, 'players-min.json'), 'utf8')) as PlayerMap
  const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025]

  for (const season of SEASONS) {
    it(`${season}: starter points reproduce the weekly team totals exactly`, () => {
      // The real proof that parsing is right: Sleeper reports a team total per
      // week, and summing the points of the players we identified as starters
      // must reproduce it to the cent. Holds for all sixty manager-seasons.
      const { weekPoints, actual } = seasonTotals(season, players)
      for (const [rosterId, total] of weekPoints) {
        expect(Number((actual.get(rosterId) ?? 0).toFixed(2)), `roster ${rosterId}`).toBeCloseTo(
          Number(total.toFixed(2)),
          2,
        )
      }
    })

    it(`${season}: the weekly totals are within Sleeper's own drift of its season total`, () => {
      // ⚠️ Sleeper disagrees with itself. A roster's stored `fpts` is not always
      // the sum of that roster's weekly results: in 2020 and 2021 five and three
      // rosters respectively drift by 0.5 to 3.0 points. 2022 onward is exact.
      //
      // This is the origin of the discrepancy between the history workbook's two
      // standings sheets — one was built from weekly matchups and the other from
      // roster totals, so it inherited Sleeper's drift rather than introducing it.
      //
      // We use the sum of the weekly results, because a season total that does
      // not equal the games it is made of cannot be reconciled on screen, and
      // every derived metric (all-play, records, head-to-head) is computed from
      // those same rows.
      const { rosters, weekPoints } = seasonTotals(season, players)
      for (const r of rosters) {
        const fpts = combinePoints(r.settings.fpts, r.settings.fpts_decimal)
        const summed = weekPoints.get(r.roster_id) ?? 0
        expect(Math.abs(summed - fpts), `roster ${r.roster_id}: ${summed} vs ${fpts}`).toBeLessThan(3.5)
      }
    })

    it(`${season}: the optimum is never worse than what was actually started`, () => {
      // The one hard invariant. A "best possible" lineup that scores less than
      // the lineup somebody really used is nonsense, and would make lineup
      // efficiency read over 100%.
      const { rosters, actual, optimal } = seasonTotals(season, players)
      for (const r of rosters) {
        expect(optimal.get(r.roster_id) ?? 0, `roster ${r.roster_id}`).toBeGreaterThanOrEqual(
          (actual.get(r.roster_id) ?? 0) - 0.01,
        )
      }
    })
  }

  it('agrees with Sleeper’s ppts on the large majority of manager-seasons', () => {
    let exact = 0
    let total = 0
    let worst = 0
    for (const season of SEASONS) {
      const { rosters, optimal } = seasonTotals(season, players)
      for (const r of rosters) {
        total++
        const ppts = combinePoints(r.settings.ppts, r.settings.ppts_decimal)
        const diff = Math.abs((optimal.get(r.roster_id) ?? 0) - ppts)
        if (diff < 0.01) exact++
        worst = Math.max(worst, diff / Math.max(ppts, 1))
      }
    }
    expect(exact, `${exact}/${total} exact`).toBeGreaterThanOrEqual(40)
    // The largest residual seen is ~1.9% of a season total.
    expect(worst).toBeLessThan(0.03)
  })
})

describe('hasBeenPlayed', () => {
  const entry = (points: number): RawMatchup => ({
    roster_id: 1,
    matchup_id: 1,
    points,
    starters: ['a'],
    players: ['a'],
    players_points: { a: points },
  })

  it('is false for a scheduled week nobody has played', () => {
    // Sleeper returns the whole schedule from day one: a league in week 1 still
    // answers with fourteen weeks of 0-0 matchups, lineups already set.
    expect(hasBeenPlayed([entry(0), entry(0), entry(0)])).toBe(false)
  })

  it('is true once anybody has scored', () => {
    expect(hasBeenPlayed([entry(0), entry(84.2)])).toBe(true)
  })

  it('is false for an empty week', () => {
    expect(hasBeenPlayed([])).toBe(false)
  })
})
