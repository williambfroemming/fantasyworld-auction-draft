/**
 * The season in progress, measured the ways Sleeper does not measure it.
 *
 * ## Why this exists at all
 *
 * Sleeper already shows a standings table, and this project has a standing rule
 * against rebuilding what a better tool does — it is why the news feed was
 * deleted the day after it was built. So the record is here only as the column
 * everything else is read *against*. The reason to open this page is the rest:
 * a 2-4 record next to the third-best all-play, forty points left on benches,
 * and the hardest schedule in the league are four different explanations of the
 * same two numbers, and none of them exist anywhere else the league can look.
 *
 * ## Everything here is a rate over a partial season
 *
 * ⚠️ This is the single trap that governs the whole file, and it has already
 * been paid for twice — once in `records()`, where one week of football took
 * "best regular-season record" off a 12-2 because a 1-0 is 1.000, and once in
 * the Gazette, where `player_seasons.avg_points` graded a week-seven boom
 * against a full-season average.
 *
 * Two consequences, both structural rather than advisory:
 *
 *   1. **`throughWeek` is part of the result**, so no caller can render these
 *      numbers without being handed the qualifier that makes them honest. A
 *      table headed "2026" is a different and false claim from one headed
 *      "through week 5".
 *   2. **Nothing here is compared against another season.** These are internal
 *      rankings within one partial year. The moment a number from here is
 *      ranked against a finished season it becomes the `records()` bug again,
 *      and `completedStandings()` in `history.ts` is where that belongs.
 *
 * ## Incomplete weeks are skipped, never partially scored
 *
 * `allPlay()` established the rule and the median column follows it: a week
 * where the whole field is not present is dropped and counted, because "beat 5
 * opponents" and "beat 9" are not the same unit. A median taken over six of ten
 * scores is not the league median, and averaging it in silently is how a metric
 * stops meaning anything.
 */
import {
  allPlay,
  highLowWeeks,
  regularSeasonLineups,
  type HistoryLineup,
  type HistoryMatchup,
  type HistorySeason,
} from './history'

export interface SeasonSoFarRow {
  managerId: number

  // --- the record, as Sleeper has it ---------------------------------------
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number

  // --- the same season, scored against the whole field ----------------------
  /** Wins if you had played every other manager every week. */
  allPlayWins: number
  allPlayLosses: number
  allPlayTies: number
  /** 0–1. The honest ranking of how well a team has actually played. */
  allPlayPct: number

  /** Wins if the opponent were the league median score that week. */
  medianWins: number
  medianLosses: number
  medianTies: number

  // --- what the gap between those two means --------------------------------
  /**
   * Games this record "should" be worth, from the all-play rate.
   *
   * Deliberately a real number and not rounded: rounding it makes `luck` land
   * on tidy integers that look like a count of games somebody was robbed of,
   * which is a stronger claim than this measure can support.
   */
  expectedWins: number
  /** Actual wins minus expected. Positive is schedule fortune, not skill. */
  luck: number
  /** Mean score of the opponents faced. The other half of the same story. */
  strengthOfSchedule: number

  // --- management, as opposed to results ------------------------------------
  /** Started points over startable points, 0–1. Null when no lineup is on record. */
  efficiency: number | null
  /** Points left on the bench across the season so far. Null with no lineups. */
  pointsLeft: number | null

  // --- the league's weekly side bet -----------------------------------------
  highWeeks: number
  lowWeeks: number
}

export interface SeasonSoFar {
  season: number
  /** The last regular-season week with a complete set of results. */
  throughWeek: number
  /** Complete regular-season weeks counted. Not the same as `throughWeek`. */
  weeksPlayed: number
  /** Weeks dropped because the whole field was not present. */
  incompleteWeeks: number
  rows: SeasonSoFarRow[]
  /**
   * The league's weekly stake, or null.
   *
   * ⚠️ **Null is unknown, never "no bet".** The league has run a $10 weekly bet
   * from 2024; the years before that are simply not on record, and printing
   * "$0" for them would invent a fact about money. A caller with null shows the
   * counts and says nothing about dollars.
   */
  sideBet: number | null
}

/** The median of a set of scores. Even counts average the middle two. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const round = (n: number, dp = 2) => Number(n.toFixed(dp))

/**
 * Everything above, for one season, from the games actually played.
 *
 * Returns null when no regular-season week is complete — which is the state for
 * most of the year and is emphatically not an error. Out of season, and in the
 * days between the auction and the opener, there is simply nothing to say.
 *
 * ⚠️ Derived from `matchups` rather than from `season_standings`. The standings
 * table is rewritten wholesale by every import and carries the *final* shape of
 * a season, which is the exact source of the backfilled-Gazette bug: a week-7
 * issue reading it printed an 11-3 record for a team that was 4-3. Reading the
 * games means this cannot disagree with the all-play and median columns beside
 * it, because all three count the same rows.
 */
