import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MIN_SURPRISE,
  groundedKeys,
  type GazetteFacts,
  isPreview,
  misattributedNumbers,
  numbersIn,
  rarity,
  seasonPreview,
  ungroundedNumbers,
  upTo,
  weekInReview,
  weekLabel,
  type GazetteInput,
  type GazettePlayerWeek,
  type PreviewInput,
  type PreviewPick,
  type PriorIssue,
} from './gazette'
import type {
  HistoryInput,
  HistoryLineup,
  HistoryMatchup,
  HistoryMember,
  HistorySeason,
} from './history'
import { PROMPT_VERSION } from '../../scripts/history/gazette-prompt'
import { PREVIEW_PROMPT_VERSION } from '../../scripts/history/gazette-preview-prompt'

// ---------------------------------------------------------------------------
// Fixtures — four managers, two seasons, so "career" and "as of" both mean
// something. Mirrors the shape of history.test.ts on purpose.
// ---------------------------------------------------------------------------

const members: HistoryMember[] = [1, 2, 3, 4].map((id) => ({
  managerId: id,
  name: `M${id}`,
  displayName: `M${id}`,
  color: '#000',
}))

const season = (
  s: number,
  over: Partial<HistorySeason> = {},
): HistorySeason => ({
  season: s,
  dataTier: 'weekly',
  regularSeasonWeeks: 3,
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

/** One week of four managers: 1v2 and 3v4, scores in manager-id order. */
function week(
  s: number,
  w: number,
  points: number[],
  over: Partial<HistoryMatchup> = {},
): HistoryMatchup[] {
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
        isPlayoff: false,
        playoffRound: null,
        playoffPlacement: null,
        result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
        ...over,
      })
    }
  }
  return out
}

function lineups(s: number, w: number, pairs: Array<[number, number]>): HistoryLineup[] {
  return pairs.map(([actual, optimal], i) => ({
    season: s,
    week: w,
    managerId: i + 1,
    actual,
    optimal,
  }))
}

const player = (over: Partial<GazettePlayerWeek> = {}): GazettePlayerWeek => ({
  season: 2025,
  week: 1,
  managerId: 1,
  playerId: 'p1',
  player: 'A Player',
  position: 'RB',
  nflTeam: 'SF',
  isStarter: true,
  slot: 'RB',
  points: 10,
  ...over,
})

/**
 * Two full seasons. 2024 is finished; 2025 has three weeks played, and manager 1
 * blows up in week 3 — which is what lets the "no future knowledge" tests bite.
 */
function history(over: Partial<HistoryInput> = {}): HistoryInput {
  const matchups = [
    ...week(2024, 1, [100, 90, 80, 70]),
    ...week(2024, 2, [100, 90, 80, 70]),
    ...week(2024, 3, [100, 90, 80, 70]),
    ...week(2025, 1, [100, 90, 80, 70]),
    ...week(2025, 2, [60, 130, 80, 70]),
    // 777 is a sentinel: distinctive enough that a substring assertion against
    // the serialised pack cannot collide with an arithmetic result elsewhere.
    ...week(2025, 3, [777, 40, 80, 70]),
  ]
  return {
    members,
    seasons: [season(2024), season(2025)],
    // Deliberately WRONG on purpose: these are final-season numbers, and any
    // test that reads them for an as-of-week figure will produce them.
    standings: members.map((m) => ({
      season: 2025,
      managerId: m.managerId,
      place: 1,
      wins: 9191,
      losses: 0,
      ties: 0,
      pointsFor: 91919,
      pointsAgainst: 0,
      madePlayoffs: true,
      playoffWins: null,
      playoffLosses: null,
    })),
    matchups,
    lineups: [
      ...lineups(2025, 1, [[100, 100], [90, 95], [80, 80], [70, 120]]),
      ...lineups(2025, 2, [[60, 61], [130, 130], [80, 80], [70, 70]]),
      ...lineups(2025, 3, [[777, 777], [40, 140], [80, 80], [70, 70]]),
    ],
    ...over,
  }
}

function input(over: Partial<GazetteInput> = {}): GazetteInput {
  return {
    season: 2025,
    week: 2,
    history: history(),
    playersToDate: [],
    priorIssues: [],
    sideBet: null,
    ...over,
  }
}

