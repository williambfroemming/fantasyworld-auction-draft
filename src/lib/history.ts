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
  /** What each manager paid to enter. Null is unknown, never free. */
  buyIn: number | null
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
  /**
   * Auction picks, for the draft half of a member page.
   *
   * Optional because most reports do not need them and loading 800 rows to
   * render the all-time table would be waste.
   */
  picks?: HistoryPick[]
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

/**
 * Standings rows for seasons that have actually been played.
 *
 * ⚠️ A standings row exists for the season in progress from its first refresh,
 * with a 0-0 record and zero points — which then wins "fewest points in a
 * season" outright and stretches every era badge a year into the future. A
 * season counts once somebody has played a game.
 */
function playedStandings(standings: HistoryStanding[]): HistoryStanding[] {
  const played = new Set(
    standings.filter((s) => s.wins + s.losses + s.ties > 0).map((s) => s.season),
  )
  return standings.filter((s) => played.has(s.season))
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
  /** Prize money, gross. Null when nothing is on record for this manager. */
  moneyWon: number | null
  /** Seasons whose payout is unknown, so a null total can explain itself. */
  moneyUnknownSeasons: number[]
  /** Total paid in, across the seasons they played with a buy-in recorded. */
  buyInsPaid: number
  /**
   * Prizes minus entry fees, over **only the seasons with a buy-in on record**.
   *
   * The number most people mean by "how are you doing". Gross winnings flatter
   * everybody: ten managers paying into a pot one of them takes home leaves one
   * winner and nine losers, and the archive should be able to say so.
   *
   * ⚠️ Restricted to seasons that have both figures, and that restriction is
   * load-bearing. Subtracting the seasons whose fee happens to be recorded from
   * *all* the prize money ever won mixes eras and produces a number that is not
   * about anything — fifteen years of winnings minus one year's entry fee. Null
   * when no season qualifies.
   */
  netWinnings: number | null
  /** The seasons `netWinnings` actually covers, so the UI can say so. */
  netSeasons: number[]
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
  /**
   * Championships reach further back than anything else.
   *
   * 2006–2010 survive as a champion and nothing else, and those titles count —
   * rings are counted from the start of the record. So the trophy column spans
   * more years than the record beside it, and says so rather than letting a
   * reader assume both cover the same era.
   */
  titles: Coverage
  /** The seasons that contribute a champion and nothing else. */
  legacyNote: Coverage
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round = (n: number, dp = 2) => Number(n.toFixed(dp))

export function leagueSummary(input: HistoryInput): LeagueSummaryReport {
  const { members, seasons, standings, matchups, lineups } = input
  const bySeasonMeta = new Map(seasons.map((s) => [s.season, s]))

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

    // Seasons they played that also have a buy-in recorded. Both halves of the
    // net figure come from exactly this set — see the note on `netWinnings`.
    const priced = mine
      .map((s) => ({ season: s.season, buyIn: bySeasonMeta.get(s.season)?.buyIn ?? null }))
      .filter((s): s is { season: number; buyIn: number } => s.buyIn !== null)
    const pricedSeasons = new Set(priced.map((s) => s.season))
    const buyInsPaid = sum(priced.map((s) => s.buyIn))

    const prizeIn = (season: number) => {
      const meta = bySeasonMeta.get(season)
      if (!meta) return 0
      if (meta.championManagerId === member.managerId) return meta.championPrize ?? 0
      if (meta.runnerUpManagerId === member.managerId) return meta.runnerUpPrize ?? 0
      if (meta.thirdManagerId === member.managerId) return meta.thirdPrize ?? 0
      return 0
    }
    const netWinnings = pricedSeasons.size
      ? sum([...pricedSeasons].map(prizeIn)) - buyInsPaid
      : null

    const allTime: AllTimeStats = {
      titles: titles.length,
      runnerUps: runnerUps.length,
      thirds: thirds.length,
      // Null only when nothing is known at all; a partial total would read as
      // authoritative about seasons it cannot see.
      moneyWon: prizes.length === 0 ? 0 : known.length === 0 ? null : sum(known),
      moneyUnknownSeasons: unknownSeasons,
      buyInsPaid,
      netWinnings,
      netSeasons: [...pricedSeasons].sort((a, b) => a - b),
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
  const played = playedSeasons(playedStandings(standings))
  const weekly = playedSeasons(matchups)

  return {
    rows: rows.sort((a, b) => b.allTime.winPct - a.allTime.winPct),
    allTime: coverageFor(seasons, ['standings', 'weekly'], 'all-time', played),
    weekly: coverageFor(seasons, ['weekly'], 'since Sleeper', weekly),
    titles: coverageFor(
      seasons,
      ['legacy', 'standings', 'weekly'],
      'titles',
      new Set(seasons.filter((s) => s.championManagerId !== null).map((s) => s.season)),
    ),
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
  const { seasons, matchups } = input
  const standings = playedStandings(input.standings)

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

// ---------------------------------------------------------------------------
// Head to head
// ---------------------------------------------------------------------------

export interface H2HCell {
  managerId: number
  opponentManagerId: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
}

export interface H2HReport {
  cells: H2HCell[]
  coverage: Coverage
  /** Look a pairing up without scanning. Key is `${a}:${b}`. */
  get: (managerId: number, opponentManagerId: number) => H2HCell | undefined
}

/**
 * Every manager's record against every other, regular season only.
 *
 * Playoffs are excluded deliberately. A head-to-head table is read as "who owns
 * whom over a long run", and playoff meetings are both rare and unevenly
 * distributed — two managers who met three times in January would show a record
 * that says more about seeding than about the matchup. It also keeps this
 * directly comparable to the league's own Everyone-vs-Everyone sheet, which
 * counts regular-season games.
 */
export function headToHead(matchups: HistoryMatchup[], seasons: HistorySeason[]): H2HReport {
  const cells = new Map<string, H2HCell>()

  for (const m of matchups) {
    if (m.isPlayoff) continue
    const key = `${m.managerId}:${m.opponentManagerId}`
    const cell =
      cells.get(key) ??
      {
        managerId: m.managerId,
        opponentManagerId: m.opponentManagerId,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      }
    if (m.result === 'W') cell.wins++
    else if (m.result === 'L') cell.losses++
    else cell.ties++
    cell.pointsFor += m.points
    cell.pointsAgainst += m.opponentPoints
    cells.set(key, cell)
  }

  for (const cell of cells.values()) {
    cell.pointsFor = round(cell.pointsFor)
    cell.pointsAgainst = round(cell.pointsAgainst)
  }

  return {
    cells: [...cells.values()],
    coverage: coverageFor(seasons, ['weekly'], 'since Sleeper', playedSeasons(matchups)),
    get: (a, b) => cells.get(`${a}:${b}`),
  }
}

// ---------------------------------------------------------------------------
// One member's career
// ---------------------------------------------------------------------------

/** A pick, for the draft half of a member page. Optional in {@link HistoryInput}. */
export interface HistoryPick {
  season: number
  managerId: number
  playerName: string
  playerPosition: string
  price: number
}

export interface MemberSeasonRow {
  season: number
  dataTier: DataTier
  place: number | null
  wins: number
  losses: number
  ties: number
  pointsFor: number | null
  pointsAgainst: number | null
  madePlayoffs: boolean
  playoffWins: number | null
  playoffLosses: number | null
  /** Where they finished in the bracket, when they finished on the podium. */
  finish: 'champion' | 'runner-up' | 'third' | null
  prize: number | null
  /** Null when that season's auction is not on record. */
  draftSpend: number | null
  biggestBuy: { playerName: string; price: number } | null
}

export interface MemberProfile {
  member: HistoryMember
  seasons: MemberSeasonRow[]
  allTime: AllTimeStats
  weekly: WeeklyStats | null
  /** Best and worst by regular-season win percentage. Null before any season. */
  bestSeason: MemberSeasonRow | null
  worstSeason: MemberSeasonRow | null
  /** Their record against each opponent, best win rate first. */
  h2h: H2HCell[]
  allTimeCoverage: Coverage
  weeklyCoverage: Coverage
}

/**
 * One member, from every angle the league has a record of.
 *
 * Reuses `leagueSummary` for the career totals rather than recomputing them, so
 * a member page and the all-time table can never disagree — the failure mode
 * that makes people stop trusting both.
 */
export function memberProfile(input: HistoryInput, managerId: number): MemberProfile | null {
  const member = input.members.find((m) => m.managerId === managerId)
  if (!member) return null

  const summary = leagueSummary(input)
  const row = summary.rows.find((r) => r.member.managerId === managerId)
  if (!row) return null

  const bySeason = new Map(input.seasons.map((s) => [s.season, s]))
  const picks = input.picks ?? []

  const seasons: MemberSeasonRow[] = input.standings
    .filter((s) => s.managerId === managerId)
    .sort((a, b) => b.season - a.season)
    .map((s) => {
      const meta = bySeason.get(s.season)
      const mine = picks.filter((p) => p.season === s.season && p.managerId === managerId)
      const biggest = mine.length
        ? mine.reduce((a, b) => (b.price > a.price ? b : a))
        : null
      const finish =
        meta?.championManagerId === managerId
          ? ('champion' as const)
          : meta?.runnerUpManagerId === managerId
            ? ('runner-up' as const)
            : meta?.thirdManagerId === managerId
              ? ('third' as const)
              : null
      return {
        season: s.season,
        dataTier: meta?.dataTier ?? 'standings',
        place: s.place,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        pointsFor: s.pointsFor,
        pointsAgainst: s.pointsAgainst,
        madePlayoffs: s.madePlayoffs,
        playoffWins: s.playoffWins,
        playoffLosses: s.playoffLosses,
        finish,
        prize:
          finish === 'champion'
            ? (meta?.championPrize ?? null)
            : finish === 'runner-up'
              ? (meta?.runnerUpPrize ?? null)
              : finish === 'third'
                ? (meta?.thirdPrize ?? null)
                : null,
        // Null, not zero: a season whose auction is not on record has an unknown
        // spend, and zero would read as "they drafted nobody".
        draftSpend: mine.length ? sum(mine.map((p) => p.price)) : null,
        biggestBuy: biggest ? { playerName: biggest.playerName, price: biggest.price } : null,
      }
    })

  const rate = (s: MemberSeasonRow) => {
    const games = s.wins + s.losses + s.ties
    return games ? s.wins / games : -1
  }
  const played = seasons.filter((s) => s.wins + s.losses + s.ties > 0)
  const ranked = [...played].sort((a, b) => rate(b) - rate(a))

  const h2h = headToHead(input.matchups, input.seasons)
    .cells.filter((c) => c.managerId === managerId)
    .sort((a, b) => {
      const ra = a.wins / Math.max(a.wins + a.losses + a.ties, 1)
      const rb = b.wins / Math.max(b.wins + b.losses + b.ties, 1)
      return rb - ra
    })

  return {
    member,
    seasons,
    allTime: row.allTime,
    weekly: row.weekly,
    bestSeason: ranked[0] ?? null,
    worstSeason: ranked[ranked.length - 1] ?? null,
    h2h,
    allTimeCoverage: summary.allTime,
    weeklyCoverage: summary.weekly,
  }
}
