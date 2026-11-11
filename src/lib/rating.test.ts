import { describe, expect, it } from 'vitest'
import type { HistoryMatchup } from './history'
import { expectedScore, peakAndLow, ratingHistory, START_RATING, weekAxis } from './rating'

/** One game, stored once per side as the database does. */
function game(
  season: number,
  week: number,
  a: number,
  b: number,
  pa: number,
  pb: number,
  over: Partial<HistoryMatchup> = {},
): HistoryMatchup[] {
  const res = (x: number, y: number) => (x > y ? 'W' : x < y ? 'L' : 'T')
  const base = {
    season,
    week,
    isPlayoff: false,
    playoffRound: null,
    playoffPlacement: null,
    ...over,
  }
  return [
    {
      ...base,
      managerId: a,
      points: pa,
      opponentManagerId: b,
      opponentPoints: pb,
      result: res(pa, pb),
    },
    {
      ...base,
      managerId: b,
      points: pb,
      opponentManagerId: a,
      opponentPoints: pa,
      result: res(pb, pa),
    },
  ]
}

const last = (h: ReturnType<typeof ratingHistory>, id: number) =>
  h.find((m) => m.managerId === id)!.points.at(-1)!

describe('ratingHistory', () => {
  const games = [
    ...game(2021, 1, 1, 2, 120, 100),
    ...game(2021, 1, 3, 4, 90, 95),
    ...game(2021, 2, 1, 3, 110, 80),
    ...game(2021, 2, 2, 4, 70, 130),
    ...game(2021, 3, 1, 4, 100, 99),
    ...game(2021, 3, 2, 3, 85, 85),
  ]

  it('is zero-sum: the league total never moves', () => {
    const h = ratingHistory(games)
    const total = h.reduce((s, m) => s + m.points.at(-1)!.rating, 0)
    expect(total).toBeCloseTo(START_RATING * 4, 9)
  })

  it('is zero-sum within every game', () => {
    const h = ratingHistory(games)
    for (const m of h)
      for (const p of m.points) {
        const other = h.find((x) => x.managerId === p.opponentManagerId)!
        const q = other.points.find((r) => r.season === p.season && r.week === p.week)!
        expect(p.change + q.change).toBeCloseTo(0, 9)
      }
  })

  it('a win never lowers a rating, and a loss never raises one', () => {
    for (const m of ratingHistory(games))
      for (const p of m.points) {
        if (p.result === 'W') expect(p.change).toBeGreaterThan(0)
        if (p.result === 'L') expect(p.change).toBeLessThan(0)
      }
  })

  it('processes each game once, not once per side', () => {
    const h = ratingHistory(game(2021, 1, 1, 2, 120, 100))
    expect(h.map((m) => m.points.length)).toEqual([1, 1])
  })

  it('a bigger margin moves a rating more', () => {
    const small = ratingHistory([
      ...game(2021, 1, 1, 2, 101, 100),
      ...game(2021, 1, 3, 4, 150, 100),
    ])
    const a = last(small, 1).change
    const c = last(small, 3).change
    expect(c).toBeGreaterThan(a)
  })

  it('a win over a stronger team moves you more than a win over a weaker one', () => {
    expect(expectedScore(1400, 1600)).toBeLessThan(expectedScore(1600, 1400))
    const h = ratingHistory([
      ...game(2021, 1, 1, 2, 130, 90), // 1 becomes strong, 2 weak
      ...game(2021, 2, 3, 1, 100, 90), // 3 beats the strong team
      ...game(2021, 2, 4, 2, 100, 90), // 4 beats the weak team, same margin
    ])
    expect(last(h, 3).change).toBeGreaterThan(last(h, 4).change)
  })

  it('moves every rating one third of the way back to 1500 between seasons', () => {
    const h2 = ratingHistory([...game(2021, 1, 1, 2, 130, 90), ...game(2022, 1, 1, 2, 100, 100)])
    const end2021 = h2.find((m) => m.managerId === 1)!.points[0].rating
    const start2022 = h2.find((m) => m.managerId === 1)!.points[1]
    // A tie between the same pair: the rating after = regressed start + a small tie change.
    const regressed = START_RATING + (end2021 - START_RATING) * (2 / 3)
    expect(start2022.rating - start2022.change).toBeCloseTo(regressed, 9)
  })

  it('does not regress within a season', () => {
    const h = ratingHistory([...game(2021, 1, 1, 2, 130, 90), ...game(2021, 2, 1, 2, 130, 90)])
    const [p1, p2] = h.find((m) => m.managerId === 1)!.points
    expect(p2.rating - p2.change).toBeCloseTo(p1.rating, 9)
  })

  it('is identical on repeated runs, whatever order the rows arrive in', () => {
    const a = ratingHistory(games)
    const b = ratingHistory([...games].reverse())
    expect(b).toEqual(a)
    expect(ratingHistory(games)).toEqual(a)
  })

  it('leaves out the fifth-place game but keeps a championship-path playoff game', () => {
    const h = ratingHistory([
      ...game(2021, 1, 1, 2, 100, 90),
      ...game(2021, 15, 1, 2, 110, 90, { isPlayoff: true, playoffRound: 1 }),
      ...game(2021, 16, 1, 2, 120, 90, { isPlayoff: true, playoffRound: 2, playoffPlacement: 5 }),
    ])
    expect(h.find((m) => m.managerId === 1)!.points.map((p) => p.week)).toEqual([1, 15])
  })

  it('gives a manager with no game in a week no point that week', () => {
    const h = ratingHistory([...game(2021, 1, 1, 2, 100, 90), ...game(2021, 2, 3, 4, 100, 90)])
    expect(h.find((m) => m.managerId === 1)!.points.map((p) => p.week)).toEqual([1])
  })

  it('returns nothing for no games', () => {
    expect(ratingHistory([])).toEqual([])
  })
})

describe('peakAndLow and weekAxis', () => {
  const h = ratingHistory([
    ...game(2021, 1, 1, 2, 130, 90),
    ...game(2021, 2, 1, 2, 80, 120),
    ...game(2022, 1, 1, 2, 90, 100),
  ])
  it('finds the highest and lowest rating and when', () => {
    const { peak, low } = peakAndLow(h.find((m) => m.managerId === 1)!.points)!
    expect(peak).toMatchObject({ season: 2021, week: 1 })
    expect(low.rating).toBeLessThan(peak.rating)
    expect(peakAndLow([])).toBeNull()
  })
  it('lays games on one evenly spaced axis with season starts marked', () => {
    const axis = weekAxis(h)
    expect(axis.index.get('2021:1')).toBe(1)
    expect(axis.index.get('2022:1')).toBe(3)
    expect(axis.seasonStarts).toEqual([
      { season: 2021, x: 1 },
      { season: 2022, x: 3 },
    ])
    expect(axis.labels[3]).toBe('2022 wk 1')
  })
})