// --- preview fixtures ------------------------------------------------------

let nextPickId = 1

/** One auction pick. `drafter` defaults to the owner, as it does with no trades. */
const pick = (over: Partial<PreviewPick> = {}): PreviewPick => {
  const managerId = over.managerId ?? over.drafter ?? 1
  return {
    id: nextPickId++,
    season: 2026,
    pickNo: 1,
    managerId,
    drafter: managerId,
    nominatorId: managerId,
    price: 10,
    player: 'A Player',
    position: 'RB',
    nflTeam: 'SF',
    rank: 10,
    sleeperId: null,
    ...over,
  }
}

/**
 * Enough of an auction to score: eight ranked players at one position, so the
 * within-position comparison has a group it will not discard as too small.
 */
function auction(over: PreviewPick[] = []): PreviewPick[] {
  const base = Array.from({ length: 8 }, (_, i) =>
    pick({
      managerId: (i % 4) + 1,
      pickNo: i + 1,
      position: 'RB',
      player: `RB${i + 1}`,
      price: 40 - i * 4,
      rank: i + 1,
      sleeperId: `rb${i + 1}`,
    }),
  )
  return [...base, ...over]
}

function previewInput(over: Partial<PreviewInput> = {}): PreviewInput {
  return {
    season: 2026,
    history: history({ seasons: [season(2024), season(2025), season(2026)] }),
    picks: auction(),
    budget: 200,
    rosterSize: 16,
    sideBet: null,
    genre: null,
    priorIssues: [],
    ...over,
  }
}

// ---------------------------------------------------------------------------

describe('upTo', () => {
  it('keeps every earlier season whole and truncates the current one', () => {
    const rows = [
      { season: 2024, week: 9 },
      { season: 2025, week: 2 },
      { season: 2025, week: 3 },
    ]
    expect(upTo(rows, 2025, 2)).toEqual([
      { season: 2024, week: 9 },
      { season: 2025, week: 2 },
    ])
  })
})

describe('rarity', () => {
  it('scores two values from different scales the same when they are equally extreme', () => {
    // The whole rotating slot depends on this. If a 40-point bust and a 6-week
    // streak cannot be ranked against each other honestly, the same category
    // wins every week and the section is a fixed list with extra steps.
    const points = [1, 2, 3, 4, 100]
    const weeks = [0.01, 0.02, 0.03, 0.04, 1]
    expect(rarity(100, points)).toBeCloseTo(rarity(1, weeks), 4)
  })

  it('returns zero when there is nothing to compare against', () => {
    expect(rarity(50, [50])).toBe(0)
  })
})

describe('weekLabel', () => {
  it('reads the playoff boundary from the season rather than a constant', () => {
    // 2020 played 13 regular-season weeks and 2021 onward play 14, so the same
    // week number is a playoff game in one era and a regular one in the next.
    const playoff = week(2025, 4, [100, 90, 80, 70], { isPlayoff: true, playoffRound: 1 })
    expect(weekLabel(season(2025, { regularSeasonWeeks: 3 }), 4, playoff).label).toBe('Quarter-finals')
    expect(weekLabel(season(2025, { regularSeasonWeeks: 4 }), 4, week(2025, 4, [1, 2, 3, 4])).label).toBe(
      'Week 4',
    )
  })

  it('names a fifth-place game as consolation', () => {
    const fifth = week(2025, 5, [100, 90, 80, 70], { isPlayoff: true, playoffPlacement: 5 })
    expect(weekLabel(season(2025), 5, fifth).phase).toBe('consolation')
  })
})

