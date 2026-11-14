import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isCountedPlayoff, type HistoryMatchup, type HistorySeason, type HistoryStanding } from './history'
import { MANAGER_IDS, MEMBERS, managerIdForMemberId, managerIdForSleeperOwner } from './history-identity'
import { pairContext, playoffMeetingsSince, teamContext, type ChampionListing } from './playoff-context'
import type { BracketGame, BracketSide, PlayoffBracket } from './playoff-types'
import {
  isScoredWeek,
  pairWeek,
  playoffRound,
  podiumFromBracket,
  standings as sleeperStandings,
  type RawBracketGame,
  type RawLeague,
  type RawMatchup,
  type RawRoster,
} from './sleeper-history'

// ---------------------------------------------------------------------------
// The committed history, read the way the importers write it
// ---------------------------------------------------------------------------
//
// No database. `data/sleeper/<year>/` and `data/history/*.csv` are the sources
// `scripts/import-sleeper-history.ts` and `scripts/import-workbook-history.ts`
// load into Postgres, and this follows them through the same pure helpers
// (`pairWeek`, `podiumFromBracket`, `playoffRound`, `standings`), so the rows
// below are the rows `getHistoryInput()` returns.

const DATA = resolve(import.meta.dirname, '../../data')
const { GABES, BILL, DANIEL, NATE, MARIO, JACK, BRYAN, JUSTIN, BOLEK, GROSSMAN } = MANAGER_IDS

function json<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(resolve(DATA, ...parts), 'utf8')) as T
}

function csv(name: string): Array<Record<string, string>> {
  const [header, ...lines] = readFileSync(resolve(DATA, 'history', `${name}.csv`), 'utf8').trim().split('\n')
  const cols = header.trim().split(',')
  return lines.map((line) => {
    const cells = line.trim().split(',')
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]))
  })
}

const seasonRow = (season: number, podium: Partial<HistorySeason> = {}): HistorySeason => ({
  season,
  dataTier: season < 2011 ? 'legacy' : season < 2020 ? 'standings' : 'weekly',
  regularSeasonWeeks: null,
  championManagerId: null,
  runnerUpManagerId: null,
  thirdManagerId: null,
  championPrize: null,
  runnerUpPrize: null,
  thirdPrize: null,
  buyIn: null,
  draftCity: null,
  draftState: null,
  ...podium,
})

// `managers.display_name`, from scripts/seed.ts: the app name for every seat
// but the co-managed one.
const members = MEMBERS.map((m) => ({
  managerId: m.managerId,
  displayName: m.appName === 'Grossman' ? 'Eric/Blakey' : m.appName,
}))
const displayName = (managerId: number) => members.find((m) => m.managerId === managerId)!.displayName

