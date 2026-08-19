import { describe, expect, it } from 'vitest'
import {
  allPlay,
  coverageFor,
  highLowWeeks,
  isCountedPlayoff,
  headToHead,
  leagueSummary,
  longestStreaks,
  memberProfile,
  records,
  seasonInReview,
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
  buyIn: null,
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
  const seasons = [season(2021, 'weekly')]

  it('credits the top scorer and the bottom one', () => {
    const { rows } = highLowWeeks(week(2021, 1, [40, 30, 20, 10]), seasons)
    expect(rows.find((r) => r.managerId === 1)).toMatchObject({ highWeeks: 1, lowWeeks: 0 })
    expect(rows.find((r) => r.managerId === 4)).toMatchObject({ highWeeks: 0, lowWeeks: 1 })
  })

  it('counts across weeks and seasons', () => {
    const { rows } = highLowWeeks(
      [...week(2021, 1, [40, 30, 20, 10]), ...week(2021, 2, [40, 30, 20, 10])],
      seasons,
    )
    expect(rows.find((r) => r.managerId === 1)!.highWeeks).toBe(2)
    expect(rows.find((r) => r.managerId === 4)!.lowWeeks).toBe(2)
  })

  it('ignores playoff weeks — the whole field is not playing', () => {
    const playoff = week(2021, 15, [1, 2, 3, 99], { isPlayoff: true })
    const { rows } = highLowWeeks([...week(2021, 1, [40, 30, 20, 10]), ...playoff], seasons)
    expect(rows.find((r) => r.managerId === 4)!.highWeeks).toBe(0)
  })
})