describe('weekInReview', () => {
  it('returns null for a week with no games rather than an empty issue', () => {
    // The cron fires 52 weeks a year. Out of season this must be a quiet no-op.
    expect(weekInReview(input({ week: 9 }))).toBeNull()
  })

  it('reports records as of the week being written about, not the final table', () => {
    // The single most likely silent bug in the feature. `season_standings` is
    // season-grain and rewritten wholesale on every refresh, so a backfilled
    // week 2 issue that read it would print the finished record. The fixture's
    // standings say 99-0 on purpose; nothing here may produce that.
    const facts = weekInReview(input({ week: 2 }))!
    const m1 = facts.standings.find((r) => r.manager === 'M1')!
    expect(m1.record).toBe('1-1')
    expect(JSON.stringify(facts)).not.toContain('9191')
  })

  it('never sees a game later than the week in hand', () => {
    // Manager 1 scores 777 in week 3. A week-2 issue that knows about it would
    // be a retrospective with future knowledge, which is worse than no issue.
    const facts = weekInReview(input({ week: 2 }))!
    expect(JSON.stringify(facts)).not.toContain('777')
  })

  it('counts only the teams that actually played', () => {
    // A playoff week carries four to six sides in season_matchups while
    // season_lineups still carries ten. A league-wide figure computed over "the
    // league" in week 16 would mix the two.
    const h = history()
    h.matchups = [...h.matchups, ...week(2025, 4, [100, 90, 80, 70], { isPlayoff: true })].filter(
      (m) => !(m.season === 2025 && m.week === 4 && m.managerId > 2),
    )
    const facts = weekInReview(input({ week: 4, history: h }))!
    expect(facts.teamsPlaying).toBe(2)
    expect(facts.notes.join(' ')).toContain('Only 2 teams played')
  })

  it('puts the winner and the margin on every game', () => {
    const facts = weekInReview(input({ week: 2 }))!
    const game = facts.games.find((g) => g.winner === 'M2')!
    expect(game.loser).toBe('M1')
    expect(game.margin).toBe(70)
    expect(game.winnerPoints).toBe(130)
  })

  it('carries the loser bench points, which is where the joke lives', () => {
    const facts = weekInReview(input({ week: 3 }))!
    const game = facts.games.find((g) => g.loser === 'M2')!
    expect(game.loserBenchPoints).toBe(100)
  })
})

describe('the belt', () => {
  it('goes to the manager who lost with the most left on the bench, not the lowest score', () => {
    // M2 scores 40 -- the worst in the league -- AND leaves 100 on the bench.
    // M4 scores 70 and left nothing. The belt is for management, not rosters.
    const facts = weekInReview(input({ week: 3 }))!
    expect(facts.belt!.manager).toBe('M2')
    expect(facts.belt!.reason).toContain('on the bench')
  })

  it('counts how long the current holder has kept it', () => {
    const prior: PriorIssue[] = [
      { season: 2025, week: 1, headline: 'h', lens: null, columnText: 'c', threads: [], beltManagerId: 2, statIds: [] },
      { season: 2025, week: 2, headline: 'h', lens: null, columnText: 'c', threads: [], beltManagerId: 2, statIds: [] },
    ]
    const facts = weekInReview(input({ week: 3, priorIssues: prior }))!
    expect(facts.belt!.manager).toBe('M2')
    expect(facts.belt!.heldFor).toBe(3)
  })
})

describe('the ledger', () => {
  it('reports dollars only when the season has a recorded rate', () => {
    const paid = weekInReview(input({ week: 3, sideBet: 10 }))!
    const m2 = paid.ledger.find((r) => r.manager === 'M2')!
    // M2 took the high once and propped it up once: net zero, but a KNOWN zero.
    expect(m2.net).toBe(0)
    const m1 = paid.ledger.find((r) => r.manager === 'M1')!
    expect(m1.net).toBe(10)
  })

  it('leaves the money unknown rather than zero for a season with no rate', () => {
    // The league only started the side bet a couple of years ago. A backfilled
    // 2020 issue claiming everybody broke even is a confident wrong answer;
    // saying nothing is the honest one.
    const facts = weekInReview(input({ week: 3, sideBet: null }))!
    expect(facts.sideBet).toBeNull()
    for (const row of facts.ledger) expect(row.net).toBeNull()
  })

  it('still counts high and low weeks when the rate is unknown', () => {
    const facts = weekInReview(input({ week: 3, sideBet: null }))!
    expect(facts.ledger.some((r) => r.highWeeks > 0)).toBe(true)
  })
})

describe('this week in history', () => {
  it('looks up the same week number in earlier seasons only', () => {
    const facts = weekInReview(input({ week: 2 }))!
    expect(facts.thisWeekInHistory.every((e) => e.season < 2025)).toBe(true)
    expect(facts.thisWeekInHistory.map((e) => e.season)).toContain(2024)
  })
})