function load() {
  const matchups: HistoryMatchup[] = []
  const standings: HistoryStanding[] = []
  const seasons = new Map<number, HistorySeason>()

  // --- the Sleeper years: every game ---------------------------------------
  const sleeperYears = readdirSync(resolve(DATA, 'sleeper')).filter((d) => /^\d{4}$/.test(d)).map(Number).sort()
  for (const season of sleeperYears) {
    const dir = ['sleeper', String(season)]
    const league = json<RawLeague>(...dir, 'league.json')
    const rosters = json<RawRoster[]>(...dir, 'rosters.json')
    const bracket = json<RawBracketGame[]>(...dir, 'winners_bracket.json')
    const playoffStart = league.settings.playoff_week_start ?? 15
    const mgr = new Map(rosters.map((r) => [r.roster_id, managerIdForSleeperOwner(r.owner_id)]))

    const podium = podiumFromBracket(bracket)
    seasons.set(season, seasonRow(season, {
      regularSeasonWeeks: playoffStart - 1,
      championManagerId: podium.championRosterId ? mgr.get(podium.championRosterId)! : null,
      runnerUpManagerId: podium.runnerUpRosterId ? mgr.get(podium.runnerUpRosterId)! : null,
      thirdManagerId: podium.thirdRosterId ? mgr.get(podium.thirdRosterId)! : null,
    }))

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

    const inPlayoffs = new Set<number>()
    for (let week = 1; week <= playoffStart + 2; week++) {
      const file = resolve(DATA, ...dir, `matchups-${String(week).padStart(2, '0')}.json`)
      if (!existsSync(file)) continue
      const entries = JSON.parse(readFileSync(file, 'utf8')) as RawMatchup[]
      if (!isScoredWeek(week, entries, league.settings.last_scored_leg)) continue
      const isPlayoff = week >= playoffStart
      for (const side of pairWeek(week, entries)) {
        if (isPlayoff) {
          const set = inBracket.get(week)
          if (!set?.has(side.rosterId) || !set.has(side.opponentRosterId)) continue
        }
        const row: HistoryMatchup = {
          season,
          week,
          managerId: mgr.get(side.rosterId)!,
          points: side.points,
          opponentManagerId: mgr.get(side.opponentRosterId)!,
          opponentPoints: side.opponentPoints,
          isPlayoff,
          playoffRound: isPlayoff ? playoffRound(week, playoffStart) : null,
          playoffPlacement: isPlayoff ? (placementOf.get(`${week}:${side.rosterId}`) ?? null) : null,
          result: side.result,
        }
        matchups.push(row)
        if (isCountedPlayoff(row)) inPlayoffs.add(row.managerId)
      }
    }

    for (const row of sleeperStandings(rosters)) {
      const managerId = mgr.get(row.rosterId)!
      standings.push({
        season, managerId, place: row.place, wins: row.wins, losses: row.losses, ties: row.ties,
        pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst,
        madePlayoffs: inPlayoffs.has(managerId), playoffWins: null, playoffLosses: null,
      })
    }
  }

  // --- the workbook years: standings and a podium --------------------------
  const playoffYears = new Set(
    csv('playoffs_legacy').map((r) => `${r.playoff_year}:${managerIdForMemberId(Number(r.member_id))}`),
  )
  for (const r of csv('regular_season')) {
    const season = Number(r.reg_season_year)
    if (season >= sleeperYears[0]) continue
    const managerId = managerIdForMemberId(Number(r.member_id))
    standings.push({
      season, managerId, place: Number(r.reg_season_place),
      wins: Number(r.reg_season_wins), losses: Number(r.reg_season_losses), ties: 0,
      pointsFor: Number(r.points_for), pointsAgainst: Number(r.points_against),
      madePlayoffs: playoffYears.has(`${season}:${managerId}`), playoffWins: null, playoffLosses: null,
    })
  }
  for (const r of csv('win_history')) {
    const season = Number(r.championship_year)
    const managerId = managerIdForMemberId(Number(r.member_id))
    const row = seasons.get(season) ?? seasonRow(season)
    // COALESCE, as the workbook importer does: Sleeper's podium wins where both exist.
    if (r.place === '1') row.championManagerId ??= managerId
    if (r.place === '2') row.runnerUpManagerId ??= managerId
    if (r.place === '3') row.thirdManagerId ??= managerId
    seasons.set(season, row)
  }

  // --- 2006-2010: a champion's name and nothing else ------------------------
  // Left WITHOUT a `championManagerId`, which is the name-only shape the
  // contract and `SeasonListing` describe and the case `teamContext` has to
  // survive. (A database whose importer resolved those names to ids hands over
  // the same display name through the same COALESCE, so both shapes count alike.)
  const legacyNames = new Map(csv('legacy_champions').map((r) => [Number(r.championship_year), r.member]))
  for (const season of legacyNames.keys()) seasons.set(season, seasonRow(season))

  const seasonList = [...seasons.values()].sort((a, b) => a.season - b.season)

  // `listHistorySeasons()`: COALESCE(m.display_name, lc.champion_name).
  const champions: ChampionListing[] = seasonList.map((s) => ({
    season: s.season,
    champion: s.championManagerId !== null ? displayName(s.championManagerId) : (legacyNames.get(s.season) ?? null),
  }))

  return { matchups, standings, seasons: seasonList, champions }
}

const history = load()

// ---------------------------------------------------------------------------
// A hand-built bracket (the real derivation is step 87)
// ---------------------------------------------------------------------------

const known = (managerId: number, seed: number): BracketSide => ({ managerId, seed, points: null, winnerOf: null })
const waitingOn = (a: number, b: number): BracketSide => ({ managerId: null, seed: null, points: null, winnerOf: [a, b] })