describe('leagueSummary', () => {
  const seasons = [
    season(2008, 'legacy'),
    season(2015, 'standings', { championManagerId: 1, championPrize: 500, runnerUpManagerId: 2, runnerUpPrize: 100 }),
    season(2021, 'weekly', { championManagerId: 2, championPrize: 1000 }),
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

describe('longestStreaks', () => {
  const run = (results: Array<'W' | 'L'>, s = 2021) =>
    results.map((result, i) => ({
      season: s,
      week: i + 1,
      managerId: 1,
      points: 100,
      opponentManagerId: 2,
      opponentPoints: result === 'W' ? 90 : 110,
      isPlayoff: false,
      playoffRound: null,
      playoffPlacement: null,
      result,
    }))

  it('finds the longest run of wins', () => {
    const { wins } = longestStreaks(run(['W', 'L', 'W', 'W', 'W', 'L']))
    expect(wins).toMatchObject({ value: 3, managerId: 1 })
  })

  it('finds the longest run of losses', () => {
    const { losses } = longestStreaks(run(['L', 'L', 'W', 'L']))
    expect(losses).toMatchObject({ value: 2 })
  })

  it('does not let a streak cross a season boundary', () => {
    // Eight months and a fresh draft sit between these two runs of four. A
    // "streak" spanning them describes two different teams.
    const streak = longestStreaks([...run(['W', 'W', 'W', 'W'], 2021), ...run(['W', 'W', 'W', 'W'], 2022)])
    expect(streak.wins!.value).toBe(4)
  })

  it('ignores playoff games', () => {
    const games = run(['W', 'W']).concat(
      run(['W', 'W']).map((g) => ({ ...g, isPlayoff: true, week: g.week + 14 })),
    )
    expect(longestStreaks(games).wins!.value).toBe(2)
  })
})

describe('records', () => {
  const seasons = [
    season(2015, 'standings', { championManagerId: 1, championPrize: 500 }),
    season(2021, 'weekly', { championManagerId: 1, championPrize: 1000 }),
  ]
  const input: HistoryInput = {
    members,
    seasons,
    standings: [
      ...members.map((m) => standing(2015, m.managerId, { pointsFor: 1000 + m.managerId })),
      ...members.map((m) => standing(2021, m.managerId, { pointsFor: 1500 + m.managerId })),
    ],
    matchups: [...week(2021, 1, [140, 30, 100, 99]), ...week(2021, 2, [50, 60, 70, 80])],
    lineups: [],
  }

  it('finds the highest and lowest single scores', () => {
    const book = records(input)
    expect(book.games.find((g) => g.key === 'highScore')).toMatchObject({ value: 140, managerId: 1 })
    expect(book.games.find((g) => g.key === 'lowScore')).toMatchObject({ value: 30, managerId: 2 })
  })

  it('measures a margin from the winner only', () => {
    // Taking margins from both sides would make every blowout also the
    // narrowest loss.
    const book = records(input)
    expect(book.games.find((g) => g.key === 'biggestBlowout')).toMatchObject({
      value: 110,
      managerId: 1,
      opponentManagerId: 2,
    })
    expect(book.games.find((g) => g.key === 'closestGame')!.value).toBe(1)
  })

  it('labels game records with the weekly era and season records with all-time', () => {
    const book = records(input)
    expect(book.gameCoverage.from).toBe(2021)
    expect(book.seasonCoverage.from).toBe(2015)
    // The distinction the workbook loses: these two spans are different.
    expect(book.gameCoverage.from).not.toBe(book.seasonCoverage.from)
  })

  it('reaches back to the standings era for season totals', () => {
    const book = records(input)
    expect(book.seasons.find((s) => s.key === 'fewestPointsSeason')).toMatchObject({ season: 2015 })
  })

  it('ranks the top scoring seasons', () => {
    const book = records(input)
    expect(book.topScoringSeasons).toHaveLength(5)
    expect(book.topScoringSeasons[0].points).toBeGreaterThanOrEqual(book.topScoringSeasons[4].points)
  })

  it('reports career money and titles', () => {
    const book = records(input)
    expect(book.careers.find((c) => c.key === 'mostTitles')).toMatchObject({ value: 2, managerId: 1 })
    expect(book.careers.find((c) => c.key === 'mostMoney')).toMatchObject({ value: 1500 })
  })

  it('omits a record nobody holds rather than inventing a zero', () => {
    const empty = records({ members, seasons: [], standings: [], matchups: [], lineups: [] })
    expect(empty.games).toEqual([])
    expect(empty.careers).toEqual([])
  })
})

describe('seasonInReview', () => {
  const input: HistoryInput = {
    members,
    seasons: [season(2021, 'weekly', { championManagerId: 2, runnerUpManagerId: 3, thirdManagerId: 1 })],
    standings: members.map((m) => standing(2021, m.managerId)),
    matchups: [...week(2021, 1, [140, 30, 100, 99]), ...week(2021, 2, [50, 60, 70, 80])],
    lineups: [],
  }

  it('names the podium and the regular-season winner separately', () => {
    const r = seasonInReview(input, 2021)!
    expect(r.champion).toBe(2)
    expect(r.third).toBe(1)
    // place 1 in the standings fixture is manager 1 — often not the champion.
    expect(r.regularSeasonWinner).toBe(1)
  })

  it('finds the season’s extremes', () => {
    const r = seasonInReview(input, 2021)!
    expect(r.highestScore).toMatchObject({ value: 140 })
    expect(r.lowestScore).toMatchObject({ value: 30 })
    expect(r.closestGame!.value).toBe(1)
  })

  it('ranks consistency by standard deviation', () => {
    const r = seasonInReview(input, 2021)!
    expect(r.mostConsistent!.stdev).toBeLessThanOrEqual(r.mostVolatile!.stdev)
  })

  it('returns null for a season nobody has a record of', () => {
    expect(seasonInReview(input, 1999)).toBeNull()
  })

  it('leaves game-level fields null for a standings-only season', () => {
    const older: HistoryInput = {
      members,
      seasons: [season(2015, 'standings', { championManagerId: 1 })],
      standings: members.map((m) => standing(2015, m.managerId)),
      matchups: [],
      lineups: [],
    }
    const r = seasonInReview(older, 2015)!
    expect(r.champion).toBe(1)
    expect(r.highestScore).toBeNull()
    expect(r.mostConsistent).toBeNull()
  })
})

describe('best and worst record rank by percentage, not margin', () => {
  it('prefers the better rate over the bigger margin', () => {
    // 11-2 in a 13-game season (.846) beats 12-3 in a 15-game one (.800),
    // even though both are +9. The league played 13-game seasons through 2020
    // and 14 from 2021, so margin quietly favours the longer years.
    const input: HistoryInput = {
      members,
      seasons: [season(2019, 'standings'), season(2021, 'weekly')],
      standings: [
        standing(2019, 1, { wins: 11, losses: 2 }),
        standing(2021, 2, { wins: 12, losses: 3 }),
        ...members.slice(2).map((m) => standing(2019, m.managerId, { wins: 5, losses: 8 })),
      ],
      matchups: [],
      lineups: [],
    }
    const bestRec = records(input).seasons.find((r) => r.key === 'bestRecord')!
    expect(bestRec.managerId).toBe(1)
    expect(bestRec.display).toBe('11-2')
  })
})

describe('headToHead', () => {
  const seasons = [season(2021, 'weekly')]
  // 1 beats 2 twice; 3 and 4 split.
  const matchups = [
    ...week(2021, 1, [40, 30, 20, 10]),
    ...week(2021, 2, [40, 30, 10, 20]),
  ]

  it('records both sides of a pairing', () => {
    const h2h = headToHead(matchups, seasons)
    expect(h2h.get(1, 2)).toMatchObject({ wins: 2, losses: 0 })
    expect(h2h.get(2, 1)).toMatchObject({ wins: 0, losses: 2 })
  })

  it('splits a split', () => {
    const h2h = headToHead(matchups, seasons)
    expect(h2h.get(3, 4)).toMatchObject({ wins: 1, losses: 1 })
  })

  it('accumulates points for and against', () => {
    expect(headToHead(matchups, seasons).get(1, 2)).toMatchObject({
      pointsFor: 80,
      pointsAgainst: 60,
    })
  })

  it('excludes playoff meetings', () => {
    // Rare and unevenly distributed: a pairing that met three times in January
    // would show a record that says more about seeding than the matchup.
    const withPlayoff = [...matchups, ...week(2021, 15, [1, 99, 1, 1], { isPlayoff: true })]
    expect(headToHead(withPlayoff, seasons).get(1, 2)).toMatchObject({ wins: 2, losses: 0 })
  })

  it('has no cell for a pairing that never met', () => {
    expect(headToHead(matchups, seasons).get(1, 3)).toBeUndefined()
  })
})

describe('memberProfile', () => {
  const seasons = [
    season(2015, 'standings', { championManagerId: 1, championPrize: 500 }),
    season(2021, 'weekly', { thirdManagerId: 1, thirdPrize: 100 }),
  ]
  const input: HistoryInput = {
    members,
    seasons,
    standings: [
      standing(2015, 1, { wins: 10, losses: 3 }),
      standing(2021, 1, { wins: 4, losses: 10 }),
      ...members.slice(1).flatMap((m) => [standing(2015, m.managerId), standing(2021, m.managerId)]),
    ],
    matchups: week(2021, 1, [40, 30, 20, 10]),
    lineups: [],
    picks: [
      { season: 2021, managerId: 1, playerName: 'Big Buy', playerPosition: 'RB', price: 60 },
      { season: 2021, managerId: 1, playerName: 'Cheap Guy', playerPosition: 'WR', price: 2 },
      { season: 2021, managerId: 2, playerName: 'Someone Else', playerPosition: 'QB', price: 30 },
    ],
  }

  it('lists seasons newest first with the podium finish', () => {
    const p = memberProfile(input, 1)!
    expect(p.seasons.map((s) => s.season)).toEqual([2021, 2015])
    expect(p.seasons.find((s) => s.season === 2015)!.finish).toBe('champion')
    expect(p.seasons.find((s) => s.season === 2021)!.finish).toBe('third')
  })

  it('carries the prize for the placing actually achieved', () => {
    const p = memberProfile(input, 1)!
    expect(p.seasons.find((s) => s.season === 2015)!.prize).toBe(500)
    expect(p.seasons.find((s) => s.season === 2021)!.prize).toBe(100)
  })

  it('sums only that member’s draft spend, and names their biggest buy', () => {
    const s = memberProfile(input, 1)!.seasons.find((x) => x.season === 2021)!
    expect(s.draftSpend).toBe(62)
    expect(s.biggestBuy).toMatchObject({ playerName: 'Big Buy', price: 60 })
  })

  it('reports an unknown draft spend as null, never zero', () => {
    // Zero would read as "they drafted nobody" for a season whose auction
    // simply is not on record.
    const s = memberProfile(input, 1)!.seasons.find((x) => x.season === 2015)!
    expect(s.draftSpend).toBeNull()
    expect(s.biggestBuy).toBeNull()
  })

  it('picks best and worst season by win rate, not by wins', () => {
    const p = memberProfile(input, 1)!
    expect(p.bestSeason!.season).toBe(2015)
    expect(p.worstSeason!.season).toBe(2021)
  })

  it('agrees with the all-time table rather than recomputing it', () => {
    // The failure this avoids: a member page and the summary disagreeing, which
    // makes people stop trusting both.
    const fromSummary = leagueSummary(input).rows.find((r) => r.member.managerId === 1)!
    expect(memberProfile(input, 1)!.allTime).toEqual(fromSummary.allTime)
  })

  it('returns null for somebody who is not in the league', () => {
    expect(memberProfile(input, 999)).toBeNull()
  })
})

describe('a season in progress does not become a record', () => {
  // A standings row exists for the live season from its first weekly refresh,
  // with an 0-0 record and zero points. Left in, it wins "fewest points in a
  // season" outright and stretches every era badge a year into the future.
  const input: HistoryInput = {
    members,
    seasons: [season(2021, 'weekly'), season(2026, 'weekly')],
    standings: [
      ...members.map((m) => standing(2021, m.managerId, { pointsFor: 1500 })),
      ...members.map((m) =>
        standing(2026, m.managerId, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }),
      ),
    ],
    matchups: week(2021, 1, [40, 30, 20, 10]),
    lineups: [],
  }

  it('keeps an unplayed season out of the season records', () => {
    const fewest = records(input).seasons.find((r) => r.key === 'fewestPointsSeason')!
    expect(fewest.season).toBe(2021)
    expect(fewest.value).toBe(1500)
  })

  it('does not stretch the coverage span into it', () => {
    expect(records(input).seasonCoverage.to).toBe(2021)
    expect(leagueSummary(input).allTime.to).toBe(2021)
  })
})

describe('net winnings', () => {
  const base = (over: Partial<HistorySeason>) => season(2021, 'weekly', { buyIn: 100, ...over })

  it('subtracts the entry fee from the prize', () => {
    const input: HistoryInput = {
      members,
      seasons: [base({ championManagerId: 1, championPrize: 700 })],
      standings: members.map((m) => standing(2021, m.managerId)),
      matchups: [],
      lineups: [],
    }
    const rows = leagueSummary(input).rows
    expect(rows.find((r) => r.member.managerId === 1)!.allTime.netWinnings).toBe(600)
    // Nine people paid in and won nothing. Gross winnings hide that entirely.
    expect(rows.find((r) => r.member.managerId === 2)!.allTime.netWinnings).toBe(-100)
  })

  it('charges the fee once per season played', () => {
    const input: HistoryInput = {
      members,
      seasons: [base({}), season(2022, 'weekly', { buyIn: 100 })],
      standings: [
        ...members.map((m) => standing(2021, m.managerId)),
        ...members.map((m) => standing(2022, m.managerId)),
      ],
      matchups: [],
      lineups: [],
    }
    const row = leagueSummary(input).rows.find((r) => r.member.managerId === 3)!
    expect(row.allTime.buyInsPaid).toBe(200)
    expect(row.allTime.netWinnings).toBe(-200)
  })

  it('never mixes eras: prizes and fees come from the same seasons', () => {
    // The bug this replaces: subtracting the one season whose fee is recorded
    // from every prize ever won produced fifteen years of winnings minus one
    // year's entry fee, which is not a number about anything.
    const input: HistoryInput = {
      members,
      seasons: [
        season(2015, 'standings', { championManagerId: 1, championPrize: 900 }),
        season(2021, 'weekly', { buyIn: 100 }),
      ],
      standings: [
        ...members.map((m) => standing(2015, m.managerId)),
        ...members.map((m) => standing(2021, m.managerId)),
      ],
      matchups: [],
      lineups: [],
    }
    const row = leagueSummary(input).rows.find((r) => r.member.managerId === 1)!
    expect(row.allTime.moneyWon).toBe(900)
    // 2015 has no buy-in, so it is outside the net figure entirely.
    expect(row.allTime.netSeasons).toEqual([2021])
    expect(row.allTime.netWinnings).toBe(-100)
  })

  it('treats an unrecorded buy-in as unknown, not free', () => {
    const input: HistoryInput = {
      members,
      seasons: [season(2021, 'weekly', { buyIn: null })],
      standings: members.map((m) => standing(2021, m.managerId)),
      matchups: [],
      lineups: [],
    }
    // Nothing is charged, and the total is honest about covering no seasons.
    expect(leagueSummary(input).rows[0].allTime.buyInsPaid).toBe(0)
  })
})
