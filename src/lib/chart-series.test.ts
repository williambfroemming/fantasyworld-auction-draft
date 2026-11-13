import { describe, expect, it } from 'vitest'
import {
  auctionSpendByPosition,
  cumulativePoints,
  cumulativePointsVsAverage,
  cumulativeWins,
  finishBySeason,
  restrictToSeasons,
  titlesAndMoney,
} from './chart-series'
import { leagueSummary, type HistoryInput, type HistoryStanding } from './history'

const members = [1, 2, 3].map((id) => ({
  managerId: id,
  name: `m${id}`,
  displayName: `M${id}`,
  color: '#fff',
}))

const season = (s: number, over: Partial<HistoryInput['seasons'][number]> = {}) => ({
  season: s,
  dataTier: 'standings' as const,
  regularSeasonWeeks: 13,
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

const st = (
  s: number,
  managerId: number,
  wins: number,
  place: number | null,
  pointsFor: number | null = wins * 100,
): HistoryStanding => ({
  season: s,
  managerId,
  place,
  wins,
  losses: 13 - wins,
  ties: 0,
  pointsFor,
  pointsAgainst: 1000,
  madePlayoffs: false,
  playoffWins: null,
  playoffLosses: null,
})

/**
 * Manager 1: every season. Manager 2: skips 2012. Manager 3: joins in 2013.
 */
const input: HistoryInput = {
  members,
  seasons: [
    season(2011, { championManagerId: 1, championPrize: 500, buyIn: 100 }),
    season(2012, { championManagerId: 2, championPrize: 600, buyIn: 100 }),
    season(2013, { championManagerId: 3, championPrize: null }),
  ],
  standings: [
    st(2011, 1, 9, 1),
    st(2011, 2, 7, 2),
    st(2012, 1, 8, 2),
    st(2013, 1, 5, 3),
    st(2013, 2, 6, 2),
    st(2013, 3, 10, 1),
  ],
  matchups: [],
  lineups: [],
}

const ys = (s: { points: Array<{ y: number | null }> }) => s.points.map((p) => p.y)
const by = <T extends { managerId: number }>(r: { series: T[] }, id: number): T =>
  r.series.find((s) => s.managerId === id)!

describe('cumulativeWins', () => {
  const r = cumulativeWins(input)

  it('runs a total across every season with a standings row', () => {
    expect(r.seasons).toEqual([2011, 2012, 2013])
    expect(ys(by(r, 1))).toEqual([9, 17, 22])
  })

  it('carries a manager forward flat through a season they have no row for', () => {
    expect(ys(by(r, 2))).toEqual([7, 7, 13]) // no 2012 row: stays 7, then +6
  })

  it('is null, not zero, before a manager joined', () => {
    expect(ys(by(r, 3))).toEqual([null, null, 10])
  })

  it('ends on exactly the wins leagueSummary reports, for every manager', () => {
    const summary = leagueSummary(input)
    for (const row of summary.rows) {
      const s = r.series.find((x) => x.managerId === row.member.managerId)
      const last = s?.points[s.points.length - 1].y
      expect(last, row.member.displayName).toBe(row.allTime.wins)
    }
  })

  it('omits a manager with no standings at all rather than drawing a line of nulls', () => {
    const r2 = cumulativeWins({
      ...input,
      standings: input.standings.filter((s) => s.managerId !== 3),
    })
    expect(r2.series.map((s) => s.managerId)).toEqual([1, 2])
  })
})

describe('cumulativePoints', () => {
  it('sums points for the same way', () => {
    const r = cumulativePoints(input)
    expect(ys(by(r, 1))).toEqual([900, 1700, 2200])
  })

  it('treats a missing points figure as unknown: total carries, and the gap is reported', () => {
    const gappy: HistoryInput = {
      ...input,
      standings: input.standings.map((s) =>
        s.season === 2012 && s.managerId === 1 ? { ...s, pointsFor: null } : s,
      ),
    }
    const r = cumulativePoints(gappy)
    expect(ys(by(r, 1))).toEqual([900, 900, 1400])
    expect(r.missing).toEqual([{ managerId: 1, season: 2012 }])
  })

  it('does not report a skipped season as missing points (that is not having a row at all)', () => {
    expect(cumulativePoints(input).missing).toEqual([])
  })
})

describe('finishBySeason', () => {
  const r = finishBySeason(input)

  it('is the regular-season place, with null where there is none', () => {
    expect(ys(by(r, 1))).toEqual([1, 2, 3])
    expect(ys(by(r, 2))).toEqual([2, null, 2])
    expect(ys(by(r, 3))).toEqual([null, null, 1])
  })

  it('never borrows a bracket result: a champion with no place on record stays null', () => {
    // Manager 2 is the 2012 champion in `seasons` but has no standings row that year.
    // `place` is the regular season, so the chart must not fill the gap with a 1.
    expect(by(r, 2).points.find((p) => p.x === 2012)!.y).toBeNull()
  })

  it('reports the worst place for sizing the axis', () => {
    expect(r.worst).toBe(3)
  })
})

describe('titlesAndMoney', () => {
  const r = titlesAndMoney(input)

  it('matches leagueSummary exactly, because it reuses it', () => {
    const summary = leagueSummary(input)
    for (const row of r.rows) {
      const s = summary.rows.find((x) => x.member.managerId === row.managerId)!
      expect(row.titles).toBe(s.allTime.titles)
      expect(row.moneyWon).toBe(s.allTime.moneyWon)
      expect(row.netWinnings).toBe(s.allTime.netWinnings)
    }
  })

  it('keeps an unknown prize unknown rather than calling it $0', () => {
    expect(r.rows.find((x) => x.managerId === 3)!.moneyWon).toBeNull() // champion, prize null
    expect(r.moneyUnknownSeasons).toEqual([2013])
  })
})

describe('auctionSpendByPosition', () => {
  const pk = (id: number, season: number, managerId: number, position: string, price: number) => ({
    id,
    season,
    managerId,
    playerName: `P${id}`,
    playerPosition: position,
    price,
  })
  const withPicks: HistoryInput = {
    ...input,
    picks: [
      pk(1, 2021, 1, 'QB', 30),
      pk(2, 2021, 2, 'RB', 50),
      pk(3, 2021, 3, 'WR', 20),
      pk(4, 2021, 1, 'DEF', 2),
      pk(5, 2021, 2, 'K', 1),
      pk(6, 2022, 1, 'RB', 40),
      pk(7, 2022, 2, 'TE', 10),
    ],
    trades: [],
  }

  it('groups dollars by player position, newest season first, K and DEF in OTHER', () => {
    const r = auctionSpendByPosition(withPicks)
    expect(r.map((x) => x.season)).toEqual([2022, 2021])
    expect(r[1].byPosition).toEqual({ QB: 30, RB: 50, WR: 20, TE: 0, OTHER: 3 })
    expect(r[0].byPosition).toEqual({ QB: 0, RB: 40, WR: 0, TE: 10, OTHER: 0 })
  })

  it('always adds up to what was spent that year (the number the Past Auctions page prints)', () => {
    for (const row of auctionSpendByPosition(withPicks)) {
      const total = Object.values(row.byPosition).reduce((a, b) => a + b, 0)
      expect(total).toBe(row.spent)
    }
    expect(auctionSpendByPosition(withPicks).find((x) => x.season === 2021)!.spent).toBe(103)
  })

  it('does not move league totals when a player is traded', () => {
    const traded: HistoryInput = {
      ...withPicks,
      trades: [
        {
          id: 1,
          createdAt: '2021-08-01',
          managerAId: 1,
          managerBId: 2,
          players: [{ pickId: 1, toManagerId: 2 }],
        },
      ],
    }
    expect(auctionSpendByPosition(traded)).toEqual(auctionSpendByPosition(withPicks))
  })

  it('does not let a trade from one season touch another', () => {
    const r = auctionSpendByPosition({
      ...withPicks,
      trades: [
        {
          id: 9,
          createdAt: '2022-08-01',
          managerAId: 1,
          managerBId: 2,
          players: [{ pickId: 6, toManagerId: 2 }],
        },
      ],
    })
    expect(r.find((x) => x.season === 2021)!.byPosition.QB).toBe(30)
  })

  it('returns nothing when no picks were loaded, rather than failing', () => {
    expect(auctionSpendByPosition({ ...input, picks: undefined })).toEqual([])
  })
})

describe('cumulativePointsVsAverage', () => {
  const r = cumulativePointsVsAverage(input)

  it('adds up each season’s points above or below that season’s average', () => {
    // 2011: m1 900, m2 700 -> mean 800.  2012: m1 800 alone -> mean 800.
    // 2013: 500, 600, 1000 -> mean 700.
    expect(ys(by(r, 1))).toEqual([100, 100, -100])
    expect(ys(by(r, 2))).toEqual([-100, -100, -200]) // no 2012 row: carries flat
    expect(ys(by(r, 3))).toEqual([null, null, 300]) // null, not zero, before they joined
  })

  it('is zero-sum within a season where everyone has a figure', () => {
    const before = [1, 2, 3].map((id) => ys(by(r, id))[1] ?? 0)
    const after = [1, 2, 3].map((id) => ys(by(r, id))[2] ?? 0)
    const moved = after.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0)
    expect(moved).toBeCloseTo(0, 9) // 2013: -200 + -100 + 300
  })

  it('keeps the same gaps as raw totals but centres them on zero, which is what makes them readable', () => {
    const near: HistoryInput = {
      ...input,
      standings: [
        st(2011, 1, 9, 1, 1500),
        st(2011, 2, 9, 2, 1490),
        st(2011, 3, 9, 3, 1510),
        st(2012, 1, 9, 1, 1500),
        st(2012, 2, 9, 2, 1490),
        st(2012, 3, 9, 3, 1510),
      ],
    }
    const raw = cumulativePoints(near)
    const vs = cumulativePointsVsAverage(near)
    const last = (rep: typeof raw, id: number) => by(rep, id).points[1].y!
    // Raw totals are 3,000-ish for everyone; vs-average is the same ordering and the same
    // gaps, shown around zero: +20 a season for m3, -10 for m2, 0 for m1 against a 1,500 mean.
    for (const [a, b] of [
      [3, 1],
      [1, 2],
    ] as const) {
      expect(last(vs, a) - last(vs, b)).toBeCloseTo(last(raw, a) - last(raw, b), 9)
    }
    expect(last(vs, 3)).toBeCloseTo(20, 9) // 2 seasons x (1510 - 1500)
    expect(last(vs, 2)).toBeCloseTo(-20, 9)
    expect([1, 2, 3].reduce((acc, id) => acc + last(vs, id), 0)).toBeCloseTo(0, 9)
  })

  it('reports a missing points figure and does not skew the rest', () => {
    const gappy: HistoryInput = {
      ...input,
      standings: input.standings.map((s) =>
        s.season === 2013 && s.managerId === 3 ? { ...s, pointsFor: null } : s,
      ),
    }
    const g = cumulativePointsVsAverage(gappy)
    expect(g.missing).toContainEqual({ managerId: 3, season: 2013 })
    // 2013 mean is now over m1 (500) and m2 (600) only = 550.
    expect(ys(by(g, 1))[2]).toBeCloseTo(100 + 0 + (500 - 550), 9)
  })
})

describe('restrictToSeasons', () => {
  it('keeps only the seasons in the window, inclusive at both ends', () => {
    const r = restrictToSeasons(input, 2012, 2013)
    expect(r.seasons.map((x) => x.season)).toEqual([2012, 2013])
    expect([...new Set(r.standings.map((x) => x.season))]).toEqual([2012, 2013])
  })

  it('makes running totals start at the first season shown, not at the all-time total', () => {
    const all = by(cumulativeWins(input), 1)
    expect(ys(all)).toEqual([9, 17, 22])
    const window = cumulativeWins(restrictToSeasons(input, 2012, 2013))
    expect(window.seasons).toEqual([2012, 2013])
    expect(ys(by(window, 1))).toEqual([8, 13]) // 2012 wins, then + 2013, not 17 and 22
  })

  it('omits a manager who has no rows in the window, and keeps members whole', () => {
    const r = restrictToSeasons(input, 2011, 2012)
    expect(r.members).toHaveLength(3)
    expect(cumulativeWins(r).series.map((s) => s.managerId)).toEqual([1, 2]) // 3 joined in 2013
  })

  it('counts titles only inside the window', () => {
    const r = titlesAndMoney(restrictToSeasons(input, 2012, 2012))
    expect(r.rows.find((x) => x.managerId === 2)!.titles).toBe(1)
    expect(r.rows.find((x) => x.managerId === 1)!.titles).toBe(0) // won 2011, outside
  })

  it('leaves the original input alone', () => {
    const before = input.standings.length
    restrictToSeasons(input, 2012, 2012)
    expect(input.standings).toHaveLength(before)
  })

  it('handles a window with no data without failing', () => {
    const r = restrictToSeasons(input, 1990, 1991)
    expect(cumulativeWins(r).series).toEqual([])
    expect(finishBySeason(r).series).toEqual([])
  })
})