function game(id: string, round: number, a: BracketSide, b: BracketSide, placement: null | 3 = null): BracketGame {
  const ready = a.managerId !== null && b.managerId !== null
  return { id, round, week: 14 + round, placement, a, b, status: ready ? 'pending' : 'waiting', winnerManagerId: null }
}

function bracket(over: Partial<PlayoffBracket> & Pick<PlayoffBracket, 'rounds'>): PlayoffBracket {
  return {
    season: 2025,
    teams: [],
    byes: [JACK, GABES],
    throughWeek: 14,
    currentRound: 1,
    alive: [],
    championManagerId: null,
    ...over,
  }
}

// 2025 as it stood: seeds Jack 1, Gabes 2, Mario 3, Justin 4, Bill 5, Bryan 6.
const roundOne = [game('r1-g1', 1, known(JUSTIN, 4), known(BILL, 5)), game('r1-g2', 1, known(MARIO, 3), known(BRYAN, 6))]
const after14 = bracket({
  rounds: [
    roundOne,
    [game('r2-g1', 2, known(JACK, 1), waitingOn(4, 5)), game('r2-g2', 2, known(GABES, 2), waitingOn(3, 6))],
    [game('r3-g1', 3, waitingOn(1, 4), waitingOn(2, 3)), game('r3-third', 3, waitingOn(1, 4), waitingOn(2, 3), 3)],
  ],
})
const after15 = bracket({
  throughWeek: 15,
  currentRound: 2,
  rounds: [
    roundOne,
    [game('r2-g1', 2, known(JACK, 1), known(BILL, 5)), game('r2-g2', 2, known(GABES, 2), known(BRYAN, 6))],
    [game('r3-g1', 3, waitingOn(1, 5), waitingOn(2, 6)), game('r3-third', 3, waitingOn(1, 5), waitingOn(2, 6), 3)],
  ],
})
const after16 = bracket({
  throughWeek: 16,
  currentRound: 3,
  rounds: [
    roundOne,
    after15.rounds[1],
    [game('r3-g1', 3, known(JACK, 1), known(GABES, 2)), game('r3-third', 3, known(BILL, 5), known(BRYAN, 6), 3)],
  ],
})

const byId = (rows: ReturnType<typeof teamContext>, managerId: number) => rows.find((r) => r.managerId === managerId)!
const teams = (season: number) => teamContext({ season, members, ...history })
const pairs = (b: PlayoffBracket, matchups = history.matchups) => pairContext({ bracket: b, matchups })
const pair = (b: PlayoffBracket, gameId: string) => pairs(b).find((p) => p.gameId === gameId)!

describe('the committed history loads', () => {
  it('has every season from 2006 and both rows of every game', () => {
    expect(history.seasons[0].season).toBe(2006)
    expect(history.seasons.map((s) => s.season)).toContain(2025)
    // Two rows a game, so an odd count means a side went missing in the loader.
    expect(history.matchups.length % 2).toBe(0)
    expect(history.matchups.filter((m) => m.season === 2025 && m.week === 17)).toHaveLength(4)
    // The premise of the name-only tests: 2006-2010 carry no manager id.
    for (const s of history.seasons.filter((x) => x.season <= 2010)) expect(s.championManagerId).toBeNull()
  })
})

