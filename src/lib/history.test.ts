import { describe, expect, it } from 'vitest'
import {
  allPlay,
  coverageFor,
  highLowWeeks,
  isCountedPlayoff,
  leagueSummary,
  type HistoryInput,
  type HistoryMatchup,
  type HistoryMember,
  type HistorySeason,
  type HistoryStanding,
} from './history'

// ---------------------------------------------------------------------------
// Fixtures — a miniature league with all three eras present
// ---------------------------------------------------------------------------

const members: HistoryMember[] = [1, 2, 3, 4].map((id) => ({
  managerId: id,
  name: `M${id}`,
  displayName: `M${id}`,
  color: '#000',
}))

const season = (season: number, dataTier: HistorySeason['dataTier'], over: Partial<HistorySeason> = {}): HistorySeason => ({
  season,
  dataTier,
  regularSeasonWeeks: dataTier === 'weekly' ? 2 : 13,
  championManagerId: null,
  runnerUpManagerId: null,
  thirdManagerId: null,
  championPrize: null,
  runnerUpPrize: null,
  thirdPrize: null,
  highScorePayout: null,
  lowScorePenalty: null,
  draftCity: null,
  draftState: null,
  ...over,
})

const standing = (
  s: number,
  managerId: number,
  over: Partial<HistoryStanding> = {},
): HistoryStanding => ({
  season: s,
  managerId,
  place: managerId,
  wins: 7,
  losses: 6,
  ties: 0,
  pointsFor: 1400,
  pointsAgainst: 1300,
  madePlayoffs: managerId <= 2,
  playoffWins: managerId <= 2 ? 1 : null,
  playoffLosses: managerId <= 2 ? 1 : null,
  ...over,
})

