/**
 * The league's history, read back as numbers.
 *
 * Pure and DB-free, in the shape of `src/lib/stats.ts`: every function takes
 * plain objects and returns plain objects, so all of it is unit-testable without
 * a database. `src/server/history-service.ts` is the part that reads Postgres.
 *
 * ## The two-era rule is enforced by the types, not by discipline
 *
 * The league has three tiers of record (docs/PROJECT_PLAN.md §12):
 *
 *   - **legacy** (2006–2010) — a champion's name and nothing else
 *   - **standings** (2011–2019) — one row per member-season: record, points, place
 *   - **weekly** (2020–) — every game, every lineup, every player
 *
 * So "all-time points for" spans fifteen seasons while "all-play record" can only
 * ever span six, and a table that mixes them is lying about at least one column.
 * The workbook does exactly that and contradicts itself as a result: its hidden
 * records sheet claims an all-time high score of 203.9 from 2014, while its
 * dashboard says 234.96 from 2023 — both correct for the era each was computed
 * over, and neither labelled.
 *
 * Every summary row here therefore splits into two objects, and the weekly one is
 * **nullable**. You cannot add an all-play record into a career win total by
 * accident, because they are not in the same object. And every report carries the
 * `Coverage` it was computed over, so a panel physically cannot render a number
 * without having the years it covers to hand.
 */

// ---------------------------------------------------------------------------
// Input — structurally satisfied by the DB reader and by a test fixture alike
// ---------------------------------------------------------------------------

export type DataTier = 'legacy' | 'standings' | 'weekly'

export interface HistoryMember {
  managerId: number
  name: string
  displayName: string
  color: string
}

export interface HistorySeason {
  season: number
  dataTier: DataTier
  regularSeasonWeeks: number | null
  championManagerId: number | null
  runnerUpManagerId: number | null
  thirdManagerId: number | null
  /** Null is unknown, and unknown is not zero. See the schema. */
  championPrize: number | null
  runnerUpPrize: number | null
  thirdPrize: number | null
  draftCity: string | null
  draftState: string | null
}

export interface HistoryStanding {
  season: number
  managerId: number
  place: number | null
  wins: number
  losses: number
  ties: number
  pointsFor: number | null
  pointsAgainst: number | null
  madePlayoffs: boolean
  playoffWins: number | null
  playoffLosses: number | null
}

export interface HistoryMatchup {
  season: number
  week: number
  managerId: number
  points: number
  opponentManagerId: number
  opponentPoints: number
  isPlayoff: boolean
  playoffRound: number | null
  /** Null on the championship path; 3 or 5 for a placement game. */
  playoffPlacement: number | null
  result: 'W' | 'L' | 'T'
}

export interface HistoryLineup {
  season: number
  week: number
  managerId: number
  actual: number
  optimal: number
}

