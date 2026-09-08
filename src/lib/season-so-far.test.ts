import { describe, expect, it } from 'vitest'
import { median, seasonSoFar } from './season-so-far'
import type { HistoryLineup, HistoryMatchup, HistorySeason } from './history'

const season = (s: number, over: Partial<HistorySeason> = {}): HistorySeason => ({
  season: s,
  dataTier: 'weekly',
  regularSeasonWeeks: 14,
  championManagerId: null,
  runnerUpManagerId: null,
  thirdManagerId: null,
  championPrize: null,
  runnerUpPrize: null,
  thirdPrize: null,
  buyIn: null,
  draftCity: null,
  draftState: null,
  ...over,
})

/**
 * One week of four managers: 1v2 and 3v4, scores given in manager-id order.
 * Four is the smallest field where a median is the average of two middle
 * scores rather than just the middle one.
 */
function week(s: number, w: number, points: number[], isPlayoff = false): HistoryMatchup[] {
  const pairs: Array<[number, number]> = [
    [1, 2],
    [3, 4],
  ]
  const out: HistoryMatchup[] = []
  for (const [a, b] of pairs) {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const mine = points[self - 1]
      const theirs = points[other - 1]
      out.push({
        season: s,
        week: w,
        managerId: self,
        points: mine,
        opponentManagerId: other,
        opponentPoints: theirs,
        isPlayoff,
        playoffRound: null,
        playoffPlacement: null,
        result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
      })
    }
  }
  return out
}

/**
 * Two weeks built to contain the argument the page exists to make.
 *
 * ⚠️ A **symmetric** fixture is worthless here and was the first thing written:
 * mirror week two and every manager finishes on a .500 all-play, so a test that
 * all-play and the record disagree passes vacuously against any implementation.
 * The scores below are deliberately lopsided.
 *
 *   M1  2-0, all-play 1.000  — good and lucky, the uninteresting case
 *   M2  0-2, all-play  .667  — the second-best team in the league, winless
 *   M3  0-2, all-play  .000  — simply bad
 *   M4  2-0, all-play  .333  — third-worst team in the league, unbeaten
 *
 * M2 and M4 are the pair everything is checked against: their records are
 * exactly backwards from how they have played.
 */
function input(over: Partial<Parameters<typeof seasonSoFar>[0]> = {}) {
  return {
    season: 2026,
    matchups: [...week(2026, 1, [150, 140, 40, 50]), ...week(2026, 2, [145, 135, 30, 40])],
    lineups: [] as HistoryLineup[],
    seasons: [season(2026)],
    sideBet: null as number | null,
    ...over,
  }
}

