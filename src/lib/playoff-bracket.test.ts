import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HistoryMatchup } from './history'
import { managerIdForSleeperOwner, MANAGER_IDS } from './history-identity'
import { bracketGameId, playoffBracket, thirdPlaceGameId } from './playoff-bracket'
import type { BracketGame, PlayoffBracket } from './playoff-types'
import {
  pairWeek,
  playoffRound,
  type RawBracketGame,
  type RawLeague,
  type RawMatchup,
  type RawRoster,
} from './sleeper-history'

// ---------------------------------------------------------------------------
// The committed 2025 season as HistoryMatchup rows.
//
// Same path as scripts/import-sleeper-history.ts: `pairWeek` for the two-sided
// rows, the winners bracket to decide which playoff-week games are kept and
// what placement each carries (the final's `p: 1` is stored as null), and
// `managerIdForSleeperOwner` for roster -> manager. The script itself runs
// `main()` on import, so its dozen lines of tagging are repeated here.
// ---------------------------------------------------------------------------

const DATA = join(process.cwd(), 'data', 'sleeper')

function loadSeason(season: number) {
  const dir = join(DATA, String(season))
  const read = <T,>(file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T
  const league = read<RawLeague>('league.json')
  const rosters = read<RawRoster[]>('rosters.json')
  const bracket = read<RawBracketGame[]>('winners_bracket.json')
  const playoffStart = league.settings.playoff_week_start ?? 15

  const owner = new Map(rosters.map((r) => [r.roster_id, managerIdForSleeperOwner(r.owner_id)]))
  const mgr = (rosterId: number) => owner.get(rosterId)!

  const inBracket = new Map<number, Set<number>>()
  const placementOf = new Map<string, number | null>()
  for (const g of bracket) {
    if (g.t1 == null || g.t2 == null) continue
    const week = playoffStart + (g.r - 1)
    const set = inBracket.get(week) ?? new Set<number>()
    set.add(g.t1).add(g.t2)
    inBracket.set(week, set)
    const placement = g.p && g.p > 1 ? g.p : null
    placementOf.set(`${week}:${g.t1}`, placement)
    placementOf.set(`${week}:${g.t2}`, placement)
  }

  const matchups: HistoryMatchup[] = []
  for (let week = 1; week <= playoffStart + 2; week++) {
    const file = join(dir, `matchups-${String(week).padStart(2, '0')}.json`)
    if (!existsSync(file)) continue
    const entries = JSON.parse(readFileSync(file, 'utf8')) as RawMatchup[]
    const isPlayoff = week >= playoffStart
    for (const side of pairWeek(week, entries)) {
      if (isPlayoff) {
        const set = inBracket.get(week)
        if (!set?.has(side.rosterId) || !set.has(side.opponentRosterId)) continue
      }
      matchups.push({
        season,
        week,
        managerId: mgr(side.rosterId),
        points: side.points,
        opponentManagerId: mgr(side.opponentRosterId),
        opponentPoints: side.opponentPoints,
        isPlayoff,
        playoffRound: isPlayoff ? playoffRound(week, playoffStart) : null,
        playoffPlacement: isPlayoff ? (placementOf.get(`${week}:${side.rosterId}`) ?? null) : null,
        result: side.result,
      })
    }
  }

  return {
    matchups,
    bracket,
    mgr,
    regularSeasonWeeks: playoffStart - 1,
    playoffTeams: league.settings.playoff_teams ?? 6,
  }
}

// Widened to number: the literal types make every Map and includes() below fight the compiler.
const { GABES, BILL, MARIO, JACK, BRYAN, JUSTIN }: Record<string, number> = MANAGER_IDS

const s2025 = loadSeason(2025)

/** 2025 as the page would hand it over when showing `week`: truncated, never past it. */
function through(week: number, rows: HistoryMatchup[] = s2025.matchups) {
  return rows.filter((m) => m.week <= week)
}

function bracketAt(week: number, rows?: HistoryMatchup[]) {
  return playoffBracket({
    season: 2025,
    matchups: through(week, rows),
    playoffTeams: 6,
    regularSeasonWeeks: 14,
  })
}

function game(b: PlayoffBracket, id: string): BracketGame {
  const g = b.rounds.flat().find((x) => x.id === id)
  if (!g) throw new Error(`no game ${id}`)
  return g
}

/** Every drawn game in Sleeper's winners bracket is in ours, same pair, same winner. */
function expectAgreesWithSleeper(b: PlayoffBracket, s: ReturnType<typeof loadSeason>) {
  const drawn = s.bracket.filter((g) => g.p !== 5)
  expect(b.rounds.flat()).toHaveLength(drawn.length)
  for (const raw of drawn) {
    const pair = [s.mgr(raw.t1!), s.mgr(raw.t2!)].sort((x, y) => x - y)
    const placement = raw.p === 3 ? 3 : null
    const ours = b.rounds[raw.r - 1].find(
      (g) =>
        g.placement === placement &&
        [g.a.managerId!, g.b.managerId!].sort((x, y) => x - y).join() === pair.join(),
    )
    expect(ours, `bracket game m${raw.m}`).toBeDefined()
    expect(ours!.status).toBe('played')
    expect(ours!.winnerManagerId).toBe(s.mgr(raw.w!))
  }
  const final = s.bracket.find((g) => g.p === 1)!
  expect(b.championManagerId).toBe(s.mgr(final.w!))
}

/** [a manager, a points, b manager, b points, status, winner] */
const line = (g: BracketGame) => [g.a.managerId, g.a.points, g.b.managerId, g.b.points, g.status, g.winnerManagerId]

describe('the 2025 fixture', () => {
  it('is the season the roadmap checked: ids, settings and row counts', () => {
    expect(s2025.regularSeasonWeeks).toBe(14)
    expect(s2025.playoffTeams).toBe(6)
    expect([GABES, BILL, MARIO, JACK, BRYAN, JUSTIN]).toEqual([1, 4, 7, 8, 9, 10])

    const count = (week: number, placement: number | null) =>
      s2025.matchups.filter((m) => m.week === week && m.playoffPlacement === placement).length
    for (let w = 1; w <= 14; w++) expect(count(w, null)).toBe(10)
    expect(count(15, null)).toBe(4)
    expect(count(16, null)).toBe(4)
    expect(count(16, 5)).toBe(2) // the fifth-place game is in the SEMI-FINAL week
    expect(count(17, null)).toBe(2) // the final, stored with placement null
    expect(count(17, 3)).toBe(2)
  })
})

describe('playoffBracket, 2025 week by week', () => {
  it('week 13: null, the regular season is not finished', () => {
    expect(bracketAt(13)).toBeNull()
  })

  it('is null when a regular-season week is only partly on record', () => {
    // Week 14 with one game missing: completeWeeks() does not count it.
    const rows = through(14).filter((m) => !(m.week === 14 && (m.managerId === JACK || m.opponentManagerId === JACK)))
    expect(bracketAt(14, rows)).toBeNull()
    // And a hole in the middle is no better than one at the end.
    expect(bracketAt(17, s2025.matchups.filter((m) => m.week !== 6))).toBeNull()
  })

  it('week 14: seeds and byes, round one pending, everything later waiting', () => {
    const b = bracketAt(14)!
    expect(b.season).toBe(2025)
    expect(b.teams.map((t) => [t.seed, t.managerId])).toEqual([
      [1, JACK], [2, GABES], [3, MARIO], [4, JUSTIN], [5, BILL], [6, BRYAN],
    ])
    expect(b.teams.map((t) => [t.wins, t.losses, t.ties, t.pointsFor])).toEqual([
      [9, 5, 0, 1820.38], [9, 5, 0, 1795.42], [8, 6, 0, 1976.78],
      [8, 6, 0, 1799.42], [7, 7, 0, 1826.74], [7, 7, 0, 1785.66],
    ])
    expect(b.byes).toEqual([JACK, GABES])
    expect(b.throughWeek).toBe(14)
    expect(b.currentRound).toBe(1)
    expect(b.alive).toEqual([JACK, GABES, MARIO, JUSTIN, BILL, BRYAN])
    expect(b.championManagerId).toBeNull()

    expect(b.rounds.map((r) => r.map((g) => g.id))).toEqual([
      ['r1-g1', 'r1-g2'],
      ['r2-g1', 'r2-g2'],
      ['r3-g1', 'r3-third'],
    ])
    expect(b.rounds.flat().map((g) => [g.round, g.week, g.placement])).toEqual([
      [1, 15, null], [1, 15, null], [2, 16, null], [2, 16, null], [3, 17, null], [3, 17, 3],
    ])

    // Round one: 4 v 5 and 3 v 6, both known, no score.
    expect(line(game(b, 'r1-g1'))).toEqual([JUSTIN, null, BILL, null, 'pending', null])
    expect(line(game(b, 'r1-g2'))).toEqual([MARIO, null, BRYAN, null, 'pending', null])
    expect(game(b, 'r1-g1').a).toEqual({ managerId: JUSTIN, seed: 4, points: null, winnerOf: null })

    // Round two: the bye team is known, the other side is "winner of".
    expect(game(b, 'r2-g1').a).toEqual({ managerId: JACK, seed: 1, points: null, winnerOf: null })
    expect(game(b, 'r2-g1').b).toEqual({ managerId: null, seed: null, points: null, winnerOf: [4, 5] })
    expect(game(b, 'r2-g2').a).toEqual({ managerId: GABES, seed: 2, points: null, winnerOf: null })
    expect(game(b, 'r2-g2').b).toEqual({ managerId: null, seed: null, points: null, winnerOf: [3, 6] })

    // The final and the third-place game: the range of each half.
    for (const id of ['r3-g1', 'r3-third']) {
      expect(game(b, id).a.winnerOf).toEqual([1, 5])
      expect(game(b, id).b.winnerOf).toEqual([2, 6])
      expect(game(b, id).a.managerId).toBeNull()
    }
    expect(b.rounds.flat().slice(2).every((g) => g.status === 'waiting')).toBe(true)
  })

  it('week 15: round one scored, winners advanced, semi-finals pending', () => {
    const b = bracketAt(15)!
    expect(line(game(b, 'r1-g1'))).toEqual([JUSTIN, 129.7, BILL, 138.54, 'played', BILL])
    expect(line(game(b, 'r1-g2'))).toEqual([MARIO, 118.68, BRYAN, 133.12, 'played', BRYAN])

    expect(line(game(b, 'r2-g1'))).toEqual([JACK, null, BILL, null, 'pending', null])
    expect(line(game(b, 'r2-g2'))).toEqual([GABES, null, BRYAN, null, 'pending', null])
    expect(game(b, 'r2-g1').b).toEqual({ managerId: BILL, seed: 5, points: null, winnerOf: null })

    // Now exactly the two seeds in each semi-final.
    expect(game(b, 'r3-g1').a.winnerOf).toEqual([1, 5])
    expect(game(b, 'r3-g1').b.winnerOf).toEqual([2, 6])
    expect(game(b, 'r3-g1').status).toBe('waiting')
    expect(game(b, 'r3-third').status).toBe('waiting')

    expect(b.throughWeek).toBe(15)
    expect(b.currentRound).toBe(2)
    expect(b.alive).toEqual([JACK, GABES, BILL, BRYAN])
    expect(b.championManagerId).toBeNull()
    // Seeds and byes do not move once the playoffs start.
    expect(b.teams).toEqual(bracketAt(14)!.teams)
    expect(b.byes).toEqual([JACK, GABES])
  })

  it('week 16: semi-finals scored, the fifth-place game ignored, final and third place pending', () => {
    const b = bracketAt(16)!
    expect(line(game(b, 'r2-g1'))).toEqual([JACK, 135.5, BILL, 117.64, 'played', JACK])
    expect(line(game(b, 'r2-g2'))).toEqual([GABES, 142.8, BRYAN, 128.28, 'played', GABES])

    expect(line(game(b, 'r3-g1'))).toEqual([JACK, null, GABES, null, 'pending', null])
    expect(line(game(b, 'r3-third'))).toEqual([BILL, null, BRYAN, null, 'pending', null])
    expect(game(b, 'r3-third').a).toEqual({ managerId: BILL, seed: 5, points: null, winnerOf: null })

    expect(b.throughWeek).toBe(16)
    expect(b.currentRound).toBe(3)
    expect(b.alive).toEqual([JACK, GABES])
    expect(b.championManagerId).toBeNull()

    // Mario v Justin for fifth is on record in week 16 and appears nowhere.
    expect(through(16).some((m) => m.week === 16 && m.playoffPlacement === 5 && m.managerId === MARIO)).toBe(true)
    expect(b.rounds[1]).toHaveLength(2)
  })

  it('week 17: the champion and the third-place result', () => {
    const b = bracketAt(17)!
    expect(line(game(b, 'r3-g1'))).toEqual([JACK, 95.9, GABES, 127.28, 'played', GABES])
    expect(line(game(b, 'r3-third'))).toEqual([BILL, 135.06, BRYAN, 90.74, 'played', BILL])
    expect(game(b, 'r3-third').placement).toBe(3)
    expect(b.championManagerId).toBe(GABES)
    expect(b.alive).toEqual([GABES])
    expect(b.currentRound).toBeNull()
    expect(b.throughWeek).toBe(17)
    expect(b.rounds.flat().every((g) => g.status === 'played')).toBe(true)
  })

  it('agrees with winners_bracket.json, game for game', () => {
    expect(s2025.bracket.filter((g) => g.p !== 5)).toHaveLength(6)
    expectAgreesWithSleeper(bracketAt(17)!, s2025)
  })

  it('ids come from the exported helpers', () => {
    expect(bracketGameId(2, 1)).toBe('r2-g1')
    expect(thirdPlaceGameId(3)).toBe('r3-third')
  })
})

describe('playoffBracket reads only its own season, and only what it is given', () => {
  it('ignores other seasons in the same array', () => {
    const other = s2025.matchups.map((m) => ({
      ...m,
      season: 2024,
      // A different year with different results: every game reversed.
      points: m.opponentPoints,
      opponentPoints: m.points,
      result: (m.result === 'W' ? 'L' : m.result === 'L' ? 'W' : 'T') as HistoryMatchup['result'],
    }))
    for (const week of [14, 15, 16, 17]) {
      expect(bracketAt(week, [...other, ...s2025.matchups])).toEqual(bracketAt(week))
    }
    expect(playoffBracket({ season: 2023, matchups: s2025.matchups, playoffTeams: 6, regularSeasonWeeks: 14 })).toBeNull()
  })

  it('one game of a round on record: that game is played, the other still pending', () => {
    const rows = through(15).filter((m) => !(m.week === 15 && [MARIO, BRYAN].includes(m.managerId)))
    const b = bracketAt(15, rows)!
    expect(game(b, 'r1-g1').status).toBe('played')
    expect(game(b, 'r1-g2').status).toBe('pending')
    expect(game(b, 'r2-g1').status).toBe('pending')
    expect(game(b, 'r2-g2').status).toBe('waiting')
    expect(b.currentRound).toBe(1)
    expect(b.throughWeek).toBe(15)
    expect(b.alive).toEqual([JACK, GABES, MARIO, BILL, BRYAN])
  })
})

describe('a stored row that contradicts the derived bracket draws nothing', () => {
  const rewrite = (fn: (m: HistoryMatchup) => HistoryMatchup | null) =>
    s2025.matchups.map(fn).filter((m): m is HistoryMatchup => m !== null)

  it('wrong opponents in round one (a re-drawn 4 v 6 and 3 v 5)', () => {
    const swap = new Map([[BILL, BRYAN], [BRYAN, BILL]])
    const rows = rewrite((m) =>
      m.week === 15
        ? { ...m, managerId: swap.get(m.managerId) ?? m.managerId, opponentManagerId: swap.get(m.opponentManagerId) ?? m.opponentManagerId }
        : m,
    )
    expect(bracketAt(15, rows)).toBeNull()
  })

  it('a re-seeded semi-final: the top seed against the 6 instead of the 4-5 winner', () => {
    const swap = new Map([[BILL, BRYAN], [BRYAN, BILL]])
    const rows = rewrite((m) =>
      m.week === 16 && m.playoffPlacement === null
        ? { ...m, managerId: swap.get(m.managerId) ?? m.managerId, opponentManagerId: swap.get(m.opponentManagerId) ?? m.opponentManagerId }
        : m,
    )
    expect(bracketAt(15, rows)).not.toBeNull() // the contradiction is not visible yet
    expect(bracketAt(16, rows)).toBeNull()
  })

  it('a team that should not be playing: the fifth-place game stored on the championship path', () => {
    const rows = rewrite((m) => (m.playoffPlacement === 5 ? { ...m, playoffPlacement: null } : m))
    expect(bracketAt(16, rows)).toBeNull()
  })

  it('a tie has no winner to advance', () => {
    const rows = rewrite((m) =>
      m.week === 15 && [JUSTIN, BILL].includes(m.managerId)
        ? { ...m, points: 120, opponentPoints: 120, result: 'T' }
        : m,
    )
    expect(bracketAt(15, rows)).toBeNull()
  })

  it('a round on record before the game that feeds it', () => {
    // Week 15 never arrived, week 16 did.
    expect(bracketAt(16, s2025.matchups.filter((m) => m.week !== 15))).toBeNull()
  })

  it('half a game: one of its two rows', () => {
    const rows = rewrite((m) => (m.week === 15 && m.managerId === BILL ? null : m))
    expect(bracketAt(15, rows)).toBeNull()
  })

  it('two rows that tell different stories', () => {
    const rows = rewrite((m) => (m.week === 15 && m.managerId === BILL ? { ...m, opponentPoints: 150, result: 'L' } : m))
    expect(bracketAt(15, rows)).toBeNull()
  })

  it('the final stored as the third-place game', () => {
    const rows = rewrite((m) => (m.week === 17 ? { ...m, playoffPlacement: m.playoffPlacement === 3 ? null : 3 } : m))
    expect(bracketAt(17, rows)).toBeNull()
  })

  it('settings that do not fit the rows', () => {
    const at = (playoffTeams: number, regularSeasonWeeks: number) =>
      playoffBracket({ season: 2025, matchups: s2025.matchups, playoffTeams, regularSeasonWeeks })
    expect(at(6, 13)).toBeNull() // week 14 is not a playoff week
    expect(at(6, 15)).toBeNull() // week 15 is
    expect(at(4, 14)).toBeNull() // seeds 5 and 6 played in week 15; a four-team field has no such game
    expect(at(1, 14)).toBeNull()
    expect(at(11, 14)).toBeNull()
  })
})

describe('seeding and shape beyond 2025', () => {
  /** A round robin's worth of rows where results are handed in directly. */
  function season(records: Array<{ id: number; wins: number; points: number }>, weeks: number): HistoryMatchup[] {
    // Pair 1v2, 3v4, ... every week. A team "wins" its first `wins` weeks; the
    // partner's result is forced to match the row, which is all seeding reads.
    const rows: HistoryMatchup[] = []
    for (let week = 1; week <= weeks; week++) {
      for (const [i, r] of records.entries()) {
        const opp = records[i % 2 === 0 ? i + 1 : i - 1]
        rows.push({
          season: 2030, week, managerId: r.id, points: r.points, opponentManagerId: opp.id,
          opponentPoints: opp.points, isPlayoff: false, playoffRound: null, playoffPlacement: null,
          result: week <= r.wins ? 'W' : 'L',
        })
      }
    }
    return rows
  }

  it('breaks wins by points for, then by manager id', () => {
    const rows = season(
      [
        { id: 5, wins: 2, points: 100 },
        { id: 3, wins: 2, points: 100 }, // level with 5 on both: lower id first
        { id: 9, wins: 2, points: 110 }, // more points: ahead of both
        { id: 1, wins: 1, points: 200 }, // fewer wins: behind, whatever the points
      ],
      2,
    )
    const b = playoffBracket({ season: 2030, matchups: rows, playoffTeams: 4, regularSeasonWeeks: 2 })!
    expect(b.teams.map((t) => t.managerId)).toEqual([9, 3, 5, 1])
    expect(b.teams.map((t) => t.pointsFor)).toEqual([220, 200, 200, 400])
    // Four teams: no byes, 1 v 4 and 2 v 3, then a final and a third-place game.
    expect(b.byes).toEqual([])
    expect(b.rounds.map((r) => r.map((g) => [g.id, g.a.seed, g.b.seed, g.status]))).toEqual([
      [['r1-g1', 1, 4, 'pending'], ['r1-g2', 2, 3, 'pending']],
      [['r2-g1', null, null, 'waiting'], ['r2-third', null, null, 'waiting']],
    ])
    expect(b.rounds[1][0].a.winnerOf).toEqual([1, 4])
    expect(b.rounds[1][0].b.winnerOf).toEqual([2, 3])
  })

  it('a two-team field is one game and no third-place game', () => {
    const rows = season([{ id: 1, wins: 2, points: 100 }, { id: 2, wins: 0, points: 90 }], 2)
    const b = playoffBracket({ season: 2030, matchups: rows, playoffTeams: 2, regularSeasonWeeks: 2 })!
    expect(b.rounds).toHaveLength(1)
    expect(b.rounds[0].map((g) => g.id)).toEqual(['r1-g1'])
  })
})

describe('every Sleeper season on record', () => {
  // Not required by the step, and the strongest evidence in the file: the
  // derivation was written against 2025 and never tuned to the other five.
  // 2020 is the odd one, with thirteen regular-season weeks and round one in 14.
  for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
    it(`${year}: wins-then-points seeding and the fixed bracket reproduce Sleeper's bracket`, () => {
      const s = loadSeason(year)
      const b = playoffBracket({
        season: year,
        matchups: s.matchups,
        playoffTeams: s.playoffTeams,
        regularSeasonWeeks: s.regularSeasonWeeks,
      })
      expect(b).not.toBeNull()
      expectAgreesWithSleeper(b!, s)
      expect(b!.currentRound).toBeNull()
      expect(b!.throughWeek).toBe(s.regularSeasonWeeks + 3)
    })
  }

  it('2020 ran thirteen regular-season weeks, so nothing here may assume fourteen', () => {
    expect(loadSeason(2020).regularSeasonWeeks).toBe(13)
  })
})