export interface HistoryInput {
  members: HistoryMember[]
  seasons: HistorySeason[]
  standings: HistoryStanding[]
  matchups: HistoryMatchup[]
  lineups: HistoryLineup[]
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export interface Coverage {
  from: number | null
  to: number | null
  seasons: number[]
  label: string
}

const EMPTY_COVERAGE: Coverage = { from: null, to: null, seasons: [], label: 'no seasons on record' }

/**
 * The seasons a tier actually covers, derived from the data.
 *
 * Never hardcode 2020. When 2026's results land, "since Sleeper" widens on its
 * own; when a pre-2011 season is ever reconstructed, the all-time span does too.
 *
 * ⚠️ `withData` is not optional in spirit. A season **row** exists as soon as the
 * league drafts — 2026 has a `seasons` row, a tier, a draft location and no
 * games — so a span built from rows alone reads "2011–2026" for a table whose
 * last result is 2025. Pass the seasons that actually contributed rows to the
 * metric being labelled.
 */
export function coverageFor(
  seasons: HistorySeason[],
  tiers: DataTier[],
  label: string,
  withData?: Set<number>,
): Coverage {
  const years = seasons
    .filter((s) => tiers.includes(s.dataTier))
    .map((s) => s.season)
    .filter((y) => withData === undefined || withData.has(y))
    .sort((a, b) => a - b)
  if (!years.length) return { ...EMPTY_COVERAGE, label }
  return { from: years[0], to: years[years.length - 1], seasons: years, label }
}

/**
 * Playoff games that count.
 *
 * Third place pays, so it counts. Nobody tries in the fifth-place game, so
 * counting its scores toward a record would put results from a game people were
 * not playing seriously next to ones they were. All the rows are stored; this is
 * the filter every consumer should use unless it specifically wants consolation.
 */
export function isCountedPlayoff(m: HistoryMatchup): boolean {
  return m.isPlayoff && (m.playoffPlacement === null || m.playoffPlacement <= 3)
}

/** The seasons that actually produced rows — never the seasons that merely exist. */
function playedSeasons(rows: Array<{ season: number }>): Set<number> {
  return new Set(rows.map((r) => r.season))
}

// ---------------------------------------------------------------------------
// All-play — how you would have done against the whole field, every week
// ---------------------------------------------------------------------------

export interface AllPlayRow {
  managerId: number
  wins: number
  losses: number
  ties: number
  pct: number
}

export interface AllPlayReport {
  rows: AllPlayRow[]
  coverage: Coverage
  /** Weeks skipped because the whole field was not present. */
  incompleteWeeks: number
}

/**
 * Every manager against every other manager, week by week.
 *
 * The point of the metric is to strip out schedule luck: a 6-7 record with the
 * second-highest all-play win rate is a different season from a 6-7 record with
 * the worst. Regular season only — a playoff week is not a week everyone played.
 *
 * A week where the whole field is not present is **skipped and counted**, not
 * partially scored, because "wins against 5 opponents" and "wins against 9" are
 * not the same unit and averaging them silently is how a metric stops meaning
 * anything.
 */
export function allPlay(matchups: HistoryMatchup[], seasons: HistorySeason[]): AllPlayReport {
  const byWeek = new Map<string, HistoryMatchup[]>()
  for (const m of matchups) {
    if (m.isPlayoff) continue
    const key = `${m.season}:${m.week}`
    const list = byWeek.get(key) ?? []
    list.push(m)
    byWeek.set(key, list)
  }

  const field = new Set(matchups.map((m) => m.managerId)).size
  const tally = new Map<number, AllPlayRow>()
  let incompleteWeeks = 0

  for (const [, week] of byWeek) {
    if (week.length !== field) {
      incompleteWeeks++
      continue
    }
    for (const a of week) {
      const row = tally.get(a.managerId) ?? { managerId: a.managerId, wins: 0, losses: 0, ties: 0, pct: 0 }
      for (const b of week) {
        if (b.managerId === a.managerId) continue
        if (a.points > b.points) row.wins++
        else if (a.points < b.points) row.losses++
        else row.ties++
      }
      tally.set(a.managerId, row)
    }
  }

  const rows = [...tally.values()].map((r) => {
    const played = r.wins + r.losses + r.ties
    return { ...r, pct: played ? Number((r.wins / played).toFixed(4)) : 0 }
  })

  return {
    rows: rows.sort((a, b) => b.pct - a.pct),
    coverage: coverageFor(seasons, ['weekly'], 'since Sleeper', playedSeasons(matchups)),
    incompleteWeeks,
  }
}

// ---------------------------------------------------------------------------
// High and low scorer weeks — the league's weekly side bet
// ---------------------------------------------------------------------------

export interface HighLowRow {
  managerId: number
  highWeeks: number
  lowWeeks: number
}

/**
 * How often each manager topped and propped the table.
 *
 * Regular season only. There is deliberately **no money here**: the league runs
 * a weekly side bet, but the interesting number is how often somebody was the
 * best or worst team that week, and attaching a dollar figure meant carrying a
 * per-season rate that mostly is not on record. The count says the same thing
 * and cannot be wrong.
 */
export function highLowWeeks(
  matchups: HistoryMatchup[],
  seasons: HistorySeason[],
): { rows: HighLowRow[]; coverage: Coverage } {
  const byWeek = new Map<string, HistoryMatchup[]>()
  for (const m of matchups) {
    if (m.isPlayoff) continue
    const key = `${m.season}:${m.week}`
    const list = byWeek.get(key) ?? []
    list.push(m)
    byWeek.set(key, list)
  }

  const tally = new Map<number, HighLowRow>()
  const bump = (id: number) => tally.get(id) ?? { managerId: id, highWeeks: 0, lowWeeks: 0 }

  for (const [, week] of byWeek) {
    if (week.length < 2) continue
    const high = week.reduce((a, b) => (b.points > a.points ? b : a))
    const low = week.reduce((a, b) => (b.points < a.points ? b : a))

    const h = bump(high.managerId)
    h.highWeeks++
    tally.set(high.managerId, h)

    const l = bump(low.managerId)
    l.lowWeeks++
    tally.set(low.managerId, l)
  }

  return {
    rows: [...tally.values()].sort((a, b) => b.highWeeks - a.highWeeks),
    coverage: coverageFor(seasons, ['weekly'], 'since Sleeper', playedSeasons(matchups)),
  }
}

// ---------------------------------------------------------------------------
// The League Summary
// ---------------------------------------------------------------------------

export interface AllTimeStats {
  titles: number
  runnerUps: number
  thirds: number
  /** Null when no season on record has a prize recorded for this manager. */
  moneyWon: number | null
  /** Seasons whose payout is unknown, so a null total can explain itself. */
  moneyUnknownSeasons: number[]
  seasons: number
  wins: number
  losses: number
  ties: number
  winPct: number
  avgFinish: number | null
  avgPointsFor: number | null
  pointsFor: number
  pointsAgainst: number
  differential: number
  playoffAppearances: number
  playoffWins: number
  playoffLosses: number
  playoffWinPct: number | null
}

export interface WeeklyStats {
  allPlayWins: number
  allPlayLosses: number
  allPlayTies: number
  allPlayPct: number
  /** actual / optimal. Null when no lineup is on record. */
  lineupEfficiency: number | null
  highScoreWeeks: number
  lowScoreWeeks: number
  playoffPointsFor: number
  playoffPointsAgainst: number
}

export interface LeagueSummaryRow {
  member: HistoryMember
  allTime: AllTimeStats
  /** Null for a manager with no week-level record at all. */
  weekly: WeeklyStats | null
}

export interface LeagueSummaryReport {
  rows: LeagueSummaryRow[]
  allTime: Coverage
  weekly: Coverage
  /** Champions from before the membership record, by name only. */
  legacyNote: Coverage
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round = (n: number, dp = 2) => Number(n.toFixed(dp))

export function leagueSummary(input: HistoryInput): LeagueSummaryReport {
  const { members, seasons, standings, matchups, lineups } = input

  const allPlayReport = allPlay(matchups, seasons)
  const allPlayBy = new Map(allPlayReport.rows.map((r) => [r.managerId, r]))
  const highLow = highLowWeeks(matchups, seasons)
  const highLowBy = new Map(highLow.rows.map((r) => [r.managerId, r]))

  const weeklySeasons = new Set(seasons.filter((s) => s.dataTier === 'weekly').map((s) => s.season))

  const rows = members.map((member) => {
    const mine = standings.filter((s) => s.managerId === member.managerId)

    // --- all-time (every season with a standings row) ----------------------
    const titles = seasons.filter((s) => s.championManagerId === member.managerId)
    const runnerUps = seasons.filter((s) => s.runnerUpManagerId === member.managerId)
    const thirds = seasons.filter((s) => s.thirdManagerId === member.managerId)

    const prizes: Array<number | null> = [
      ...titles.map((s) => s.championPrize),
      ...runnerUps.map((s) => s.runnerUpPrize),
      ...thirds.map((s) => s.thirdPrize),
    ]
    const known = prizes.filter((p): p is number => p !== null)
    const unknownSeasons = [...titles, ...runnerUps, ...thirds]
      .filter((s) =>
        s.championManagerId === member.managerId
          ? s.championPrize === null
          : s.runnerUpManagerId === member.managerId
            ? s.runnerUpPrize === null
            : s.thirdPrize === null,
      )
      .map((s) => s.season)
      .sort()

    const wins = sum(mine.map((s) => s.wins))
    const losses = sum(mine.map((s) => s.losses))
    const ties = sum(mine.map((s) => s.ties))
    const games = wins + losses + ties
    const places = mine.map((s) => s.place).filter((p): p is number => p !== null)
    const pf = sum(mine.map((s) => s.pointsFor ?? 0))
    const pa = sum(mine.map((s) => s.pointsAgainst ?? 0))
    const withPoints = mine.filter((s) => s.pointsFor !== null)

    const allTime: AllTimeStats = {
      titles: titles.length,
      runnerUps: runnerUps.length,
      thirds: thirds.length,
      // Null only when nothing is known at all; a partial total would read as
      // authoritative about seasons it cannot see.
      moneyWon: prizes.length === 0 ? 0 : known.length === 0 ? null : sum(known),
      moneyUnknownSeasons: unknownSeasons,
      seasons: mine.length,
      wins,
      losses,
      ties,
      winPct: games ? round(wins / games, 4) : 0,
      avgFinish: places.length ? round(sum(places) / places.length) : null,
      avgPointsFor: withPoints.length ? round(pf / withPoints.length) : null,
      pointsFor: round(pf),
      pointsAgainst: round(pa),
      differential: round(pf - pa),
      playoffAppearances: mine.filter((s) => s.madePlayoffs).length,
      playoffWins: sum(mine.map((s) => s.playoffWins ?? 0)),
      playoffLosses: sum(mine.map((s) => s.playoffLosses ?? 0)),
      playoffWinPct: null,
    }
    const playoffGames = allTime.playoffWins + allTime.playoffLosses
    allTime.playoffWinPct = playoffGames ? round(allTime.playoffWins / playoffGames, 4) : null

    // --- weekly (only the seasons that have week-level rows) ---------------
    const myLineups = lineups.filter((l) => l.managerId === member.managerId)
    const myPlayoffs = matchups.filter(
      (m) => m.managerId === member.managerId && isCountedPlayoff(m) && weeklySeasons.has(m.season),
    )
    const ap = allPlayBy.get(member.managerId)
    const hl = highLowBy.get(member.managerId)

    const actual = sum(myLineups.map((l) => l.actual))
    const optimal = sum(myLineups.map((l) => l.optimal))

    const weekly: WeeklyStats | null = ap
      ? {
          allPlayWins: ap.wins,
          allPlayLosses: ap.losses,
          allPlayTies: ap.ties,
          allPlayPct: ap.pct,
          lineupEfficiency: optimal > 0 ? round(actual / optimal, 4) : null,
          highScoreWeeks: hl?.highWeeks ?? 0,
          lowScoreWeeks: hl?.lowWeeks ?? 0,
          playoffPointsFor: round(sum(myPlayoffs.map((m) => m.points))),
          playoffPointsAgainst: round(sum(myPlayoffs.map((m) => m.opponentPoints))),
        }
      : null

    return { member, allTime, weekly }
  })

  // A season that has been drafted but not played has a row, a tier and a draft
  // location and no games. It must not widen either span.
  const played = playedSeasons(standings)
  const weekly = playedSeasons(matchups)

  return {
    rows: rows.sort((a, b) => b.allTime.winPct - a.allTime.winPct),
    allTime: coverageFor(seasons, ['standings', 'weekly'], 'all-time', played),
    weekly: coverageFor(seasons, ['weekly'], 'since Sleeper', weekly),
    legacyNote: coverageFor(seasons, ['legacy'], 'champions only'),
  }
}

// ---------------------------------------------------------------------------
// The record book
// ---------------------------------------------------------------------------

/**
 * One record, with everything needed to say who, when and over what.
 *
 * `coverage` rides on every entry rather than on the group, because the record
 * book mixes eras in a way the summary table does not: an all-time high *score*
 * can only reach back to 2020, while the fewest points in a *season* reaches to
 * 2011. Printing those two lines next to each other without saying so is exactly
 * how the workbook ended up claiming two different all-time high scores.
 */
export interface RecordEntry {
  key: string
  label: string
  /** The number the record is about. The UI decides how to print it. */
  value: number
  managerId: number
  season: number
  /** Null for a season-level record. */
  week: number | null
  opponentManagerId: number | null
  /** Extra context, e.g. "8 straight". */
  detail: string | null
  /**
   * What to print instead of the number, when the number alone does not say it.
   * "Best regular-season record" is 12-2, not 12.
   */
  display: string | null
  coverage: Coverage
}

export interface RecordBook {
  /** Single-game records. Weekly era only — there are no game-level rows before it. */
  games: RecordEntry[]
  /** Season-level records. Reach back as far as the standings do. */
  seasons: RecordEntry[]
  /** Career records. */
  careers: RecordEntry[]
  /** The highest-scoring seasons on record, best first. */
  topScoringSeasons: Array<{ managerId: number; season: number; points: number }>
  gameCoverage: Coverage
  seasonCoverage: Coverage
}

interface Extreme {
  value: number
  managerId: number
  season: number
  week: number | null
  opponentManagerId: number | null
  detail?: string | null
  display?: string | null
}

/** Pick the row that wins on `by`; ties keep the earliest, so a record has one holder. */
function best<T>(rows: T[], by: (r: T) => number, prefer: 'max' | 'min'): T | null {
  let winner: T | null = null
  let mark = prefer === 'max' ? -Infinity : Infinity
  for (const row of rows) {
    const v = by(row)
    if (prefer === 'max' ? v > mark : v < mark) {
      mark = v
      winner = row
    }
  }
  return winner
}

function entry(
  key: string,
  label: string,
  e: Extreme | null,
  coverage: Coverage,
): RecordEntry | null {
  if (!e) return null
  return {
    key,
    label,
    value: Number(e.value.toFixed(2)),
    managerId: e.managerId,
    season: e.season,
    week: e.week,
    opponentManagerId: e.opponentManagerId,
    detail: e.detail ?? null,
    display: e.display ?? null,
    coverage,
  }
}

/**
 * Longest runs of wins and losses, per manager.
 *
 * **Streaks do not cross a season boundary.** Eight months and a fresh draft sit
 * between the last game of one year and the first of the next, and a "streak"
 * spanning them describes two different teams. Regular season only, for the same
 * reason: a playoff run is its own thing and is already counted elsewhere.
 */
export function longestStreaks(matchups: HistoryMatchup[]): {
  wins: Extreme | null
  losses: Extreme | null
} {
  const bySeasonManager = new Map<string, HistoryMatchup[]>()
  for (const m of matchups) {
    if (m.isPlayoff) continue
    const key = `${m.season}:${m.managerId}`
    const list = bySeasonManager.get(key) ?? []
    list.push(m)
    bySeasonManager.set(key, list)
  }

  let wins: Extreme | null = null
  let losses: Extreme | null = null

  for (const [, games] of bySeasonManager) {
    games.sort((a, b) => a.week - b.week)
    let runW = 0
    let runL = 0
    for (const g of games) {
      runW = g.result === 'W' ? runW + 1 : 0
      runL = g.result === 'L' ? runL + 1 : 0
      const shared = { managerId: g.managerId, season: g.season, week: g.week, opponentManagerId: null }
      if (runW > (wins?.value ?? 0)) wins = { ...shared, value: runW, detail: `${runW} straight` }
      if (runL > (losses?.value ?? 0)) losses = { ...shared, value: runL, detail: `${runL} straight` }
    }
  }
  return { wins, losses }
}

/**
 * Every record the league can currently answer, each carrying its own span.
 *
 * Deliberately absent: anything needing draft prices (the "draft steal"), which
 * arrives with the auction import.
 */
export function records(input: HistoryInput): RecordBook {
  const { seasons, standings, matchups } = input

  const gameCoverage = coverageFor(seasons, ['weekly'], 'since Sleeper', playedSeasons(matchups))
  const seasonCoverage = coverageFor(
    seasons,
    ['standings', 'weekly'],
    'all-time',
    playedSeasons(standings),
  )

  const regular = matchups.filter((m) => !m.isPlayoff)
  const playoff = matchups.filter(isCountedPlayoff)

  const asExtreme = (m: HistoryMatchup, value: number, detail?: string): Extreme => ({
    value,
    managerId: m.managerId,
    season: m.season,
    week: m.week,
    opponentManagerId: m.opponentManagerId,
    detail: detail ?? null,
  })

  // A margin is only a "win by" from the winner's side; taking it from both
  // sides would make every blowout also the smallest loss.
  const wonRegular = regular.filter((m) => m.result === 'W')
  const wonPlayoff = playoff.filter((m) => m.result === 'W')

  const games = [
    entry('highScore', 'Highest score, regular season',
      (() => { const m = best(regular, (r) => r.points, 'max'); return m ? asExtreme(m, m.points) : null })(),
      gameCoverage),
    entry('lowScore', 'Lowest score, regular season',
      (() => { const m = best(regular, (r) => r.points, 'min'); return m ? asExtreme(m, m.points) : null })(),
      gameCoverage),
    entry('highPlayoffScore', 'Highest score, playoffs',
      (() => { const m = best(playoff, (r) => r.points, 'max'); return m ? asExtreme(m, m.points) : null })(),
      gameCoverage),
    entry('lowPlayoffScore', 'Lowest score, playoffs',
      (() => { const m = best(playoff, (r) => r.points, 'min'); return m ? asExtreme(m, m.points) : null })(),
      gameCoverage),
    entry('biggestBlowout', 'Biggest blowout, regular season',
      (() => {
        const m = best(wonRegular, (r) => r.points - r.opponentPoints, 'max')
        return m ? asExtreme(m, m.points - m.opponentPoints) : null
      })(), gameCoverage),
    entry('closestGame', 'Narrowest win, regular season',
      (() => {
        const m = best(wonRegular, (r) => r.points - r.opponentPoints, 'min')
        return m ? asExtreme(m, m.points - m.opponentPoints) : null
      })(), gameCoverage),
    entry('biggestPlayoffBlowout', 'Biggest blowout, playoffs',
      (() => {
        const m = best(wonPlayoff, (r) => r.points - r.opponentPoints, 'max')
        return m ? asExtreme(m, m.points - m.opponentPoints) : null
      })(), gameCoverage),
    entry('closestPlayoffGame', 'Narrowest win, playoffs',
      (() => {
        const m = best(wonPlayoff, (r) => r.points - r.opponentPoints, 'min')
        return m ? asExtreme(m, m.points - m.opponentPoints) : null
      })(), gameCoverage),
  ].filter((e): e is RecordEntry => e !== null)

  // --- season-level ---------------------------------------------------------
  const withPoints = standings.filter((s) => s.pointsFor !== null)
  const toExtreme = (s: HistoryStanding, value: number, detail?: string): Extreme => ({
    value,
    managerId: s.managerId,
    season: s.season,
    week: null,
    opponentManagerId: null,
    detail: detail ?? null,
  })

  const streaks = longestStreaks(matchups)

  const seasonRecords = [
    entry('mostPointsSeason', 'Most points in a season',
      (() => { const s = best(withPoints, (r) => r.pointsFor!, 'max'); return s ? toExtreme(s, s.pointsFor!) : null })(),
      seasonCoverage),
    entry('fewestPointsSeason', 'Fewest points in a season',
      (() => { const s = best(withPoints, (r) => r.pointsFor!, 'min'); return s ? toExtreme(s, s.pointsFor!) : null })(),
      seasonCoverage),
    entry('mostPointsAgainstSeason', 'Most points against in a season',
      (() => {
        const rows = standings.filter((s) => s.pointsAgainst !== null)
        const s = best(rows, (r) => r.pointsAgainst!, 'max')
        return s ? toExtreme(s, s.pointsAgainst!) : null
      })(), seasonCoverage),
    // ⚠️ Ranked by win PERCENTAGE, not by wins minus losses. The league played
    // 13-game seasons through 2020 and 14 from 2021, so a margin comparison
    // quietly favours the longer seasons: 12-2 (.857) would beat 11-2 (.846) on
    // percentage and also on margin, but 12-3 (.800) would beat 11-2 on margin
    // alone despite being the worse season.
    entry('bestRecord', 'Best regular-season record',
      (() => {
        const rows = standings.filter((r) => r.wins + r.losses + r.ties > 0)
        const s = best(rows, (r) => r.wins / (r.wins + r.losses + r.ties), 'max')
        return s ? { ...toExtreme(s, s.wins), display: `${s.wins}-${s.losses}` } : null
      })(), seasonCoverage),
    entry('worstRecord', 'Worst regular-season record',
      (() => {
        const rows = standings.filter((r) => r.wins + r.losses + r.ties > 0)
        const s = best(rows, (r) => r.wins / (r.wins + r.losses + r.ties), 'min')
        return s ? { ...toExtreme(s, s.wins), display: `${s.wins}-${s.losses}` } : null
      })(), seasonCoverage),
    entry('longestWinStreak', 'Longest winning streak', streaks.wins, gameCoverage),
    entry('longestLossStreak', 'Longest losing streak', streaks.losses, gameCoverage),
  ].filter((e): e is RecordEntry => e !== null)

  // --- careers --------------------------------------------------------------
  const byManager = new Map<number, HistoryStanding[]>()
  for (const s of standings) {
    const list = byManager.get(s.managerId) ?? []
    list.push(s)
    byManager.set(s.managerId, list)
  }

  const careerRows = [...byManager.entries()].map(([managerId, rows]) => {
    const titles = seasons.filter((s) => s.championManagerId === managerId).length
    const prizes = [
      ...seasons.filter((s) => s.championManagerId === managerId).map((s) => s.championPrize),
      ...seasons.filter((s) => s.runnerUpManagerId === managerId).map((s) => s.runnerUpPrize),
      ...seasons.filter((s) => s.thirdManagerId === managerId).map((s) => s.thirdPrize),
    ].filter((p): p is number => p !== null)
    // Longest run of consecutive seasons in the playoffs.
    const years = rows.filter((r) => r.madePlayoffs).map((r) => r.season).sort((a, b) => a - b)
    let run = 0
    let bestRun = 0
    let bestEnd = years[0] ?? 0
    for (let i = 0; i < years.length; i++) {
      run = i > 0 && years[i] === years[i - 1] + 1 ? run + 1 : 1
      if (run > bestRun) { bestRun = run; bestEnd = years[i] }
    }
    return {
      managerId,
      titles,
      money: sum(prizes),
      appearances: years.length,
      streak: bestRun,
      streakEnd: bestEnd,
      latest: rows.reduce((a, b) => Math.max(a, b.season), 0),
    }
  })

  const careerEntry = (
    key: string,
    label: string,
    by: (r: (typeof careerRows)[number]) => number,
    detail: (r: (typeof careerRows)[number]) => string,
  ) => {
    const r = best(careerRows, by, 'max')
    if (!r || by(r) === 0) return null
    return entry(key, label, {
      value: by(r), managerId: r.managerId, season: r.latest, week: null,
      opponentManagerId: null, detail: detail(r),
    }, seasonCoverage)
  }

  const careers = [
    careerEntry('mostTitles', 'Most championships', (r) => r.titles, (r) => `${r.titles} titles`),
    careerEntry('mostMoney', 'Most prize money', (r) => r.money, (r) => `$${r.money.toLocaleString()}`),
    careerEntry('mostPlayoffs', 'Most playoff appearances', (r) => r.appearances, (r) => `${r.appearances} seasons`),
    careerEntry('longestPlayoffStreak', 'Longest playoff streak', (r) => r.streak, (r) => `${r.streak} in a row`),
  ].filter((e): e is RecordEntry => e !== null)

  const topScoringSeasons = withPoints
    .map((s) => ({ managerId: s.managerId, season: s.season, points: Number(s.pointsFor!.toFixed(2)) }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)

  return { games, seasons: seasonRecords, careers, topScoringSeasons, gameCoverage, seasonCoverage }
}

// ---------------------------------------------------------------------------
// One season, reviewed
// ---------------------------------------------------------------------------

export interface SeasonReview {
  season: number
  dataTier: DataTier
  champion: number | null
  runnerUp: number | null
  third: number | null
  /** Whoever finished first in the regular season — often not the champion. */
  regularSeasonWinner: number | null
  city: string | null
  state: string | null
  /** Weekly-era only; null for a season with no game-level rows. */
  highestScore: RecordEntry | null
  lowestScore: RecordEntry | null
  biggestBlowout: RecordEntry | null
  closestGame: RecordEntry | null
  mostConsistent: { managerId: number; stdev: number } | null
  mostVolatile: { managerId: number; stdev: number } | null
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = sum(xs) / xs.length
  return Math.sqrt(sum(xs.map((x) => (x - mean) ** 2)) / (xs.length - 1))
}

/** Everything worth saying about one season. */
export function seasonInReview(input: HistoryInput, season: number): SeasonReview | null {
  const s = input.seasons.find((x) => x.season === season)
  if (!s) return null

  const standings = input.standings.filter((r) => r.season === season)
  const regular = input.matchups.filter((m) => m.season === season && !m.isPlayoff)
  const coverage: Coverage = {
    from: season,
    to: season,
    seasons: [season],
    label: String(season),
  }

  const spread = new Map<number, number[]>()
  for (const m of regular) {
    const list = spread.get(m.managerId) ?? []
    list.push(m.points)
    spread.set(m.managerId, list)
  }
  const variability = [...spread.entries()]
    .filter(([, pts]) => pts.length >= 2)
    .map(([managerId, pts]) => ({ managerId, stdev: Number(stdev(pts).toFixed(2)) }))
    .sort((a, b) => a.stdev - b.stdev)

  const won = regular.filter((m) => m.result === 'W')
  const asExtreme = (m: HistoryMatchup, value: number): Extreme => ({
    value,
    managerId: m.managerId,
    season: m.season,
    week: m.week,
    opponentManagerId: m.opponentManagerId,
  })

  const high = best(regular, (r) => r.points, 'max')
  const low = best(regular, (r) => r.points, 'min')
  const blowout = best(won, (r) => r.points - r.opponentPoints, 'max')
  const close = best(won, (r) => r.points - r.opponentPoints, 'min')

  return {
    season,
    dataTier: s.dataTier,
    champion: s.championManagerId,
    runnerUp: s.runnerUpManagerId,
    third: s.thirdManagerId,
    regularSeasonWinner: standings.find((r) => r.place === 1)?.managerId ?? null,
    city: s.draftCity,
    state: s.draftState,
    highestScore: high ? entry('high', 'Highest score', asExtreme(high, high.points), coverage) : null,
    lowestScore: low ? entry('low', 'Lowest score', asExtreme(low, low.points), coverage) : null,
    biggestBlowout: blowout
      ? entry('blowout', 'Biggest blowout', asExtreme(blowout, blowout.points - blowout.opponentPoints), coverage)
      : null,
    closestGame: close
      ? entry('closest', 'Closest game', asExtreme(close, close.points - close.opponentPoints), coverage)
      : null,
    mostConsistent: variability[0] ?? null,
    mostVolatile: variability[variability.length - 1] ?? null,
  }
}