export function seasonSoFar(input: {
  season: number
  matchups: HistoryMatchup[]
  lineups: HistoryLineup[]
  seasons: HistorySeason[]
  sideBet: number | null
}): SeasonSoFar | null {
  const { season, seasons, sideBet } = input
  const mine = input.matchups.filter((m) => m.season === season)
  const regular = mine.filter((m) => !m.isPlayoff)
  if (regular.length === 0) return null

  // The field is the set of managers who have played at all this season, which
  // is how `allPlay` defines it too. Taking it from `managers` instead would
  // break every week for a league that has not filled its seats yet.
  const field = new Set(regular.map((m) => m.managerId)).size

  const byWeek = new Map<number, HistoryMatchup[]>()
  for (const m of regular) {
    const list = byWeek.get(m.week) ?? []
    list.push(m)
    byWeek.set(m.week, list)
  }

  const complete = [...byWeek.entries()]
    .filter(([, rows]) => rows.length === field)
    .sort((a, b) => a[0] - b[0])
  if (complete.length === 0) return null

  const incompleteWeeks = byWeek.size - complete.length
  const throughWeek = complete[complete.length - 1][0]

  // --- the record, and the schedule that produced it -------------------------
  interface Tally {
    wins: number; losses: number; ties: number
    pointsFor: number; pointsAgainst: number
    medianWins: number; medianLosses: number; medianTies: number
    opponents: number[]
  }
  const tally = new Map<number, Tally>()
  const blank = (): Tally => ({
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    medianWins: 0, medianLosses: 0, medianTies: 0, opponents: [],
  })

  for (const [, rows] of complete) {
    // One median per week, over the whole field. See the header: a median from
    // a partial week is not the league median.
    const line = median(rows.map((r) => r.points))
    for (const r of rows) {
      const t = tally.get(r.managerId) ?? blank()
      if (r.result === 'W') t.wins++
      else if (r.result === 'L') t.losses++
      else t.ties++
      t.pointsFor += r.points
      t.pointsAgainst += r.opponentPoints
      t.opponents.push(r.opponentPoints)
      if (r.points > line) t.medianWins++
      else if (r.points < line) t.medianLosses++
      else t.medianTies++
      tally.set(r.managerId, t)
    }
  }

  // --- all-play, reused rather than reimplemented ----------------------------
  // Same function the history pages use, handed one season's games. Two
  // implementations of "how would you have done against everyone" that merely
  // agree today are the setup for the two disagreeing later.
  const ap = allPlay(regular, seasons)
  const apByManager = new Map(ap.rows.map((r) => [r.managerId, r]))

  const hl = highLowWeeks(regular, seasons)
  const hlByManager = new Map(hl.rows.map((r) => [r.managerId, r]))

  // --- lineup efficiency -----------------------------------------------------
  const seasonLineups = regularSeasonLineups(
    input.lineups.filter((l) => l.season === season),
    regular,
  )
  const lineupByManager = new Map<number, { actual: number; optimal: number }>()
  for (const l of seasonLineups) {
    const cur = lineupByManager.get(l.managerId) ?? { actual: 0, optimal: 0 }
    cur.actual += l.actual
    cur.optimal += l.optimal
    lineupByManager.set(l.managerId, cur)
  }

  const rows: SeasonSoFarRow[] = [...tally.entries()].map(([managerId, t]) => {
    const games = t.wins + t.losses + t.ties
    const apRow = apByManager.get(managerId)
    const allPlayPct = apRow?.pct ?? 0
    const expectedWins = allPlayPct * games
    const lu = lineupByManager.get(managerId)

    return {
      managerId,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: round(t.pointsFor),
      pointsAgainst: round(t.pointsAgainst),
      allPlayWins: apRow?.wins ?? 0,
      allPlayLosses: apRow?.losses ?? 0,
      allPlayTies: apRow?.ties ?? 0,
      allPlayPct,
      medianWins: t.medianWins,
      medianLosses: t.medianLosses,
      medianTies: t.medianTies,
      expectedWins: round(expectedWins),
      luck: round(t.wins - expectedWins),
      strengthOfSchedule: t.opponents.length
        ? round(t.opponents.reduce((s, n) => s + n, 0) / t.opponents.length)
        : 0,
      // Null rather than 1.0 when no lineup is on record: a season with no
      // lineup data has not been proven perfectly managed, it is unmeasured.
      efficiency: lu && lu.optimal > 0 ? round(lu.actual / lu.optimal, 4) : null,
      pointsLeft: lu ? round(lu.optimal - lu.actual) : null,
      highWeeks: hlByManager.get(managerId)?.highWeeks ?? 0,
      lowWeeks: hlByManager.get(managerId)?.lowWeeks ?? 0,
    }
  })

  // Sorted by the honest measure rather than by the record, which is the whole
  // argument of the page. The record is still the first column drawn.
  rows.sort((a, b) => b.allPlayPct - a.allPlayPct || b.pointsFor - a.pointsFor)

  return {
    season,
    throughWeek,
    weeksPlayed: complete.length,
    incompleteWeeks,
    rows,
    sideBet,
  }
}