describe('milestones', () => {
  it('announces a crossing, not a running total', () => {
    // Manager 1 sits on 2 career wins after week 1 and 3 after week 3. A
    // 3-win threshold should fire once, in the week it was crossed, and never
    // again -- otherwise every issue for the rest of the season repeats it.
    const facts = weekInReview(input({ week: 3 }))!
    const crossed = facts.milestones.filter((m) => m.crossed)
    expect(crossed.every((m) => m.away === null)).toBe(true)
  })

  it('carries the coverage its claim is actually true across', () => {
    // A career number quoted without its span is the exact failure coverageFor
    // exists to prevent: these seasons are weekly-tier only, and saying "of all
    // time" over them would be a lie about fourteen earlier years.
    const facts = weekInReview(input({ week: 3 }))!
    for (const m of facts.milestones) expect(m.coverage.label).toBeTruthy()
  })
})

describe('stat of the week', () => {
  it('judges a boom against form BEFORE this week, never the final season average', () => {
    // player_seasons.avg_points is the FINAL average, so judging a week-2
    // explosion against it quietly grades the player on games they had not
    // played yet. Here p1 averages 5 over weeks 1-2 and posts 60 in week 3.
    // Three players, so "surprising" has a population to be surprising against.
    // With one there is nothing to compare to and the floor correctly drops it.
    const players: GazettePlayerWeek[] = [
      player({ week: 1, points: 5 }),
      player({ week: 2, points: 5 }),
      player({ week: 3, points: 5 }),
      player({ week: 4, points: 60 }),
      ...[1, 2, 3, 4].map((w) => player({ playerId: 'p2', player: 'Steady', week: w, points: 20 })),
      ...[1, 2, 3].map((w) => player({ playerId: 'p3', player: 'Middling', week: w, points: 10 })),
      player({ playerId: 'p3', player: 'Middling', week: 4, points: 9 }),
    ]
    const h = history()
    h.matchups = [...h.matchups, ...week(2025, 4, [100, 90, 80, 70])]
    h.lineups = [...h.lineups, ...lineups(2025, 4, [[100, 100], [90, 90], [80, 80], [70, 70]])]
    const facts = weekInReview(input({ week: 4, history: h, playersToDate: players }))!
    const boom = facts.stats.find((s) => s.id.startsWith('boom:'))
    expect(boom).toBeDefined()
    // 60 against an average of 5 is a gap of 55. Judged against the FINAL
    // average of 18.75 it would read as a gap of 41.25 -- a smaller, wrong,
    // and quietly future-informed number.
    expect(boom!.claim).toContain('55')
    expect(boom!.detail).toContain('average of 5 ')
  })

  it('drops a candidate that already ran in a recent issue', () => {
    const players: GazettePlayerWeek[] = [
      player({ week: 1, points: 5 }),
      player({ week: 2, points: 5 }),
      player({ week: 3, points: 60 }),
    ]
    const used: PriorIssue[] = [
      {
        season: 2025,
        week: 2,
        headline: 'h',
        lens: null,
        columnText: 'c',
        threads: [],
        beltManagerId: null,
        statIds: ['boom:2025:3'],
      },
    ]
    const facts = weekInReview(input({ week: 3, playersToDate: players, priorIssues: used }))!
    expect(facts.stats.some((s) => s.id === 'boom:2025:3')).toBe(false)
  })

  it('ranks candidates by surprise, most surprising first', () => {
    const facts = weekInReview(input({ week: 3 }))!
    const scores = facts.stats.map((s) => s.surprise)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('gives every candidate a coverage, so no superlative is unbounded', () => {
    const facts = weekInReview(input({ week: 3 }))!
    for (const s of facts.stats) expect(s.coverage.label).toBeTruthy()
  })

  it('drops candidates that are not actually surprising', () => {
    // An ordinary week should hand the model a short list or none at all.
    // "Only 316 losing scores on record beat it" is the failure this prevents:
    // technically true, structurally identical to a real record, and completely
    // meaningless -- and printing one every week devalues the weeks that matter.
    const facts = weekInReview(input({ week: 3 }))!
    for (const s of facts.stats) expect(s.surprise).toBeGreaterThanOrEqual(MIN_SURPRISE)
  })

  it('never states a rank that is too long to be interesting', () => {
    // A rank is only worth printing when the rank is short.
    const facts = weekInReview(input({ week: 3 }))!
    for (const s of facts.stats) {
      const rank = s.detail.match(/only (\d+) /)
      if (rank) expect(Number(rank[1])).toBeLessThan(12)
    }
  })
})

describe('grounding', () => {
  const facts = () => weekInReview(input({ week: 2 }))!

  it('accepts a column that only quotes figures from the pack', () => {
    const f = facts()
    expect(ungroundedNumbers('M2 put up 130 and beat M1 by 70.', f)).toEqual([])
  })

  it('accepts a score written without its decimals', () => {
    // 128.64 licenses "128" and "128.6". Dropping precision is a style choice.
    const f = facts()
    f.games[0].winnerPoints = 128.64
    expect(ungroundedNumbers('a 128 point week', f)).toEqual([])
    expect(ungroundedNumbers('a 128.6 point week', f)).toEqual([])
  })

  it('rejects a score written with invented precision', () => {
    // Inventing precision is inventing a fact. 128.61 is not 128.64.
    const f = facts()
    f.games[0].winnerPoints = 128.64
    expect(ungroundedNumbers('a 128.61 point week', f).join()).toContain('128.61')
  })

  it('rejects a total the model worked out for itself', () => {
    // An arithmetic slip and a hallucination are indistinguishable to a reader,
    // and both cost the same credibility. The pack is the whole world.
    const f = facts()
    expect(ungroundedNumbers('the two of them combined for 4821.5 points', f).length).toBe(1)
  })

  it('does not flag digits inside a name the pack itself uses', () => {
    // The 49ers problem. A team name is not a statistic.
    const f = facts()
    f.games[0].winner = 'San Francisco 49ers'
    expect(ungroundedNumbers('San Francisco 49ers rolled', f)).toEqual([])
  })

  it('lets a year through without demanding it be in the pack', () => {
    const f = facts()
    expect(ungroundedNumbers('not since 2019 has this happened', f)).toEqual([])
  })

  it('authorises a number that only appears inside a claim string', () => {
    // Records like "8-1" and figures baked into a generated claim are real
    // facts the pack asserted; they must not read as inventions.
    const f = facts()
    f.stats = [{ ...f.stats[0], claim: 'M1 has now done it 17 times' }]
    expect(ungroundedNumbers('all 17 of them', f)).toEqual([])
  })

  it('walks nested fields, so a new pack field is grounded without a second list', () => {
    const f = facts()
    const keys = groundedKeys(f)
    expect(keys.has(f.powerRankings[0].pointsFor.toFixed(2))).toBe(true)
  })

  it('reports the offending number with enough context to read it', () => {
    const f = facts()
    const [flag] = ungroundedNumbers('he was outscored by 4821.5 that afternoon', f)
    expect(flag).toContain('4821.5')
    expect(flag).toContain('outscored by')
  })
})

describe('numbersIn', () => {
  it('strips the longest proper noun first, so a name inside a name is safe', () => {
    expect(numbersIn('San Francisco 49ers', ['49ers', 'San Francisco 49ers'])).toEqual([])
  })

  it('reads a number written with thousands separators', () => {
    expect(numbersIn('25,000 career points')[0].key).toBe('25000.00')
  })
})

describe('misattribution', () => {
  it('flags a real figure hung on the wrong manager', () => {
    // The one class of error the numeric check cannot see: every digit is real.
    const f = weekInReview(input({ week: 2 }))!
    const wrong = misattributedNumbers('M1 put up 130.00 without breaking sweat', f)
    expect(wrong.join()).toContain('M1')
  })

  it('says nothing when the figure belongs to the manager beside it', () => {
    const f = weekInReview(input({ week: 2 }))!
    expect(misattributedNumbers('M2 put up 130.00 without breaking sweat', f)).toEqual([])
  })
})

describe('seasonPreview', () => {
  it('says nothing at all about a season with no auction on record', () => {
    expect(seasonPreview(previewInput({ picks: [] }))).toBeNull()
  })

  it('charges every dollar to the man who bought the player, not the man holding him', () => {
    // A trade moves `picks.manager_id` but not the salary. `drafter` is the
    // rewound owner, and the preview is entirely a money question.
    const facts = seasonPreview(
      previewInput({
        picks: [pick({ managerId: 2, drafter: 1, price: 55, rank: 1, position: 'WR' })],
      }),
    )!
    expect(facts.rosters.find((r) => r.manager === 'M1')?.spent).toBe(55)
    expect(facts.rosters.find((r) => r.manager === 'M2')).toBeUndefined()
  })

  it('compares a price to the board WITHIN a position, never across', () => {
    // The non-negotiable in AGENTS.md, and the bug the first cut of this had:
    // a cross-position comparison in a superflex league just rediscovers that
    // quarterbacks cost more, and returns nothing but quarterbacks.
    //
    // Here a QB is the priciest player in the room AND the worst-ranked one on
    // the overall board. Cross-position, he is the reach of the century. Within
    // his own position he is the only QB scored, so the group is too small to
    // judge and he must not appear at all.
    const facts = seasonPreview(
      previewInput({
        picks: auction([
          pick({ managerId: 1, position: 'QB', player: 'A QB', price: 99, rank: 400 }),
        ]),
      }),
    )!
    expect(facts.reaches.map((r) => r.player)).not.toContain('A QB')
    expect(facts.bargains.every((b) => b.position === 'RB')).toBe(true)
  })

  it('scores a price against its own position rank, both ranks reported', () => {
    // The board's best RB, sold for less than four men below him.
    const facts = seasonPreview(
      previewInput({
        picks: auction([]).map((p) => (p.rank === 1 ? { ...p, price: 5 } : p)),
      }),
    )!
    const steal = facts.bargains.find((b) => b.boardPositionRank === 1)
    expect(steal).toBeDefined()
    expect(steal!.price).toBe(5)
    expect(steal!.pricePositionRank).toBeGreaterThan(steal!.boardPositionRank!)
  })

  it('leaves an unranked pick out of the value lists rather than scoring it zero', () => {
    // Null rank is "unranked", never rank 0 — which would read as the best
    // player alive and top every bargain list forever.
    const facts = seasonPreview(
      previewInput({
        picks: auction([pick({ managerId: 1, position: 'RB', player: 'Nobody', price: 40, rank: null })]),
      }),
    )!
    for (const list of [facts.bargains, facts.reaches]) {
      expect(list.map((b) => b.player)).not.toContain('Nobody')
    }
  })

  it('finds a man who has bought the same player before, matched on sleeper id', () => {
    const facts = seasonPreview(
      previewInput({
        picks: [
          pick({ season: 2024, managerId: 1, price: 20, sleeperId: 'x' }),
          pick({ season: 2026, managerId: 1, price: 44, sleeperId: 'x', player: 'The Regular' }),
        ],
      }),
    )!
    expect(facts.repeats).toHaveLength(1)
    expect(facts.repeats[0]).toMatchObject({
      manager: 'M1',
      player: 'The Regular',
      seasons: [2024, 2026],
      prices: [20, 44],
    })
  })

  it('never groups two unidentified players into a repeat buy', () => {
    // `sleeper_id` is nullable on purpose: the matcher refuses to guess between
    // two men of the same name. Grouping the unknowns would invent a repeat out
    // of two different players.
    const facts = seasonPreview(
      previewInput({
        picks: [
          pick({ season: 2024, managerId: 1, sleeperId: null, player: 'One Man' }),
          pick({ season: 2026, managerId: 1, sleeperId: null, player: 'Another Man' }),
        ],
      }),
    )!
    expect(facts.repeats).toEqual([])
  })

  it('reads last season as a REGULAR-SEASON table and names the champion separately', () => {
    // The trap: `season_standings.place` is the regular season, not the
    // bracket. In 2025 the man who placed first lost the final.
    const facts = seasonPreview(
      previewInput({
        history: history({
          seasons: [
            season(2025, { championManagerId: 2, runnerUpManagerId: 1 }),
            season(2026),
          ],
          standings: members.map((m) => ({
            season: 2025,
            managerId: m.managerId,
            place: m.managerId,
            wins: 9,
            losses: 5,
            ties: 0,
            pointsFor: 1800,
            pointsAgainst: 0,
            madePlayoffs: true,
            playoffWins: null,
            playoffLosses: null,
          })),
        }),
      }),
    )!
    expect(facts.lastSeason!.champion).toBe('M2')
    const first = facts.lastSeason!.standings.find((s) => s.regularSeasonPlace === 1)!
    expect(first.manager).toBe('M1')
    // The man who placed first is the runner-up, and the pack says so.
    expect(first.finish).toBe('runner-up')
  })

  it('knows nothing about the season it is previewing', () => {
    // `season_standings` is season-grain and the importer rewrites it wholesale,
    // so a row for 2026 would hold 2026's FINAL table. A preview that read its
    // own season's row would report a record for games nobody has played.
    // Completed seasons are fair game; this one is not.
    const facts = seasonPreview(
      previewInput({
        season: 2026,
        history: history({
          seasons: [season(2025), season(2026)],
          standings: [
            ...members.map((m) => ({
              season: 2025,
              managerId: m.managerId,
              place: m.managerId,
              wins: 9,
              losses: 5,
              ties: 0,
              pointsFor: 1800,
              pointsAgainst: 0,
              madePlayoffs: true,
              playoffWins: null,
              playoffLosses: null,
            })),
            // The season being previewed, with a sentinel nothing may read.
            ...members.map((m) => ({
              season: 2026,
              managerId: m.managerId,
              place: 1,
              wins: 9191,
              losses: 0,
              ties: 0,
              pointsFor: 91919,
              pointsAgainst: 0,
              madePlayoffs: true,
              playoffWins: null,
              playoffLosses: null,
            })),
          ],
        }),
      }),
    )!
    expect(JSON.stringify(facts)).not.toContain('9191')
    expect(facts.careers[0].record).toBe('9-5')
    // Nothing has been crossed, because nothing has been played.
    expect(facts.milestones.every((m) => !m.crossed)).toBe(true)
  })

  it('carries the notebook across the New Year', () => {
    const prior: PriorIssue[] = [
      {
        season: 2025,
        week: 14,
        headline: 'the last word',
        lens: null,
        columnText: 'the final column',
        threads: [{ id: 't', kind: 'callback', note: 'still owed' }],
        beltManagerId: null,
        statIds: [],
      },
    ]
    const facts = seasonPreview(previewInput({ priorIssues: prior }))!
    expect(facts.priorThreads).toEqual([{ id: 't', kind: 'callback', note: 'still owed' }])
    expect(facts.priorHeadlines).toEqual(['the last word'])
  })

  it('grounds its figures through the same generic walk as a week edition', () => {
    const facts = seasonPreview(previewInput())!
    expect(ungroundedNumbers('he paid $40 for the best of them', facts)).toEqual([])
    expect(ungroundedNumbers('he paid $4821 for the best of them', facts)).toHaveLength(1)
  })

  it('is recognised as a preview, and a week pack is not', () => {
    expect(isPreview(seasonPreview(previewInput())!)).toBe(true)
    // ⚠️ Every issue written before the preview existed has NO `kind` at all,
    // so the discriminant must be tested on 'preview' and never on 'week'.
    expect(isPreview(weekInReview(input({ week: 2 }))!)).toBe(false)
  })

  it('flags a real price hung on the wrong man', () => {
    const facts = seasonPreview(previewInput())!
    expect(misattributedNumbers('M2 paid 40.00 without blinking', facts).join()).toContain('M2')
    expect(misattributedNumbers('M1 paid 40.00 without blinking', facts)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Structural — properties a comment cannot enforce
// ---------------------------------------------------------------------------

describe('structural: nothing on a request path talks to a model', () => {
  const read = (p: string) => readFileSync(resolve(import.meta.dirname, p), 'utf8')

  it('the Gazette service performs no fetch', () => {
    // /history/gazette is a Server Component reading this file. The app's first
    // rule is that nothing on a request path makes an outbound call, and a
    // comment saying so is not enforcement -- reading the file is.
    expect(read('../server/gazette-service.ts')).not.toMatch(/\bfetch\(/)
  })

  it('the Gazette service never names the model provider', () => {
    expect(read('../server/gazette-service.ts')).not.toMatch(/anthropic/i)
  })

  it('the pure layer touches neither the database nor the network', () => {
    const lib = read('./gazette.ts')
    expect(lib).not.toMatch(/\bfetch\(/)
    expect(lib).not.toMatch(/from ['"].*server\//)
  })

  it('the draft service never imports the Gazette', () => {
    // Draft night polls /api/state several times a second. Nothing the Gazette
    // owns may end up on that path by way of an innocent-looking import.
    expect(read('../server/draft-service.ts')).not.toMatch(/gazette/i)
  })
})

describe('structural: a prompt cannot terminate its own template literal', () => {
  // PROGRESS_LOG records this exact failure twice: an inline backtick ends the
  // string and surfaces as two unrelated esbuild parse errors, nowhere near the
  // real problem. Every prompt file is checked, not just the first one — the
  // preview prompt tripped this guard the day it was written.
  it.each(['gazette-prompt.ts', 'gazette-preview-prompt.ts'])(
    '%s contains exactly two backticks, the template delimiters',
    (file) => {
      const src = readFileSync(resolve(import.meta.dirname, '../../scripts/history', file), 'utf8')
      expect((src.match(/`/g) ?? []).length).toBe(2)
    },
  )

  it('the two prompt versions cannot be confused for one another', () => {
    // Both are stored in the same `prompt_version` column. Separate ranges are
    // what makes a stored number identify the file that wrote it.
    expect(PREVIEW_PROMPT_VERSION).toBeGreaterThan(100)
    expect(PROMPT_VERSION).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// The committed archive
// ---------------------------------------------------------------------------

/**
 * The third run of the grounding gate, and the only one that guards `main`.
 *
 * The other two are the check inside the script before a write and
 * `npm run gazette -- --audit`, and both of them are things somebody has to
 * remember to run. This one is in the suite, so an issue whose prose quotes a
 * figure its own fact pack cannot account for fails CI.
 *
 * ⚠️ This is only possible because the pack is **snapshotted onto the issue**.
 * Re-deriving the tables at test time would check the prose against today's
 * database instead of against what was known at press time — which is the whole
 * argument for storing it, and would make this test go red every time a stat
 * correction landed.
 */
describe('the committed archive is grounded', () => {
  const dir = resolve(import.meta.dirname, '../../data/history/gazette')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []

  it('has issues committed to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s quotes no figure that is not in its own pack', (file) => {
    const parsed = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as {
      issues: Record<string, Record<string, never>>
    }
    const bad: string[] = []
    for (const entry of Object.values(parsed.issues)) {
      const prose = [
        entry.headline,
        entry.deck,
        entry.column,
        ...((entry.gameNotes as unknown as string[]) ?? []),
      ].join('\n')
      for (const flag of ungroundedNumbers(prose, entry.facts as unknown as GazetteFacts)) {
        bad.push(`${file} wk ${entry.week}: ${flag}`)
      }
    }
    expect(bad).toEqual([])
  })

  it.each(files)('%s carries no HTML markup into a field rendered as text', (file) => {
    // Every field is rendered as text and React escapes it, so an em tag the
    // model reached for arrives on the page as visible angle brackets. The
    // script strips these; this asserts the archive is actually clean.
    const parsed = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as {
      issues: Record<string, Record<string, never>>
    }
    const bad: string[] = []
    for (const entry of Object.values(parsed.issues)) {
      for (const field of ['headline', 'issueTitle', 'lens', 'deck', 'column'] as const) {
        const v = entry[field] as unknown
        if (typeof v === 'string' && /<\/?(?:em|i|b|strong|p|br|span|h[1-6])\s*\/?>/i.test(v)) {
          bad.push(`${file} wk ${entry.week}: ${field}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

describe('continuity', () => {
  it('hands the previous issue threads and the last two columns to the next one', () => {
    const prior: PriorIssue[] = [
      { season: 2025, week: 1, headline: 'one', lens: null, columnText: 'first', threads: [], beltManagerId: null, statIds: [] },
      {
        season: 2025,
        week: 2,
        headline: 'two',
        lens: null,
        columnText: 'second',
        threads: [{ id: 't', note: 'the running bit' }],
        beltManagerId: null,
        statIds: [],
      },
    ]
    const facts = weekInReview(input({ week: 3, priorIssues: prior }))!
    expect(facts.priorThreads).toEqual([{ id: 't', note: 'the running bit' }])
    expect(facts.priorColumns).toEqual(['first', 'second'])
    expect(facts.priorHeadlines).toEqual(['one', 'two'])
  })
})