/** One week of four managers, given their scores in manager-id order. */
function week(s: number, w: number, points: number[], over: Partial<HistoryMatchup> = {}): HistoryMatchup[] {
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
      out.push({
        season: s,
        week: w,
        managerId: self,
        points: points[self - 1],
        opponentManagerId: other,
        opponentPoints: points[other - 1],
        isPlayoff: false,
        playoffRound: null,
        playoffPlacement: null,
        result: points[self - 1] > points[other - 1] ? 'W' : points[self - 1] < points[other - 1] ? 'L' : 'T',
        ...over,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------

describe('coverageFor', () => {
  const seasons = [season(2010, 'legacy'), season(2015, 'standings'), season(2021, 'weekly'), season(2022, 'weekly')]

  it('derives the span from the data rather than a hardcoded year', () => {
    expect(coverageFor(seasons, ['weekly'], 'since Sleeper')).toMatchObject({
      from: 2021,
      to: 2022,
      seasons: [2021, 2022],
    })
  })

  it('spans several tiers when asked', () => {
    expect(coverageFor(seasons, ['standings', 'weekly'], 'all-time').from).toBe(2015)
  })

  it('reports an empty span rather than throwing', () => {
    expect(coverageFor([], ['weekly'], 'x')).toMatchObject({ from: null, to: null, seasons: [] })
  })
})

describe('isCountedPlayoff', () => {
  const base = week(2022, 15, [1, 2, 3, 4])[0]

  it('counts the championship path', () => {
    expect(isCountedPlayoff({ ...base, isPlayoff: true, playoffPlacement: null })).toBe(true)
  })

  it('counts the third-place game, because third place pays', () => {
    expect(isCountedPlayoff({ ...base, isPlayoff: true, playoffPlacement: 3 })).toBe(true)
  })

  it('excludes the fifth-place game, because nobody tries in it', () => {
    expect(isCountedPlayoff({ ...base, isPlayoff: true, playoffPlacement: 5 })).toBe(false)
  })

  it('excludes a regular-season game', () => {
    expect(isCountedPlayoff(base)).toBe(false)
  })
})

describe('allPlay', () => {
  const seasons = [season(2021, 'weekly')]

  it('scores everyone against the whole field', () => {
    // Scores 40/30/20/10 — a clean ordering, so the top seed beats all three.
    const report = allPlay(week(2021, 1, [40, 30, 20, 10]), seasons)
    expect(report.rows.find((r) => r.managerId === 1)).toMatchObject({ wins: 3, losses: 0 })
    expect(report.rows.find((r) => r.managerId === 4)).toMatchObject({ wins: 0, losses: 3 })
  })

  it('totals to n(n-1) results per week', () => {
    const matchups = [...week(2021, 1, [40, 30, 20, 10]), ...week(2021, 2, [11, 12, 13, 14])]
    const report = allPlay(matchups, seasons)
    const total = report.rows.reduce((s, r) => s + r.wins + r.losses + r.ties, 0)
    expect(total).toBe(4 * 3 * 2)
  })

  it('records a tie on both sides', () => {
    const report = allPlay(week(2021, 1, [20, 20, 10, 5]), seasons)
    expect(report.rows.find((r) => r.managerId === 1)!.ties).toBe(1)
    expect(report.rows.find((r) => r.managerId === 2)!.ties).toBe(1)
  })

  it('skips a week the whole field did not play, and says so', () => {
    const partial = week(2021, 2, [10, 20, 30, 40]).slice(0, 2)
    const report = allPlay([...week(2021, 1, [40, 30, 20, 10]), ...partial], seasons)
    expect(report.incompleteWeeks).toBe(1)
    // Only the complete week counted: 4 managers x 3 opponents.
    expect(report.rows.reduce((s, r) => s + r.wins + r.losses + r.ties, 0)).toBe(12)
  })

  it('ignores playoff weeks — not everybody plays one', () => {
    const playoff = week(2021, 15, [99, 1, 1, 1], { isPlayoff: true })
    const report = allPlay([...week(2021, 1, [40, 30, 20, 10]), ...playoff], seasons)
    expect(report.rows.reduce((s, r) => s + r.wins + r.losses + r.ties, 0)).toBe(12)
  })
})

describe('highLowWeeks', () => {
  it('pays the high week and charges the low one', () => {
    const seasons = [season(2021, 'weekly', { highScorePayout: 10, lowScorePenalty: 10 })]
    const { rows } = highLowWeeks(week(2021, 1, [40, 30, 20, 10]), seasons)
    expect(rows.find((r) => r.managerId === 1)).toMatchObject({ highWeeks: 1, net: 10 })
    expect(rows.find((r) => r.managerId === 4)).toMatchObject({ lowWeeks: 1, net: -10 })
  })

  it('returns null money — never zero — when the rate is unknown', () => {
    // This is the exact failure the league's own dashboard has: a manager whose
    // lookup silently failed reads as $0, which is indistinguishable from a
    // manager who genuinely broke even.
    const seasons = [season(2021, 'weekly')]
    const { rows, seasonsMissingRate } = highLowWeeks(week(2021, 1, [40, 30, 20, 10]), seasons)
    expect(rows.find((r) => r.managerId === 1)!.net).toBeNull()
    expect(seasonsMissingRate).toEqual([2021])
  })

  it('still counts the weeks when the rate is unknown', () => {
    const seasons = [season(2021, 'weekly')]
    const { rows } = highLowWeeks(week(2021, 1, [40, 30, 20, 10]), seasons)
    expect(rows.find((r) => r.managerId === 1)!.highWeeks).toBe(1)
  })
})

describe('leagueSummary', () => {
  const seasons = [
    season(2008, 'legacy'),
    season(2015, 'standings', { championManagerId: 1, championPrize: 500, runnerUpManagerId: 2, runnerUpPrize: 100 }),
    season(2021, 'weekly', { championManagerId: 2, championPrize: 1000, highScorePayout: 10, lowScorePenalty: 10 }),
  ]
  const standings: HistoryStanding[] = [
    ...members.map((m) => standing(2015, m.managerId)),
    ...members.map((m) => standing(2021, m.managerId)),
  ]
  const matchups = week(2021, 1, [40, 30, 20, 10])
  const lineups = members.map((m) => ({
    season: 2021,
    week: 1,
    managerId: m.managerId,
    actual: 90,
    optimal: 100,
  }))
  const input: HistoryInput = { members, seasons, standings, matchups, lineups }

  it('separates the eras into two objects that cannot be added together', () => {
    const report = leagueSummary(input)
    const row = report.rows.find((r) => r.member.managerId === 1)!
    // Two standings seasons contribute to the career record...
    expect(row.allTime.seasons).toBe(2)
    // ...but only the weekly one can produce an all-play record.
    expect(row.weekly!.allPlayWins + row.weekly!.allPlayLosses).toBe(3)
  })

  it('reports the coverage of each era', () => {
    const report = leagueSummary(input)
    expect(report.allTime).toMatchObject({ from: 2015, to: 2021 })
    expect(report.weekly).toMatchObject({ from: 2021, to: 2021 })
    expect(report.legacyNote.seasons).toEqual([2008])
  })

  it('adds up titles and prize money across eras', () => {
    const report = leagueSummary(input)
    const m2 = report.rows.find((r) => r.member.managerId === 2)!
    expect(m2.allTime.titles).toBe(1)
    expect(m2.allTime.runnerUps).toBe(1)
    expect(m2.allTime.moneyWon).toBe(1100)
  })

  it('does not turn unknown prize money into zero', () => {
    const withUnknown = {
      ...input,
      seasons: [season(2015, 'standings', { championManagerId: 3, championPrize: null })],
      standings: members.map((m) => standing(2015, m.managerId)),
      matchups: [],
      lineups: [],
    }
    const row = leagueSummary(withUnknown).rows.find((r) => r.member.managerId === 3)!
    expect(row.allTime.moneyWon).toBeNull()
    expect(row.allTime.moneyUnknownSeasons).toEqual([2015])
  })

  it('reports zero — not null — for someone who never placed', () => {
    const row = leagueSummary(input).rows.find((r) => r.member.managerId === 4)!
    expect(row.allTime.moneyWon).toBe(0)
  })

  it('computes lineup efficiency as actual over optimal', () => {
    const row = leagueSummary(input).rows.find((r) => r.member.managerId === 1)!
    expect(row.weekly!.lineupEfficiency).toBe(0.9)
  })

  it('gives a manager with no week-level record a null weekly block', () => {
    const standingsOnly: HistoryInput = {
      members,
      seasons: [season(2015, 'standings')],
      standings: members.map((m) => standing(2015, m.managerId)),
      matchups: [],
      lineups: [],
    }
    for (const row of leagueSummary(standingsOnly).rows) {
      expect(row.weekly).toBeNull()
      // The all-time side is still fully populated.
      expect(row.allTime.wins).toBe(7)
    }
  })

  it('leaves playoff win % null rather than 0-0 for someone who never made it', () => {
    const row = leagueSummary(input).rows.find((r) => r.member.managerId === 4)!
    expect(row.allTime.playoffAppearances).toBe(0)
    expect(row.allTime.playoffWinPct).toBeNull()
  })

  it('counts every manager once', () => {
    expect(leagueSummary(input).rows).toHaveLength(members.length)
  })
})

describe('coverage excludes seasons that exist but have not been played', () => {
  it('does not widen the span to a drafted-but-unplayed season', () => {
    // 2026 has a seasons row the moment the draft happens — a tier, a draft
    // location, no games. A span built from rows alone would read "2015–2026"
    // for a table whose last result is 2021.
    const input: HistoryInput = {
      members,
      seasons: [season(2015, 'standings'), season(2021, 'weekly'), season(2026, 'weekly')],
      standings: [
        ...members.map((m) => standing(2015, m.managerId)),
        ...members.map((m) => standing(2021, m.managerId)),
      ],
      matchups: week(2021, 1, [40, 30, 20, 10]),
      lineups: [],
    }
    const report = leagueSummary(input)
    expect(report.allTime.to).toBe(2021)
    expect(report.weekly.to).toBe(2021)
    expect(report.allTime.seasons).not.toContain(2026)
  })
})