describe('teamContext', () => {
  it('returns one row per member, in member order', () => {
    expect(teams(2026).map((t) => t.managerId)).toEqual(members.map((m) => m.managerId))
  })

  it('counts the 2006-2010 name-only titles', () => {
    const t = teams(2026)
    // Bryan: 2007 and 2009 by name alone, then 2015, 2017, 2019.
    expect(byId(t, BRYAN).titles).toBe(5)
    // Daniel: 2006 and 2008 by name alone, then 2020 and 2021.
    expect(byId(t, DANIEL).titles).toBe(4)
    // Justin: 2010 by name alone, then 2018.
    expect(byId(t, JUSTIN).titles).toBe(2)
  })

  it('would lose those titles if it counted on the manager id', () => {
    const byManagerId = (id: number) => history.seasons.filter((s) => s.championManagerId === id).length
    expect(byManagerId(BRYAN)).toBe(3)
    expect(byManagerId(DANIEL)).toBe(2)
    expect(byManagerId(JUSTIN)).toBe(1)
  })

  it('counts the co-managed seat under its display name, not its app name', () => {
    // 2014, on record as "Eric + Mark"; the listing says "Eric/Blakey".
    expect(byId(teams(2026), GROSSMAN).titles).toBe(1)
  })

  it('accounts for every title on record exactly once', () => {
    const total = teams(2026).reduce((n, t) => n + t.titles, 0)
    expect(total).toBe(history.champions.filter((c) => c.season < 2026 && c.champion !== null).length)
    expect(total).toBe(20)
  })

  it('leaves the season being shown out of titles, appearances and the last final', () => {
    // Gabes won 2025 and Jack lost that final. A 2025 preview must not know.
    const shown = teams(2025)
    expect(byId(shown, GABES)).toMatchObject({ titles: 0, lastFinal: { season: 2023, won: false } })
    expect(byId(shown, JACK).lastFinal).toEqual({ season: 2021, won: false })

    const after = teams(2026)
    expect(byId(after, GABES)).toMatchObject({ titles: 1, lastFinal: { season: 2025, won: true } })
    expect(byId(after, JACK).lastFinal).toEqual({ season: 2025, won: false })

    // All six 2025 playoff teams gain exactly one appearance once 2025 is history, nobody else any.
    const field = [JACK, GABES, MARIO, JUSTIN, BILL, BRYAN] as number[]
    for (const m of members) {
      const gained = byId(after, m.managerId).playoffAppearances - byId(shown, m.managerId).playoffAppearances
      expect(gained, m.displayName).toBe(field.includes(m.managerId) ? 1 : 0)
    }
  })

  it('leaves later seasons out as well', () => {
    // Shown 2020: Daniel had 2006 and 2008 and a lost 2019 final, though he then won 2020 and 2021.
    const t = teams(2020)
    expect(byId(t, DANIEL)).toMatchObject({ titles: 2, lastFinal: { season: 2019, won: false } })
    expect(byId(t, NATE)).toMatchObject({ titles: 0, lastFinal: null })
    // Bolek won 2011 and lost the 2020 final: only the first is earlier.
    expect(byId(t, BOLEK).lastFinal).toEqual({ season: 2011, won: true })
  })

  it('reads a name-only title as a won final when nothing later is on record', () => {
    // Shown 2011: the record is five names and no runner-up anywhere.
    const t = teams(2011)
    expect(byId(t, BRYAN)).toMatchObject({ titles: 2, lastFinal: { season: 2009, won: true } })
    expect(byId(t, DANIEL).lastFinal).toEqual({ season: 2008, won: true })
    expect(byId(t, JUSTIN).lastFinal).toEqual({ season: 2010, won: true })
    // Nobody else has a final on record, which is not the same as never having played one.
    for (const id of [GABES, GROSSMAN, BOLEK, BILL, NATE, MARIO, JACK]) expect(byId(t, id).lastFinal).toBeNull()
    // And no standings before 2011, so no appearances to count.
    expect(t.every((x) => x.playoffAppearances === 0)).toBe(true)
  })

  it('takes a losing final over an older title', () => {
    // Bill won 2016, then lost the 2022 final.
    expect(byId(teams(2026), BILL)).toMatchObject({ titles: 1, lastFinal: { season: 2022, won: false } })
  })

  it('counts appearances from madePlayoffs alone', () => {
    const t = teamContext({
      season: 2026,
      members: [{ managerId: 1, displayName: 'A' }],
      champions: [],
      seasons: [],
      standings: [
        { season: 2023, managerId: 1, madePlayoffs: true },
        { season: 2024, managerId: 1, madePlayoffs: false },
        { season: 2025, managerId: 1, madePlayoffs: true },
        { season: 2026, managerId: 1, madePlayoffs: true }, // the shown season
        { season: 2025, managerId: 2, madePlayoffs: true }, // somebody else
      ],
    })
    expect(t).toEqual([{ managerId: 1, titles: 0, playoffAppearances: 2, lastFinal: null }])
  })

  it('gives the same answer when the legacy champions carry a manager id', () => {
    // The workbook importer resolves 2006-2010 names to ids. Either shape of
    // `seasons` must produce the same card, with no title counted twice.
    const resolved = history.seasons.map((s) => {
      const name = s.season <= 2010 ? history.champions.find((c) => c.season === s.season)!.champion : null
      return name ? { ...s, championManagerId: members.find((m) => m.displayName === name)!.managerId } : s
    })
    for (const season of [2011, 2025, 2026]) {
      expect(teamContext({ season, members, ...history, seasons: resolved })).toEqual(teams(season))
    }
  })
})