describe('median', () => {
  it('averages the middle two on an even field', () => {
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('takes the middle one on an odd field', () => {
    expect(median([10, 30, 20])).toBe(20)
  })
})

describe('seasonSoFar', () => {
  it('returns null before a week has been completed', () => {
    // The normal state for most of the year, and not an error.
    expect(seasonSoFar(input({ matchups: [] }))).toBeNull()
  })

  it('reports the week it is speaking as of', () => {
    // Structural rather than cosmetic: no caller can render these rates without
    // the qualifier that makes them honest.
    const r = seasonSoFar(input())!
    expect(r.throughWeek).toBe(2)
    expect(r.weeksPlayed).toBe(2)
  })

  it('counts the record from the games, not from a standings table', () => {
    const r = seasonSoFar(input())!
    const m2 = r.rows.find((x) => x.managerId === 2)!
    expect([m2.wins, m2.losses]).toEqual([0, 2])
    expect(m2.pointsFor).toBe(275)
  })

  it('scores a week against the league median', () => {
    // Week 1 is 150/140/40/50, so the median is 95 and the top two clear it.
    // M4 is the case worth pinning: 2-0 against his schedule and 0-2 against
    // the field, which no standings table anywhere will tell him.
    const r = seasonSoFar(input())!
    const m2 = r.rows.find((x) => x.managerId === 2)!
    const m4 = r.rows.find((x) => x.managerId === 4)!
    expect([m2.medianWins, m2.medianLosses]).toEqual([2, 0])
    expect([m4.medianWins, m4.medianLosses]).toEqual([0, 2])
  })

  it('separates how well a team played from what its record says', () => {
    // M2 is 0-2 and the second-best team in the league; M4 is 2-0 and the
    // third-worst. The records are exactly backwards from the performances,
    // which is the argument the page exists to make.
    const r = seasonSoFar(input())!
    const m2 = r.rows.find((x) => x.managerId === 2)!
    const m4 = r.rows.find((x) => x.managerId === 4)!
    expect(m2.wins).toBeLessThan(m4.wins)
    expect(m2.allPlayPct).toBeGreaterThan(m4.allPlayPct)
    // And the page is ordered by the honest measure, so M2 is drawn above M4.
    expect(r.rows.findIndex((x) => x.managerId === 2))
      .toBeLessThan(r.rows.findIndex((x) => x.managerId === 4))
  })

  it('reports luck as actual wins minus all-play expectation', () => {
    const r = seasonSoFar(input())!
    for (const row of r.rows) {
      expect(row.luck).toBeCloseTo(row.wins - row.expectedWins, 2)
    }
  })

  it('does not round expected wins into whole games', () => {
    // A rounded expectation makes `luck` land on tidy integers that read as a
    // count of games somebody was robbed of -- a stronger claim than an
    // all-play rate can support.
    const r = seasonSoFar(input())!
    expect(r.rows.some((row) => !Number.isInteger(row.expectedWins))).toBe(true)
  })

  it('measures strength of schedule as the mean opponent score', () => {
    // M2 faced 150 then 145 -- the hardest schedule in the league, and the
    // other half of the explanation for an 0-2.
    const r = seasonSoFar(input())!
    expect(r.rows.find((x) => x.managerId === 2)!.strengthOfSchedule).toBe(147.5)
  })

  it('skips a week the whole field did not play, and counts it', () => {
    // The rule allPlay established: "beat 5 opponents" and "beat 9" are not the
    // same unit, and a median over half a field is not the league median.
    const partial = week(2026, 3, [120, 110, 0, 0]).filter((m) => m.managerId <= 2)
    const r = seasonSoFar(input({ matchups: [...input().matchups, ...partial] }))!
    expect(r.incompleteWeeks).toBe(1)
    expect(r.weeksPlayed).toBe(2)
    expect(r.throughWeek).toBe(2)
  })

  it('ignores playoff weeks', () => {
    const r = seasonSoFar(
      input({ matchups: [...input().matchups, ...week(2026, 15, [200, 10, 20, 30], true)] }),
    )!
    expect(r.throughWeek).toBe(2)
    expect(r.rows.find((x) => x.managerId === 1)!.pointsFor).toBe(295)
  })

  it('ignores other seasons entirely', () => {
    const r = seasonSoFar(input({ matchups: [...input().matchups, ...week(2025, 9, [300, 1, 2, 3])] }))!
    expect(r.rows.find((x) => x.managerId === 1)!.pointsFor).toBe(295)
  })

  it('reports efficiency and points left when lineups are on record', () => {
    const lineups: HistoryLineup[] = [
      { season: 2026, week: 1, managerId: 1, actual: 150, optimal: 200 },
      { season: 2026, week: 2, managerId: 1, actual: 40, optimal: 50 },
    ]
    const r = seasonSoFar(input({ lineups }))!
    const m1 = r.rows.find((x) => x.managerId === 1)!
    expect(m1.efficiency).toBeCloseTo(190 / 250, 4)
    expect(m1.pointsLeft).toBe(60)
  })

  it('leaves efficiency NULL when no lineup is on record, never 1.0', () => {
    // A season with no lineup data has not been proven perfectly managed; it is
    // unmeasured. Same rule as a null injury status meaning unknown, not fit.
    const r = seasonSoFar(input())!
    expect(r.rows.every((row) => row.efficiency === null)).toBe(true)
    expect(r.rows.every((row) => row.pointsLeft === null)).toBe(true)
  })

  it('carries the side bet through, and null stays null', () => {
    // Null is unknown, never "no bet" -- printing $0 would invent a fact about
    // money for the years the league's stake is simply not on record.
    expect(seasonSoFar(input())!.sideBet).toBeNull()
    expect(seasonSoFar(input({ sideBet: 10 }))!.sideBet).toBe(10)
  })

  it('counts high and low scoring weeks', () => {
    const r = seasonSoFar(input())!
    const m1 = r.rows.find((x) => x.managerId === 1)!
    const m3 = r.rows.find((x) => x.managerId === 3)!
    expect(m1.highWeeks).toBe(2)
    expect(m1.lowWeeks).toBe(0)
    expect(m3.highWeeks).toBe(0)
    expect(m3.lowWeeks).toBe(2)
  })
})