describe('pairContext', () => {
  it('covers the current round only, and only games with both teams known', () => {
    expect(pairs(after14).map((p) => p.gameId)).toEqual(['r1-g1', 'r1-g2'])
    expect(pairs(after15).map((p) => p.gameId)).toEqual(['r2-g1', 'r2-g2'])
    // The third-place game is a card once both semi-final losers are known.
    expect(pairs(after16).map((p) => p.gameId)).toEqual(['r3-g1', 'r3-third'])
  })

  it('skips a current-round game that is still waiting on a side', () => {
    const half = bracket({
      throughWeek: 15,
      currentRound: 2,
      rounds: [roundOne, [game('r2-g1', 2, known(JACK, 1), known(BILL, 5)), game('r2-g2', 2, known(GABES, 2), waitingOn(3, 6))]],
    })
    expect(pairs(half).map((p) => p.gameId)).toEqual(['r2-g1'])
  })

  it('returns nothing for a decided bracket', () => {
    expect(pairs({ ...after16, throughWeek: 17, currentRound: null, championManagerId: GABES })).toEqual([])
  })

  it("lists this season's regular-season meetings from a's side, once each", () => {
    // Justin v Bill met once, in week nine, and Bill won it.
    expect(pair(after14, 'r1-g1').thisSeason).toEqual([{ week: 9, aPoints: 130.06, bPoints: 165.12 }])
    // Jack v Bill met twice. Two games are four stored rows.
    expect(pair(after15, 'r2-g1').thisSeason).toEqual([
      { week: 4, aPoints: 156.2, bPoints: 151.24 },
      { week: 13, aPoints: 129.86, bPoints: 127.64 },
    ])
  })

  it('swaps the points with the sides', () => {
    const flipped = bracket({ rounds: [[game('r1-g1', 1, known(BILL, 5), known(JUSTIN, 4))]] })
    expect(pair(flipped, 'r1-g1').thisSeason).toEqual([{ week: 9, aPoints: 165.12, bPoints: 130.06 }])
  })

  it('finds a known playoff meeting: Jack v Gabes, the 2023 first round', () => {
    // Gabes 140.52, Jack 114.02 in week 15 of 2023. Their only one before the 2025 final.
    expect(pair(after16, 'r3-g1').playoffMeetings).toEqual({
      aWins: 0,
      bWins: 1,
      last: { season: 2023, winnerManagerId: GABES },
    })
  })

  it('does not count the game on the card as its own history', () => {
    // The untruncated record holds the 2025 final itself (Gabes beat Jack in week 17).
    const finals = history.matchups.filter(
      (m) => m.season === 2025 && m.week === 17 && m.managerId === GABES && m.opponentManagerId === JACK,
    )
    expect(finals).toHaveLength(1)
    expect(pair(after16, 'r3-g1').playoffMeetings.bWins).toBe(1)
    // ...and the truncated list the page passes gives the same cards.
    const truncated = history.matchups.filter((m) => m.season !== 2025 || m.week <= 16)
    expect(pairs(after16, truncated)).toEqual(pairs(after16))
  })

  it('reports no playoff meetings for a pair that has none', () => {
    for (const id of ['r1-g1', 'r1-g2']) {
      expect(pair(after14, id).playoffMeetings).toEqual({ aWins: 0, bWins: 0, last: null })
    }
  })

  it('leaves fifth-place games out', () => {
    // Jack v Bill, 2023 week 16, and Gabes v Bryan, 2024 week 16, were both
    // fifth-place games: on record as playoff rows, and not meetings that count.
    const fifth = (a: number, b: number) =>
      history.matchups.filter((m) => m.managerId === a && m.opponentManagerId === b && m.season < 2025 && m.playoffPlacement === 5)
    expect(fifth(JACK, BILL)).toHaveLength(1)
    expect(fifth(GABES, BRYAN)).toHaveLength(1)
    expect(pair(after15, 'r2-g1').playoffMeetings).toEqual({ aWins: 0, bWins: 0, last: null })
    expect(pair(after15, 'r2-g2').playoffMeetings).toEqual({ aWins: 0, bWins: 0, last: null })
  })

  it('counts third-place games, and each meeting once', () => {
    // Bolek v Daniel: the 2020 final (Daniel), then third place in 2023 (Daniel) and 2024 (Bolek).
    const b = bracket({ season: 2026, rounds: [[game('r1-g1', 1, known(BOLEK, 4), known(DANIEL, 5))]] })
    expect(pair(b, 'r1-g1').playoffMeetings).toEqual({ aWins: 1, bWins: 2, last: { season: 2024, winnerManagerId: BOLEK } })
  })

  it('leaves the shown season and everything after it out of the playoff history', () => {
    // Gabes v Daniel met in the playoffs in 2020, 2022, 2023 and 2024.
    const meeting = (season: number) =>
      pair(bracket({ season, rounds: [[game('r1-g1', 1, known(GABES, 1), known(DANIEL, 2))]] }), 'r1-g1').playoffMeetings
    expect(meeting(2026)).toEqual({ aWins: 1, bWins: 3, last: { season: 2024, winnerManagerId: DANIEL } })
    expect(meeting(2024)).toEqual({ aWins: 1, bWins: 2, last: { season: 2023, winnerManagerId: GABES } })
    expect(meeting(2023)).toEqual({ aWins: 0, bWins: 2, last: { season: 2022, winnerManagerId: DANIEL } })
    expect(meeting(2020)).toEqual({ aWins: 0, bWins: 0, last: null })
  })

  it('reads nothing past throughWeek in the shown season', () => {
    // Not a state a real bracket reaches (it needs all fourteen weeks), but the
    // rule is the function's own: a meeting in week nine is not known in week eight.
    const early = { ...after14, throughWeek: 8 }
    expect(pair(early, 'r1-g1').thisSeason).toEqual([])
    expect(pair(early, 'r1-g2').thisSeason).toEqual([{ week: 7, aPoints: 166.02, bPoints: 164.56 }])
  })

  it('never lists a playoff game as a regular-season meeting', () => {
    // Bill v Bryan for third place: they met in weeks one and ten.
    expect(pair(after16, 'r3-third').thisSeason.map((m) => m.week)).toEqual([1, 10])
    // The round-one pair asked about again after their playoff game (week 15)
    // is on record: still only week nine, and that game is not "history" either.
    const rematch = bracket({ throughWeek: 16, currentRound: 3, rounds: [[], [], [game('r3-g1', 3, known(JUSTIN, 4), known(BILL, 5))]] })
    expect(pair(rematch, 'r3-g1').thisSeason.map((m) => m.week)).toEqual([9])
    expect(pair(rematch, 'r3-g1').playoffMeetings.last).toBeNull()
  })

  it('gives a tie to neither side and never names it as the last meeting', () => {
    const row = (season: number, a: number, b: number, pa: number, pb: number): HistoryMatchup => ({
      season, week: 15, managerId: a, points: pa, opponentManagerId: b, opponentPoints: pb,
      isPlayoff: true, playoffRound: 1, playoffPlacement: null, result: pa > pb ? 'W' : pa < pb ? 'L' : 'T',
    })
    const both = (season: number, pa: number, pb: number) => [row(season, 1, 2, pa, pb), row(season, 2, 1, pb, pa)]
    const b = bracket({ season: 2026, rounds: [[game('r1-g1', 1, known(1, 1), known(2, 2))]] })
    const got = pairContext({ bracket: b, matchups: [...both(2023, 100, 90), ...both(2024, 110, 110)] })
    expect(got[0].playoffMeetings).toEqual({ aWins: 1, bWins: 0, last: { season: 2023, winnerManagerId: 1 } })
  })
})

describe('playoffMeetingsSince', () => {
  it('is the first season with playoff games on record, read from the rows', () => {
    expect(playoffMeetingsSince(history.matchups, 2025)).toBe(2020)
    expect(playoffMeetingsSince(history.matchups, 2021)).toBe(2020)
  })

  it('is null when no earlier season has any', () => {
    expect(playoffMeetingsSince(history.matchups, 2020)).toBeNull()
    expect(playoffMeetingsSince([], 2026)).toBeNull()
  })
})
