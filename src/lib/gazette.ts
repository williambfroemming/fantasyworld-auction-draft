/**
 * The FantasyWorld Gazette — everything an issue knows, computed from history.
 *
 * The pure half of the pair. `src/server/gazette-service.ts` does the queries and
 * converts types at the boundary; nothing here touches a database or the network,
 * so every section below has a literal-fixture test.
 *
 * ## The one rule that governs this whole file
 *
 * **An issue may never know about a game that had not been played when it went to
 * press.** Every derivation filters to `season < S || (season === S && week <= W)`
 * before it computes anything. That sounds obvious and is the easiest thing in the
 * feature to get wrong, in three specific ways:
 *
 *  1. `season_standings` is season-grain and the importer rewrites it wholesale on
 *     every refresh, so **the row for the season in progress holds its FINAL
 *     table.** Reading it for a backfilled week 7 issue would print an 11-3 record
 *     for a team that was 4-3 at press time. Every record, streak and rank here is
 *     therefore derived from matchups.
 *
 *     The one deliberate exception is career totals in Milestone Watch, which read
 *     standings for **completed earlier seasons only** — that table is the only
 *     place wins and points exist before 2020, and a season that is already over
 *     cannot leak the future. See `buildMilestones`.
 *  2. `player_seasons.avg_points` is likewise the *final* season average, so
 *     judging a week 7 explosion against it quietly grades the player on games
 *     they had not played yet. Averages here are computed from weeks before the
 *     one being written about.
 *  3. `records()`, `allPlay()` and `headToHead()` all take matchups directly, so
 *     they are correct only if what you hand them is already filtered.
 *
 * ## Money in The Ledger
 *
 * There isn't any, and that is deliberate — see `highLowWeeks()` in `history.ts`.
 * The league runs a weekly side bet, but the per-season rate is not on record for
 * most years, so the Gazette reports how often somebody topped or propped the
 * table rather than inventing a dollar figure. The count says the same thing and
 * cannot be wrong.
 */
import {
  allPlay,
  coverageFor,
  headToHead,
  highLowWeeks,
  isCountedPlayoff,
  leagueSummary,
  records,
  regularSeasonLineups,
  type Coverage,
  type HistoryInput,
  type HistoryMatchup,
  type HistorySeason,
} from './history'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One rostered player's line in one week. */
export interface GazettePlayerWeek {
  season: number
  week: number
  managerId: number
  playerId: string
  player: string | null
  position: string | null
  nflTeam: string | null
  isStarter: boolean
  /** The lineup slot they filled, when they started. Null on the bench. */
  slot: string | null
  points: number
}

/** What a previously published issue carries forward. */
export interface PriorIssue {
  season: number
  week: number
  headline: string
  columnText: string
  threads: Thread[]
  /**
   * The world that issue was actually told through.
   *
   * Null for anything written before the field existed. Carried so the season's
   * spent lenses can be handed to the next edition — the calendar keeps two
   * worlds from being *assigned* alike, and this is what keeps them from being
   * *written* alike, which is a different failure. Weeks eight and nine were
   * assigned Halloween Horror and Witches and Covens, and came back as "folk
   * horror harvest" and "witch-trial ordeal": two distinct entries on the
   * calendar, one indistinguishable world on the page.
   */
  lens: string | null
  /** Who held the belt that week, so its history is readable without a join. */
  beltManagerId: number | null
  /** Stat ids already used, so the rotating slot does not repeat itself. */
  statIds: string[]
}

/**
 * One line of the reporter's notebook, carried into next week's edition.
 *
 * The four kinds are the four things a columnist actually keeps: a bit he can
 * run again, a thesis he is building about somebody, a promise he made that has
 * to be paid off, and his private read on where the season is going. Splitting
 * them beats a flat list because they age differently — a bit gets funnier by
 * repetition, a callback becomes a debt, and an arc note is only ever a draft.
 */
export interface Thread {
  id: string
  /** Optional only so issues written before the notebook had sections still parse. */
  kind?: 'bit' | 'thesis' | 'callback' | 'arc'
  note: string
}

export interface GazetteInput {
  season: number
  week: number
  /**
   * The whole league record. Filtered here, not by the caller — a caller that
   * filters is a caller that can forget to.
   */
  history: HistoryInput
  /** Every rostered player's line, weeks 1..week of this season. */
  playersToDate: GazettePlayerWeek[]
  /**
   * What the low scorer pays the high scorer each week, this season.
   *
   * Null for every season before the league started recording it. See
   * `seasons.side_bet`, and `LedgerRow.net`.
   */
  sideBet: number | null
  /** Published issues of this season before this week, oldest first. */
  priorIssues: PriorIssue[]
}

// ---------------------------------------------------------------------------
// Output — the fact pack. This is what the model sees and what gets stored.
// ---------------------------------------------------------------------------

export interface NamedScore {
  player: string
  position: string | null
  nflTeam: string | null
  points: number
  manager: string
}

export interface GameNoteFacts {
  winner: string | null
  loser: string | null
  winnerPoints: number
  loserPoints: number
  margin: number
  tie: boolean
  isPlayoff: boolean
  decides: 'the championship' | 'third place' | 'fifth place' | null
  /** 1 = highest score in the league this week. */
  winnerWeekRank: number
  loserWeekRank: number
  /** Points the loser left on their bench. The good stuff. */
  loserBenchPoints: number
  winnerBenchPoints: number
  /** Records after this result. */
  winnerRecord: string | null
  loserRecord: string | null
  winnerStreak: string | null
  loserStreak: string | null
  /** Lifetime head to head after this result, from the winner's side. */
  lifetime: string | null
  loserSeasonLow: boolean
  winnerSeasonHigh: boolean
}

export interface PowerRow {
  manager: string
  rank: number
  /** Movement since last week's issue. Null in week one. */
  move: number | null
  allPlayRecord: string
  pointsFor: number
  efficiencyPct: number
  record: string
}

export interface StandingsRow {
  manager: string
  place: number
  record: string
  pointsFor: number
  move: number | null
}

export interface LedgerRow {
  manager: string
  highWeeks: number
  lowWeeks: number
  /** Took the high this week, propped it up, or neither. */
  thisWeek: 'high' | 'low' | null
  /**
   * Season-to-date net in dollars, when the season's rate is known.
   *
   * **Null is unknown, not zero.** The league has only run the side bet at a
   * recorded rate for the last couple of seasons; a backfilled 2020 issue must
   * say nothing about money rather than claim everybody broke even.
   */
  net: number | null
}

export interface BeltFacts {
  manager: string
  /** Consecutive weeks the current holder has kept it. */
  heldFor: number
  previousHolder: string | null
  /** Who has held it most this season. */
  mostWeeks: { manager: string; weeks: number } | null
  reason: string
}

export interface HistoryEcho {
  season: number
  claim: string
  detail: string
}

export interface Milestone {
  manager: string
  label: string
  /** Crossed it this week, or is close to it. */
  crossed: boolean
  value: number
  threshold: number
  /** Only when `crossed` is false. */
  away: number | null
  coverage: Coverage
}

export interface StatCandidate {
  id: string
  category: string
  claim: string
  value: number
  detail: string
  /** 0..1, comparable across categories. See `rarity()`. */
  surprise: number
  coverage: Coverage
}

export interface RivalryNote {
  claim: string
  detail: string
}

export interface RecordNote {
  claim: string
  detail: string
  nearMiss: boolean
}

/**
 * The lens each week is told through, by week number.
 *
 * Fixed for season one — no selection logic runs this year, so the genre is
 * read straight off the list and is therefore reproducible: regenerating week
 * eight next year gets the same frame it got today.
 *
 * ⚠️ **A lens, not a costume.** The genre supplies the metaphor system Gordon
 * reaches into for the week; it never touches his diction. He does not write
 * "verily" in the medieval week or "cap'n" in the pirate one. That failure mode
 * is the reason the voice rules forbid deflating the subject: a frame that makes
 * fantasy football sound whimsical is working directly against the only joke
 * the column has, which is that it treats the thing with unearned gravity.
 *
 * Applies to backfilled seasons too, which is deliberate — an archive where
 * week eight is always the horror issue reads as a publication with a house
 * calendar rather than a pile of generated text.
 */
/** Season one. Week 1 issues 15 September 2026, which lands week 8 on Halloween. */
const SEASON_ONE: Record<number, string> = {
  1: 'Medieval Kingdom',
  2: 'Noir Detective',
  3: 'Space Opera',
  4: 'Heist',
  5: 'Greek Mythology',
  6: 'Pirates and the High Seas',
  7: 'Western Frontier',
  8: 'Halloween Horror',
  // ⚠️ NOT a second espionage week. Week 11 is Cold War Espionage, two editions
  // later, and the two must not converge -- so this entry names the register
  // rather than the subject. This is the SPECTRE end of the genre: dinner
  // jackets, a casino, a mountaintop lair, a named villain with a scheme and a
  // henchman. Week 11 is the le Carre end: drab, bureaucratic, a betrayal at a
  // crossing point, nobody enjoying themselves. `priorLenses` in the pack is
  // what enforces the gap at generation time; this comment is what stops a
  // future editor collapsing the two back together.
  //
  // It replaced Witches and Covens, which sat directly beside Halloween Horror
  // and gave the season its only pair of genuinely similar consecutive weeks.
  // Named by REGISTER, not by subject. "Superspy Thriller" alone was read as
  // espionage-in-general and drifted straight into week 11's assignment: the
  // first run of this entry came back lensed "Cold War espionage", producing two
  // identical worlds two editions apart. The parenthetical is the steer.
  9: 'Superspy Thriller (dinner jackets, a casino, a mountaintop lair, a named villain with a scheme)',
  10: 'Wonderland',
  // ⚠️ NOT "War Correspondent". Gordon's baseline persona already is one --
  // "the gravitas of a war correspondent filing from a collapsing capital" --
  // so that frame asks him to shift into the voice he never leaves, and the
  // week comes out with no lens at all. A genre has to be somewhere he is not
  // standing already.
  11: 'Cold War Espionage',
  12: 'Court Intrigue',
  13: 'Post-Apocalyptic Survival',
  14: 'Gladiator',
  15: 'Epic Fantasy War Council',
  16: 'Mythic Underworld',
  17: 'Arthurian Legend',
}

/**
 * A calendar per season, because the list changes every year.
 *
 * Add next year as a new entry rather than editing this one. The calendar is
 * part of what an issue *was*, so rewriting a past season's list would silently
 * relabel issues already published under a different frame — and the whole
 * argument for a fixed list is that regenerating week eight gets the same frame
 * it got the first time.
 */
export const GENRE_CALENDARS: Record<number, Record<number, string>> = {
  // The shakedown year. 2025 is already played, so it is what the frame was
  // tested against; delete this entry once season one is under way.
  2025: SEASON_ONE,
  2026: SEASON_ONE,
}

/**
 * The lens for one week, or null for a season with no calendar of its own.
 *
 * Null is correct rather than a fallback: a season the Gazette never covered
 * should not be retrofitted with a house calendar it never had.
 */
export function genreFor(season: number, week: number): string | null {
  return GENRE_CALENDARS[season]?.[week] ?? null
}

export interface GazetteFacts {
  /**
   * Which pack this is. See {@link isPreview}.
   *
   * Optional, and absent on every issue stored before the preview existed — so
   * the discriminant is always tested as `=== 'preview'` and never as
   * `=== 'week'`, which would misread the whole back catalogue.
   */
  kind?: 'week'
  season: number
  week: number
  weekLabel: string
  /** The week's lens, or null for a season with no calendar. See GENRE_CALENDARS. */
  genre: string | null
  phase: 'regular' | 'playoff' | 'consolation'
  /** NOT always ten. A playoff week has four to six sides. */
  teamsPlaying: number

  games: GameNoteFacts[]
  standings: StandingsRow[]
  powerRankings: PowerRow[]
  againstTheField: Array<{ manager: string; record: string; points: number }>
  ledger: LedgerRow[]
  /** What the low scorer pays the high scorer this season. Null when unknown. */
  sideBet: number | null
  belt: BeltFacts | null
  thisWeekInHistory: HistoryEcho[]
  milestones: Milestone[]
  recordBook: RecordNote[]
  rivalry: RivalryNote[]
  stats: StatCandidate[]

  /**
   * Genres the calendar has assigned to OTHER weeks of this season.
   *
   * `priorLenses` only knows what has already been printed, which leaves an
   * edition free to wander into a world belonging to a week that has not
   * happened yet — and that is exactly what happened. Week nine was assigned a
   * superspy thriller, read it as espionage-in-general, and filed "Cold War
   * espionage": week ELEVEN's assignment, two editions early, producing the one
   * thing the calendar exists to prevent.
   *
   * The calendar is fixed and knowable in both directions, so the model is told
   * what is spoken for rather than left to infer it from what it has seen.
   */
  reservedGenres: string[]

  /** Continuity, for the prompt. Not printed. */
  priorThreads: Thread[]
  priorColumns: string[]
  priorHeadlines: string[]
  /**
   * Worlds this season has already been told through, oldest first.
   *
   * The calendar stops two weeks being *assigned* the same genre; this stops
   * them being *written* the same. See {@link PriorIssue.lens}.
   */
  priorLenses: string[]

  notes: string[]
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const r2 = (n: number) => Number(n.toFixed(2))

/** Everything that had happened by the end of `week` of `season`, and no more. */
export function upTo<T extends { season: number; week: number }>(
  rows: T[],
  season: number,
  week: number,
): T[] {
  return rows.filter((r) => r.season < season || (r.season === season && r.week <= week))
}

/**
 * How unusual a value is among its own history, as a 0..1 percentile.
 *
 * This is the piece that makes the rotating slot work. Ranking a boom against a
 * streak against a coincidence means the scores have to be comparable across
 * categories — raw magnitude is not, because a 40-point bust and a 6-week streak
 * are different units. Percentile is: "more extreme than 97% of every one of
 * these on record" means the same thing whatever `these` are.
 *
 * `population` should be every comparable value the league has ever produced,
 * including the one being scored.
 */
/**
 * How unusual a candidate has to be to reach the page at all.
 *
 * Some weeks nothing remarkable happens, and the honest thing is to say less
 * rather than to dress an ordinary afternoon up in record-book language. A
 * section that prints a superlative every week regardless teaches the reader
 * that its superlatives mean nothing — which is worse than the section being
 * absent, because it also devalues the weeks where something really did happen.
 */
export const MIN_SURPRISE = 0.6

export function rarity(value: number, population: number[]): number {
  if (population.length < 2) return 0
  const below = population.filter((p) => Math.abs(p) < Math.abs(value)).length
  return Number((below / (population.length - 1)).toFixed(4))
}

/** 'W-L' or 'W-L-T', from matchups already filtered to the point in time. */
function recordOf(rows: HistoryMatchup[]): string {
  const w = rows.filter((m) => m.result === 'W').length
  const l = rows.filter((m) => m.result === 'L').length
  const t = rows.filter((m) => m.result === 'T').length
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`
}

/** 'W3' / 'L2' — the current run, within one season only. */
function streakOf(rows: HistoryMatchup[]): string | null {
  const ordered = [...rows].sort((a, b) => a.week - b.week)
  const last = ordered[ordered.length - 1]
  if (!last || last.result === 'T') return null
  let n = 0
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i].result !== last.result) break
    n++
  }
  return `${last.result}${n}`
}

/**
 * What to call this week in print.
 *
 * Derived from the season, never a constant: 2020 played 13 regular-season weeks
 * and 2021 onward play 14, so week 14 is a playoff game in one era and a regular
 * one in the next.
 */
export function weekLabel(season: HistorySeason | undefined, week: number, games: HistoryMatchup[]): {
  label: string
  phase: GazetteFacts['phase']
} {
  const playoff = games.some((g) => g.isPlayoff)
  if (!playoff) return { label: `Week ${week}`, phase: 'regular' }

  const placements = new Set(games.map((g) => g.playoffPlacement))
  if (placements.size === 1 && placements.has(5)) {
    return { label: `Week ${week} — consolation`, phase: 'consolation' }
  }
  const reg = season?.regularSeasonWeeks ?? null
  const round = reg === null ? null : week - reg
  const label =
    round === 1 ? 'Quarter-finals' : round === 2 ? 'Semi-finals' : round === 3 ? 'The final' : `Week ${week}`
  return { label, phase: 'playoff' }
}

// ---------------------------------------------------------------------------
// The Front Page
// ---------------------------------------------------------------------------

/**
 * What a game decided, when it decided anything.
 *
 * `playoffPlacement` is null on the championship path and 3 or 5 for a placement
 * game, so the final is "a playoff game on the championship path in the last
 * round" — which is only knowable from the week label, since the last round
 * moves with `regularSeasonWeeks`.
 */
function decidesFor(m: HistoryMatchup, isFinal: boolean): GameNoteFacts['decides'] {
  if (!m.isPlayoff) return null
  if (m.playoffPlacement === 3) return 'third place'
  if (m.playoffPlacement === 5) return 'fifth place'
  return isFinal && m.playoffPlacement === null ? 'the championship' : null
}

function buildGames(
  week: HistoryMatchup[],
  isFinal: boolean,
  name: (id: number) => string,
  rank: Map<number, number>,
  bench: Map<number, number>,
  recordAfter: Map<number, string>,
  streakAfter: Map<number, string | null>,
  lifetime: Map<string, string>,
  seasonHigh: number,
  seasonLow: number,
): GameNoteFacts[] {
  const seen = new Set<number>()
  const out: GameNoteFacts[] = []

  for (const side of week) {
    if (seen.has(side.managerId)) continue
    seen.add(side.managerId)
    seen.add(side.opponentManagerId)

    const tie = side.result === 'T'
    const won = side.result === 'W'
    const winner = tie ? null : won ? side.managerId : side.opponentManagerId
    const loser = tie ? null : won ? side.opponentManagerId : side.managerId
    const winnerPoints = tie ? side.points : Math.max(side.points, side.opponentPoints)
    const loserPoints = tie ? side.opponentPoints : Math.min(side.points, side.opponentPoints)

    out.push({
      winner: winner === null ? null : name(winner),
      loser: loser === null ? null : name(loser),
      winnerPoints: r2(winnerPoints),
      loserPoints: r2(loserPoints),
      margin: r2(winnerPoints - loserPoints),
      tie,
      isPlayoff: side.isPlayoff,
      decides: decidesFor(side, isFinal),
      winnerWeekRank: winner === null ? 0 : (rank.get(winner) ?? 0),
      loserWeekRank: loser === null ? 0 : (rank.get(loser) ?? 0),
      winnerBenchPoints: winner === null ? 0 : r2(bench.get(winner) ?? 0),
      loserBenchPoints: loser === null ? 0 : r2(bench.get(loser) ?? 0),
      winnerRecord: winner === null ? null : (recordAfter.get(winner) ?? null),
      loserRecord: loser === null ? null : (recordAfter.get(loser) ?? null),
      winnerStreak: winner === null ? null : (streakAfter.get(winner) ?? null),
      loserStreak: loser === null ? null : (streakAfter.get(loser) ?? null),
      lifetime: winner === null || loser === null ? null : (lifetime.get(`${winner}:${loser}`) ?? null),
      loserSeasonLow: loserPoints === seasonLow,
      winnerSeasonHigh: winnerPoints === seasonHigh,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------

/**
 * Everything worth saying about one week.
 *
 * Returns null when the week has no games — which is the normal state 35 weeks a
 * year, and must be a quiet no-op rather than an empty issue.
 */
export function weekInReview(input: GazetteInput): GazetteFacts | null {
  const { season, week, history, playersToDate, priorIssues, sideBet } = input

  const nameOf = new Map(history.members.map((m) => [m.managerId, m.displayName]))
  const name = (id: number) => nameOf.get(id) ?? '?'

  // Rule one: nothing may see past this week.
  const toDate = upTo(history.matchups, season, week)
  const thisWeek = toDate.filter((m) => m.season === season && m.week === week)
  if (thisWeek.length === 0) return null

  const seasonRow = history.seasons.find((s) => s.season === season)
  const { label, phase } = weekLabel(seasonRow, week, thisWeek)
  const teamsPlaying = thisWeek.length

  // --- this week's shape ---------------------------------------------------
  const byPoints = [...thisWeek].sort((a, b) => b.points - a.points)
  const rank = new Map(byPoints.map((m, i) => [m.managerId, i + 1]))

  const lineupsThisWeek = history.lineups.filter((l) => l.season === season && l.week === week)
  const bench = new Map(lineupsThisWeek.map((l) => [l.managerId, Math.max(0, l.optimal - l.actual)]))

  const seasonToDateRegular = toDate.filter((m) => m.season === season && !m.isPlayoff)
  const seasonHigh = Math.max(...seasonToDateRegular.map((m) => m.points))
  const seasonLow = Math.min(...seasonToDateRegular.map((m) => m.points))

  const recordAfter = new Map<number, string>()
  const streakAfter = new Map<number, string | null>()
  for (const m of history.members) {
    const mine = seasonToDateRegular.filter((x) => x.managerId === m.managerId)
    recordAfter.set(m.managerId, recordOf(mine))
    streakAfter.set(m.managerId, streakOf(mine))
  }

  // Lifetime head to head, as of now. `headToHead` is regular season only and
  // takes matchups directly, so the filtered set is what makes this honest.
  const h2h = headToHead(toDate, history.seasons)
  const lifetime = new Map<string, string>()
  for (const a of history.members) {
    for (const b of history.members) {
      if (a.managerId === b.managerId) continue
      const cell = h2h.get(a.managerId, b.managerId)
      if (!cell) continue
      lifetime.set(
        `${a.managerId}:${b.managerId}`,
        cell.ties > 0
          ? `${cell.wins}-${cell.losses}-${cell.ties}`
          : `${cell.wins}-${cell.losses}`,
      )
    }
  }

  const games = buildGames(
    thisWeek,
    label === 'The final',
    name,
    rank,
    bench,
    recordAfter,
    streakAfter,
    lifetime,
    seasonHigh,
    seasonLow,
  )

  // --- standings and power rankings ---------------------------------------
  const lastWeekPlaces = placesAsOf(history, season, week - 1, name)

  const standings: StandingsRow[] = history.members
    .map((m) => {
      const mine = seasonToDateRegular.filter((x) => x.managerId === m.managerId)
      return {
        manager: m.displayName,
        place: 0,
        record: recordOf(mine),
        pointsFor: r2(mine.reduce((s, x) => s + x.points, 0)),
        move: null as number | null,
      }
    })
    .filter((row) => row.record !== '0-0')
    .sort((a, b) => {
      const aw = Number(a.record.split('-')[0])
      const bw = Number(b.record.split('-')[0])
      return bw - aw || b.pointsFor - a.pointsFor
    })
    .map((row, i) => ({
      ...row,
      place: i + 1,
      move: lastWeekPlaces.has(row.manager) ? (lastWeekPlaces.get(row.manager) ?? 0) - (i + 1) : null,
    }))

  const ap = allPlay(
    toDate.filter((m) => m.season === season),
    history.seasons,
  )
  const apByManager = new Map(ap.rows.map((r) => [r.managerId, r]))

  // Regular season only, same scope as the all-play record printed beside it.
  // The `week <= week` bound already did this for weeks 1-14; from week 15 the
  // playoff and consolation weeks would otherwise leak in. See
  // `regularSeasonLineups` for why those weeks are a different question.
  const regularLineups = regularSeasonLineups(history.lineups, history.matchups)
  const efficiency = new Map<number, number>()
  for (const m of history.members) {
    const mine = regularLineups.filter(
      (l) => l.season === season && l.week <= week && l.managerId === m.managerId,
    )
    const actual = mine.reduce((s, l) => s + l.actual, 0)
    const optimal = mine.reduce((s, l) => s + l.optimal, 0)
    if (optimal > 0) efficiency.set(m.managerId, (actual / optimal) * 100)
  }

  const powerScore = (id: number) => {
    const a = apByManager.get(id)
    const pf = seasonToDateRegular.filter((x) => x.managerId === id).reduce((s, x) => s + x.points, 0)
    const eff = efficiency.get(id) ?? 0
    return (a?.pct ?? 0) * 100 + pf / 100 + eff / 10
  }

  const lastWeekPower = powerAsOf(history, season, week - 1, name)

  const powerRankings: PowerRow[] = history.members
    .filter((m) => seasonToDateRegular.some((x) => x.managerId === m.managerId))
    .map((m) => ({
      manager: m.displayName,
      rank: 0,
      move: null as number | null,
      allPlayRecord: apByManager.get(m.managerId)
        ? `${apByManager.get(m.managerId)!.wins}-${apByManager.get(m.managerId)!.losses}`
        : '—',
      pointsFor: r2(
        seasonToDateRegular.filter((x) => x.managerId === m.managerId).reduce((s, x) => s + x.points, 0),
      ),
      efficiencyPct: r2(efficiency.get(m.managerId) ?? 0),
      record: recordAfter.get(m.managerId) ?? '0-0',
      score: powerScore(m.managerId),
    }))
    .sort((a, b) => b.score - a.score)
    .map((row, i): PowerRow => ({
      manager: row.manager,
      rank: i + 1,
      move: lastWeekPower.has(row.manager) ? (lastWeekPower.get(row.manager) ?? 0) - (i + 1) : null,
      allPlayRecord: row.allPlayRecord,
      pointsFor: row.pointsFor,
      efficiencyPct: row.efficiencyPct,
      record: row.record,
    }))

  // --- Against the Field, this week only ----------------------------------
  const againstTheField = byPoints.map((m) => {
    const beat = thisWeek.filter((o) => o.managerId !== m.managerId && o.points < m.points).length
    const lost = thisWeek.filter((o) => o.managerId !== m.managerId && o.points > m.points).length
    return { manager: name(m.managerId), record: `${beat}-${lost}`, points: r2(m.points) }
  })

  // --- The Ledger. Counts, never dollars -- see the header note. ----------
  const hl = highLowWeeks(
    toDate.filter((m) => m.season === season),
    history.seasons,
  )
  const weekHigh = byPoints[0]
  const weekLow = byPoints[byPoints.length - 1]
  const ledger: LedgerRow[] = hl.rows.map((row) => ({
    manager: name(row.managerId),
    highWeeks: row.highWeeks,
    lowWeeks: row.lowWeeks,
    thisWeek:
      row.managerId === weekHigh?.managerId
        ? 'high'
        : row.managerId === weekLow?.managerId
          ? 'low'
          : null,
    net: sideBet === null ? null : (row.highWeeks - row.lowWeeks) * sideBet,
  }))

  // --- The Belt -----------------------------------------------------------
  const belt = buildBelt(thisWeek, bench, name, priorIssues)

  // --- This Week in History -----------------------------------------------
  const thisWeekInHistory: HistoryEcho[] = history.matchups
    .filter((m) => m.week === week && m.season < season && !m.isPlayoff)
    .reduce<HistoryEcho[]>((acc, m) => {
      if (m.result !== 'W') return acc
      const existing = acc.find((e) => e.season === m.season)
      const margin = m.points - m.opponentPoints
      if (!existing || margin > Number(existing.detail.split(' ')[0])) {
        const echo: HistoryEcho = {
          season: m.season,
          claim: `${name(m.managerId)} beat ${name(m.opponentManagerId)} in week ${week} of ${m.season}`,
          detail: `${r2(margin)} point margin, ${r2(m.points)} to ${r2(m.opponentPoints)}`,
        }
        return existing ? acc.map((e) => (e.season === m.season ? echo : e)) : [...acc, echo]
      }
      return acc
    }, [])
    .sort((a, b) => b.season - a.season)
    .slice(0, 4)

  // --- Milestones ---------------------------------------------------------
  const milestones = buildMilestones(history, season, week, name)

  // --- Record book --------------------------------------------------------
  const recordBook = buildRecordBook(history, season, week, name)

  // --- Rivalry ------------------------------------------------------------
  const rivalry = buildRivalry(games, h2h)

  // --- Stat of the week ---------------------------------------------------
  const recentStatIds = new Set(priorIssues.slice(-3).flatMap((i) => i.statIds))
  const stats = runGenerators({
    input,
    toDate,
    thisWeek,
    name,
    playersToDate,
    history,
    season,
    week,
    standings,
    powerRankings,
  })
    .filter((c) => !recentStatIds.has(c.id))
    .filter((c) => c.surprise >= MIN_SURPRISE)
    .sort((a, b) => b.surprise - a.surprise)
    .slice(0, 10)

  const notes: string[] = []
  if (teamsPlaying < history.members.length) {
    notes.push(
      `Only ${teamsPlaying} teams played this week. Every league-wide figure here is over those ${teamsPlaying}, not over ten.`,
    )
  }

  const recent = priorIssues.slice(-2)
  return {
    season,
    week,
    weekLabel: label,
    genre: genreFor(season, week),
    // Every OTHER week's assignment, in calendar order. Both directions: a week
    // can drift into a genre that has not been printed yet just as easily as
    // into one that has.
    reservedGenres: Object.entries(GENRE_CALENDARS[season] ?? {})
      .filter(([w]) => Number(w) !== week)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, g]) => g),
    phase,
    teamsPlaying,
    games,
    standings,
    powerRankings,
    againstTheField,
    ledger,
    sideBet,
    belt,
    thisWeekInHistory,
    milestones,
    recordBook,
    rivalry,
    stats,
    priorThreads: priorIssues[priorIssues.length - 1]?.threads ?? [],
    priorColumns: recent.map((i) => i.columnText),
    priorHeadlines: priorIssues.slice(-4).map((i) => i.headline),
    priorLenses: priorIssues.map((i) => i.lens).filter((l): l is string => l !== null),
    notes,
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function placesAsOf(
  history: HistoryInput,
  season: number,
  week: number,
  name: (id: number) => string,
): Map<string, number> {
  const out = new Map<string, number>()
  if (week < 1) return out
  const rows = history.matchups.filter((m) => m.season === season && m.week <= week && !m.isPlayoff)
  if (!rows.length) return out
  const byManager = new Map<number, HistoryMatchup[]>()
  for (const m of rows) byManager.set(m.managerId, [...(byManager.get(m.managerId) ?? []), m])
  const ordered = [...byManager.entries()]
    .map(([id, mine]) => ({
      id,
      wins: mine.filter((m) => m.result === 'W').length,
      pf: mine.reduce((s, m) => s + m.points, 0),
    }))
    .sort((a, b) => b.wins - a.wins || b.pf - a.pf)
  ordered.forEach((row, i) => out.set(name(row.id), i + 1))
  return out
}

function powerAsOf(
  history: HistoryInput,
  season: number,
  week: number,
  name: (id: number) => string,
): Map<string, number> {
  const out = new Map<string, number>()
  if (week < 1) return out
  const rows = history.matchups.filter((m) => m.season === season && m.week <= week && !m.isPlayoff)
  if (!rows.length) return out
  const ap = allPlay(rows, history.seasons)
  // Must use the same scope as the live power rankings, or the move arrows
  // annotate a column computed a different way and a man appears to have moved
  // when only the definition did.
  const regularLineups = regularSeasonLineups(history.lineups, history.matchups)
  const byManager = new Map<number, HistoryMatchup[]>()
  for (const m of rows) byManager.set(m.managerId, [...(byManager.get(m.managerId) ?? []), m])
  const ordered = [...byManager.entries()]
    .map(([id, mine]) => {
      const a = ap.rows.find((r) => r.managerId === id)
      const lin = regularLineups.filter(
        (l) => l.season === season && l.week <= week && l.managerId === id,
      )
      const optimal = lin.reduce((s, l) => s + l.optimal, 0)
      const eff = optimal > 0 ? (lin.reduce((s, l) => s + l.actual, 0) / optimal) * 100 : 0
      return {
        id,
        score: (a?.pct ?? 0) * 100 + mine.reduce((s, m) => s + m.points, 0) / 100 + eff / 10,
      }
    })
    .sort((a, b) => b.score - a.score)
  ordered.forEach((row, i) => out.set(name(row.id), i + 1))
  return out
}

/**
 * The belt goes to the week's worst piece of management, not simply its worst
 * score. Losing while leaving a pile on the bench beats losing badly with the
 * best available lineup — the first is a decision and the second is a roster.
 */
function buildBelt(
  thisWeek: HistoryMatchup[],
  bench: Map<number, number>,
  name: (id: number) => string,
  priorIssues: PriorIssue[],
): BeltFacts | null {
  if (!thisWeek.length) return null

  const scored = thisWeek.map((m) => ({
    managerId: m.managerId,
    lost: m.result === 'L',
    points: m.points,
    benchPoints: bench.get(m.managerId) ?? 0,
    // Losing is the entry fee; the bench is the aggravating factor.
    score: (m.result === 'L' ? 100 : 0) + (bench.get(m.managerId) ?? 0) * 2 - m.points / 10,
  }))
  const worst = scored.reduce((a, b) => (b.score > a.score ? b : a))

  const holder = name(worst.managerId)
  let heldFor = 1
  for (let i = priorIssues.length - 1; i >= 0; i--) {
    if (priorIssues[i].beltManagerId === worst.managerId) heldFor++
    else break
  }
  const previous = priorIssues[priorIssues.length - 1]?.beltManagerId ?? null

  const tally = new Map<number, number>()
  for (const issue of priorIssues) {
    if (issue.beltManagerId === null) continue
    tally.set(issue.beltManagerId, (tally.get(issue.beltManagerId) ?? 0) + 1)
  }
  tally.set(worst.managerId, (tally.get(worst.managerId) ?? 0) + 1)
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]

  return {
    manager: holder,
    heldFor,
    previousHolder: previous === null ? null : name(previous),
    mostWeeks: top ? { manager: name(top[0]), weeks: top[1] } : null,
    reason: worst.lost
      ? `lost with ${r2(worst.benchPoints)} points still on the bench`
      : `won, but left ${r2(worst.benchPoints)} points on the bench doing it`,
  }
}

/**
 * The thresholds worth stopping the press for.
 *
 * Spaced for an ALL-TIME career rather than a Sleeper-era one: the record starts
 * in 2011 for wins and points, so a long-tenured member is already past a
 * hundred wins and twenty thousand points. Add one and it is a one-line diff.
 */
const MILESTONES: Array<{ metric: 'wins' | 'points' | 'titles'; threshold: number; label: string }> = [
  { metric: 'wins', threshold: 50, label: '50 career wins' },
  { metric: 'wins', threshold: 75, label: '75 career wins' },
  { metric: 'wins', threshold: 100, label: '100 career wins' },
  { metric: 'wins', threshold: 125, label: '125 career wins' },
  { metric: 'wins', threshold: 150, label: '150 career wins' },
  { metric: 'wins', threshold: 175, label: '175 career wins' },
  { metric: 'wins', threshold: 200, label: '200 career wins' },
  { metric: 'points', threshold: 10_000, label: '10,000 career points' },
  { metric: 'points', threshold: 15_000, label: '15,000 career points' },
  { metric: 'points', threshold: 20_000, label: '20,000 career points' },
  { metric: 'points', threshold: 25_000, label: '25,000 career points' },
  { metric: 'points', threshold: 30_000, label: '30,000 career points' },
  { metric: 'points', threshold: 40_000, label: '40,000 career points' },
  { metric: 'points', threshold: 50_000, label: '50,000 career points' },
  { metric: 'titles', threshold: 2, label: 'a second championship' },
  { metric: 'titles', threshold: 3, label: 'a third championship' },
  { metric: 'titles', threshold: 4, label: 'a fourth championship' },
  { metric: 'titles', threshold: 5, label: 'a fifth championship' },
]

/**
 * Career thresholds crossed this week, and who is on the doorstep.
 *
 * A crossing, not a total: computed as of this week and as of last week, so the
 * ones that stepped over are announced and nothing else is. Every milestone
 * carries its `Coverage`, because a career total is only true across the seasons
 * that actually have the data behind it.
 */
function buildMilestones(
  history: HistoryInput,
  season: number,
  week: number,
  name: (id: number) => string,
): Milestone[] {
  /**
   * Career totals reach back as far as the record does, not as far as Sleeper.
   *
   * Two sources, deliberately: **completed earlier seasons come from
   * `season_standings`**, which carries wins, losses and points from 2011 — nine
   * years the week-by-week data has never had — and **the current season comes
   * from matchups filtered to this week**, because a standings row for the
   * season in progress holds its FINAL record and would hand a week-7 issue the
   * finished one.
   *
   * ⚠️ The two sources do not agree perfectly. `season_standings.points_for` is
   * the published season total and differs from a re-sum of matchups for eight
   * rosters across 2020–21. For a career figure in the tens of thousands that is
   * noise; it would not be acceptable for a single-season claim, which is why
   * nothing else in this file mixes them.
   */
  const at = (w: number) => {
    const per = new Map<number, { wins: number; points: number }>()
    const bump = (id: number, wins: number, points: number) => {
      const cur = per.get(id) ?? { wins: 0, points: 0 }
      cur.wins += wins
      cur.points += points
      per.set(id, cur)
    }
    for (const s of history.standings) {
      if (s.season >= season) continue
      bump(s.managerId, s.wins, s.pointsFor ?? 0)
    }
    for (const m of upTo(history.matchups, season, w)) {
      if (m.season !== season) continue
      if (m.isPlayoff && !isCountedPlayoff(m)) continue
      bump(m.managerId, m.result === 'W' ? 1 : 0, m.points)
    }
    return per
  }

  const now = at(week)
  const before = at(week - 1)
  const summary = leagueSummary(history)
  const titlesOf = new Map(
    summary.rows.map((r) => [r.member.managerId, r.allTime.titles ?? 0] as [number, number]),
  )

  // The span a career number is actually true across: every tier that carries a
  // record, not just the weekly one. `standings` starts in 2011.
  const contributing = new Set([
    ...history.standings.filter((s) => s.season < season).map((s) => s.season),
    season,
  ])
  const coverage = coverageFor(history.seasons, ['standings', 'weekly'], 'all time', contributing)

  const out: Milestone[] = []
  for (const [id, cur] of now) {
    const prev = before.get(id) ?? { wins: 0, points: 0 }
    for (const ms of MILESTONES) {
      const value = ms.metric === 'titles' ? (titlesOf.get(id) ?? 0) : cur[ms.metric]
      const was = ms.metric === 'titles' ? (titlesOf.get(id) ?? 0) : prev[ms.metric]
      // Titles span further back than anything else -- rings are counted from
      // the start of the record, including the five years that survive as a
      // champion and nothing else. Carry that span rather than the W/L one.
      const span = ms.metric === 'titles' ? summary.titles : coverage
      if (value >= ms.threshold && was < ms.threshold) {
        out.push({
          manager: name(id),
          label: ms.label,
          crossed: true,
          value: r2(value),
          threshold: ms.threshold,
          away: null,
          coverage: span,
        })
      } else if (
        // A doorstep is only interesting for something that can be crossed by
        // playing. Nobody is "one away from a fifth championship" in week seven
        // -- titles are decided once a year, so reporting the gap turns the
        // section into ten lines of noise that say nothing about this week.
        ms.metric !== 'titles' &&
        value < ms.threshold &&
        ms.threshold - value <= (ms.metric === 'points' ? 400 : 3)
      ) {
        out.push({
          manager: name(id),
          label: ms.label,
          crossed: false,
          value: r2(value),
          threshold: ms.threshold,
          away: r2(ms.threshold - value),
          coverage: span,
        })
      }
    }
  }
  // Crossings first, then the nearest doorsteps. Capped, because a section that
  // lists everybody's next threshold is a table nobody reads.
  return out
    .sort((a, b) => Number(b.crossed) - Number(a.crossed) || (a.away ?? 0) - (b.away ?? 0))
    .slice(0, 6)
}

/** Anything this week that entered the all-time book, or came close to it. */
function buildRecordBook(
  history: HistoryInput,
  season: number,
  week: number,
  name: (id: number) => string,
): RecordNote[] {
  const toDate = upTo(history.matchups, season, week)
  const book = records({ ...history, matchups: toDate })
  const out: RecordNote[] = []

  for (const entry of book.games) {
    if (entry.season === season && entry.week === week) {
      out.push({
        claim: `${name(entry.managerId ?? 0)} set a league record: ${entry.label.toLowerCase()}`,
        detail: `${entry.value} — ${entry.coverage.label}`,
        nearMiss: false,
      })
    }
  }

  if (out.length === 0) {
    // The near miss, so the section has something honest to say every week.
    const regular = toDate.filter((m) => !m.isPlayoff)
    const thisWeekTop = regular
      .filter((m) => m.season === season && m.week === week)
      .sort((a, b) => b.points - a.points)[0]
    if (thisWeekTop) {
      const better = regular.filter((m) => m.points > thisWeekTop.points).length
      if (better < 25) {
        out.push({
          claim: `${name(thisWeekTop.managerId)}'s ${r2(thisWeekTop.points)} was the ${ordinal(better + 1)}-highest score on record`,
          detail: `${better} scores on record beat it`,
          nearMiss: true,
        })
      }
    }
  }
  return out
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** Only when a result is genuinely worth needling. */
function buildRivalry(games: GameNoteFacts[], h2h: ReturnType<typeof headToHead>): RivalryNote[] {
  const out: RivalryNote[] = []
  for (const g of games) {
    if (!g.winner || !g.loser || !g.lifetime) continue
    const [w, l] = g.lifetime.split('-').map(Number)
    const total = w + l
    if (total < 5) continue
    const lopsided = Math.abs(w - l) / total >= 0.6
    if (!lopsided) continue
    out.push({
      claim: `${g.winner} is now ${g.lifetime} lifetime against ${g.loser}`,
      detail: `${total} meetings on record, ${h2h.coverage.label}`,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Stat of the Week — an open registry
// ---------------------------------------------------------------------------

interface GenContext {
  input: GazetteInput
  toDate: HistoryMatchup[]
  thisWeek: HistoryMatchup[]
  name: (id: number) => string
  playersToDate: GazettePlayerWeek[]
  history: HistoryInput
  season: number
  week: number
  /** Computed before the generators run, so a candidate can reason about them. */
  standings: StandingsRow[]
  powerRankings: PowerRow[]
}

type Generator = (ctx: GenContext) => StatCandidate[]

/**
 * Adding a new kind of stat is one function and one test. That is the whole
 * point: the section is meant to be able to surface anything about this league
 * that would make somebody say "wait, really?", and the only way to keep that
 * open-ended while every figure stays grounded is to precompute the candidates.
 *
 * Each returns zero or more candidates with a `surprise` scored by `rarity()`,
 * which is a percentile against that candidate's own history — so a boom and a
 * streak and a coincidence can be ranked against each other honestly.
 */
export const STAT_GENERATORS: Generator[] = [
  // Biggest boom or bust against a player's own form THIS SEASON SO FAR.
  ({ playersToDate, season, week, name, history }) => {
    const prior = playersToDate.filter((p) => p.week < week)
    const avg = new Map<string, number>()
    const counts = new Map<string, number>()
    for (const p of prior) {
      avg.set(p.playerId, (avg.get(p.playerId) ?? 0) + p.points)
      counts.set(p.playerId, (counts.get(p.playerId) ?? 0) + 1)
    }
    const gaps: Array<{ p: GazettePlayerWeek; gap: number }> = []
    for (const p of playersToDate.filter((x) => x.week === week && x.isStarter)) {
      const n = counts.get(p.playerId) ?? 0
      if (n < 3) continue
      gaps.push({ p, gap: p.points - (avg.get(p.playerId) ?? 0) / n })
    }
    if (!gaps.length) return []
    const population = gaps.map((g) => g.gap)
    const out: StatCandidate[] = []
    for (const prefer of ['max', 'min'] as const) {
      const pick = gaps.reduce((a, b) =>
        prefer === 'max' ? (b.gap > a.gap ? b : a) : b.gap < a.gap ? b : a,
      )
      out.push({
        id: `${prefer === 'max' ? 'boom' : 'bust'}:${season}:${week}`,
        category: 'player',
        claim:
          prefer === 'max'
            ? `${pick.p.player} beat his own average by ${r2(Math.abs(pick.gap))}`
            : `${pick.p.player} came up ${r2(Math.abs(pick.gap))} short of his own average`,
        value: r2(pick.p.points),
        detail: `${r2(pick.p.points)} for ${name(pick.p.managerId)}, against an average of ${r2((avg.get(pick.p.playerId) ?? 0) / (counts.get(pick.p.playerId) ?? 1))} over ${counts.get(pick.p.playerId)} weeks`,
        surprise: rarity(pick.gap, population),
        coverage: coverageFor(history.seasons, ['weekly'], `${season} so far`, new Set([season])),
      })
    }
    return out
  },

  // The worst benching of the week: a bench player who out-scored the starter
  // in the slot they were eligible for.
  ({ playersToDate, week, season, name, history }) => {
    const wk = playersToDate.filter((p) => p.week === week)
    const out: StatCandidate[] = []
    const gaps: number[] = []
    let worst: { bench: GazettePlayerWeek; starter: GazettePlayerWeek; gap: number } | null = null

    for (const manager of new Set(wk.map((p) => p.managerId))) {
      const mine = wk.filter((p) => p.managerId === manager)
      for (const b of mine.filter((p) => !p.isStarter)) {
        for (const s of mine.filter((p) => p.isStarter && p.position === b.position)) {
          const gap = b.points - s.points
          if (gap <= 0) continue
          gaps.push(gap)
          if (!worst || gap > worst.gap) worst = { bench: b, starter: s, gap }
        }
      }
    }
    if (worst) {
      out.push({
        id: `startsit:${season}:${week}`,
        category: 'start-sit',
        claim: `${name(worst.bench.managerId)} benched ${worst.bench.player} for ${worst.starter.player}`,
        value: r2(worst.gap),
        detail: `${r2(worst.bench.points)} on the bench against ${r2(worst.starter.points)} in the lineup, a ${r2(worst.gap)} point difference`,
        surprise: rarity(worst.gap, gaps),
        coverage: coverageFor(history.seasons, ['weekly'], `${season} so far`, new Set([season])),
      })
    }
    return out
  },

  // A perfect lineup — started the optimal eleven exactly.
  ({ history, season, week, name }) => {
    const lin = history.lineups.filter((l) => l.season === season && l.week === week)
    const perfect = lin.filter((l) => Math.abs(l.optimal - l.actual) < 0.01)
    if (!perfect.length) return []
    const all = history.lineups.filter((l) => Math.abs(l.optimal - l.actual) < 0.01).length
    const total = history.lineups.length
    return perfect.map((l) => ({
      id: `perfect:${season}:${week}:${l.managerId}`,
      category: 'start-sit',
      claim: `${name(l.managerId)} started the perfect lineup`,
      value: r2(l.actual),
      detail: `${r2(l.actual)} points, not one left on the bench. It has happened ${all} times in ${total} manager-weeks on record.`,
      surprise: total > 0 ? 1 - all / total : 0,
      coverage: coverageFor(history.seasons, ['weekly'], 'since Sleeper', new Set(history.lineups.map((l) => l.season))),
    }))
  },

  // Most points ever scored in a loss, or fewest in a win.
  ({ toDate, thisWeek, name, history, season, week }) => {
    const regular = toDate.filter((m) => !m.isPlayoff)
    const out: StatCandidate[] = []

    // "Only 4 losing scores on record beat it" is a fact. "Only 316 beat it" is
    // the same sentence describing a completely ordinary afternoon, and printing
    // it every week teaches the reader that this section means nothing. A rank
    // is only worth stating when the rank is short.
    const NOTABLE = 12

    const losses = regular.filter((m) => m.result === 'L').map((m) => m.points)
    const thisLoss = thisWeek.filter((m) => m.result === 'L').sort((a, b) => b.points - a.points)[0]
    if (thisLoss && losses.length > 20) {
      const better = losses.filter((p) => p > thisLoss.points).length
      if (better < NOTABLE) {
        out.push({
          id: `bigloss:${season}:${week}`,
          category: 'manager',
          claim: `${name(thisLoss.managerId)} scored ${r2(thisLoss.points)} and lost`,
          value: r2(thisLoss.points),
          detail:
            better === 0
              ? 'the highest losing score in the league record'
              : `only ${better} losing score${better === 1 ? '' : 's'} on record beat it`,
          surprise: rarity(thisLoss.points, losses),
          coverage: coverageFor(history.seasons, ['weekly'], 'since Sleeper', new Set(regular.map((m) => m.season))),
        })
      }
    }

    const wins = regular.filter((m) => m.result === 'W').map((m) => m.points)
    const thisWin = thisWeek.filter((m) => m.result === 'W').sort((a, b) => a.points - b.points)[0]
    if (thisWin && wins.length > 20) {
      const lower = wins.filter((p) => p < thisWin.points).length
      if (lower < NOTABLE) {
        out.push({
          id: `smallwin:${season}:${week}`,
          category: 'manager',
          claim: `${name(thisWin.managerId)} won with ${r2(thisWin.points)}`,
          value: r2(thisWin.points),
          detail:
            lower === 0
              ? 'the lowest winning score in the league record'
              : `only ${lower} winning score${lower === 1 ? '' : 's'} on record are lower`,
          surprise: rarity(-thisWin.points, wins.map((w) => -w)),
          coverage: coverageFor(history.seasons, ['weekly'], 'since Sleeper', new Set(regular.map((m) => m.season))),
        })
      }
    }
    return out
  },

  // The league's weekly total, against its own history.
  ({ toDate, thisWeek, history, season, week }) => {
    const totals = new Map<string, number>()
    for (const m of toDate.filter((x) => !x.isPlayoff)) {
      const key = `${m.season}:${m.week}`
      totals.set(key, (totals.get(key) ?? 0) + m.points)
    }
    const mine = totals.get(`${season}:${week}`)
    if (mine === undefined || totals.size < 6) return []
    const population = [...totals.values()]
    const mean = population.reduce((a, b) => a + b, 0) / population.length
    return [
      {
        id: `leaguetotal:${season}:${week}`,
        category: 'league',
        claim:
          mine > mean
            ? `the whole league scored ${r2(mine)} this week, above its own average`
            : `the whole league managed only ${r2(mine)} this week`,
        value: r2(mine),
        detail: `against a weekly average of ${r2(mean)} across ${population.length} weeks on record, over ${thisWeek.length} teams`,
        surprise: rarity(mine - mean, population.map((p) => p - mean)),
        coverage: coverageFor(history.seasons, ['weekly'], 'since Sleeper', new Set(toDate.map((m) => m.season))),
      },
    ]
  },

  // Two managers within a tenth of a point of each other.
  ({ thisWeek, name, season, week, history }) => {
    const sorted = [...thisWeek].sort((a, b) => b.points - a.points)
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i].points - sorted[i + 1].points
      if (gap > 0 && gap <= 0.1) {
        return [
          {
            id: `coincidence:${season}:${week}`,
            category: 'coincidence',
            claim: `${name(sorted[i].managerId)} and ${name(sorted[i + 1].managerId)} finished ${r2(gap)} apart`,
            value: r2(gap),
            detail: `${r2(sorted[i].points)} against ${r2(sorted[i + 1].points)}`,
            surprise: 0.95,
            coverage: coverageFor(history.seasons, ['weekly'], `${season}`, new Set([season])),
          },
        ]
      }
    }
    return []
  },

  // A player who outscored an entire opposing starting lineup.
  ({ playersToDate, thisWeek, week, season, name, history }) => {
    const starters = playersToDate.filter((p) => p.week === week && p.isStarter)
    const best = starters.sort((a, b) => b.points - a.points)[0]
    if (!best) return []
    const beaten = thisWeek.filter((m) => m.points < best.points)
    if (!beaten.length) return []
    return [
      {
        id: `onemanteam:${season}:${week}`,
        category: 'player',
        claim: `${best.player} outscored ${beaten.length === 1 ? 'an entire starting lineup' : `${beaten.length} entire starting lineups`}`,
        value: r2(best.points),
        detail: `${r2(best.points)} for ${name(best.managerId)}, more than ${beaten.map((m) => name(m.managerId)).join(', ')} managed with a full roster`,
        surprise: Math.min(0.99, 0.6 + beaten.length * 0.1),
        coverage: coverageFor(history.seasons, ['weekly'], `${season}`, new Set([season])),
      },
    ]
  },

  // THE GROUP PROJECT — scoring like a contender, losing like a tenant.
  //
  // The gap between where a manager ranks on points and where they rank on
  // record. A big one is the most durable grievance in fantasy football and the
  // only injustice in the sport that is genuinely measurable.
  ({ standings, season, week, history }) => {
    if (standings.length < 4) return []
    const byPoints = [...standings].sort((a, b) => b.pointsFor - a.pointsFor)
    const gaps = standings.map((r) => ({
      row: r,
      gap: byPoints.findIndex((x) => x.manager === r.manager) - (r.place - 1),
    }))
    // Negative gap = ranks better on points than on record.
    const worst = gaps.reduce((a, b) => (b.gap < a.gap ? b : a))
    if (worst.gap > -3) return []
    return [
      {
        id: `groupproject:${season}:${week}`,
        category: 'manager',
        claim: `${worst.row.manager} is ${worst.row.record} while scoring more than almost anyone`,
        value: worst.row.pointsFor,
        detail: `${Math.abs(worst.gap)} places better on points than on record — ${worst.row.pointsFor.toFixed(2)} scored, ${worst.row.record}, ${ordinal(worst.row.place)} in the table`,
        surprise: Math.min(0.99, 0.55 + Math.abs(worst.gap) * 0.09),
        coverage: coverageFor(history.seasons, ['weekly'], `${season}`, new Set([season])),
      },
    ]
  },

  // THE BANDWAGON — the biggest move in the power rankings this week.
  ({ powerRankings, season, week, history }) => {
    const movers = powerRankings.filter((r) => r.move !== null && Math.abs(r.move) >= 3)
    if (!movers.length) return []
    const biggest = movers.reduce((a, b) => (Math.abs(b.move!) > Math.abs(a.move!) ? b : a))
    const up = biggest.move! > 0
    return [
      {
        id: `bandwagon:${season}:${week}`,
        category: 'league',
        claim: `${biggest.manager} ${up ? 'climbed' : 'fell'} ${Math.abs(biggest.move!)} places in a week`,
        value: Math.abs(biggest.move!),
        detail: `now ${ordinal(biggest.rank)} in the power rankings on ${biggest.allPlayRecord} against the field and ${biggest.efficiencyPct.toFixed(2)} percent efficiency`,
        surprise: Math.min(0.98, 0.55 + Math.abs(biggest.move!) * 0.1),
        coverage: coverageFor(history.seasons, ['weekly'], `${season}`, new Set([season])),
      },
    ]
  },

  // Somebody's personal best or worst week, ever.
  ({ toDate, thisWeek, name, history, season, week }) => {
    const out: StatCandidate[] = []
    for (const m of thisWeek) {
      const mine = toDate.filter((x) => x.managerId === m.managerId && !x.isPlayoff)
      if (mine.length < 10) continue
      const better = mine.filter((x) => x.points > m.points).length
      const worse = mine.filter((x) => x.points < m.points).length
      if (better === 0) {
        out.push({
          id: `personalbest:${season}:${week}:${m.managerId}`,
          category: 'manager',
          claim: `${name(m.managerId)} posted the best score of his career`,
          value: r2(m.points),
          detail: `${r2(m.points)}, beating everything in ${mine.length} games on record`,
          surprise: 0.97,
          coverage: coverageFor(history.seasons, ['weekly'], 'since Sleeper', new Set(mine.map((x) => x.season))),
        })
      } else if (worse === 0) {
        out.push({
          id: `personalworst:${season}:${week}:${m.managerId}`,
          category: 'manager',
          claim: `${name(m.managerId)} posted the worst score of his career`,
          value: r2(m.points),
          detail: `${r2(m.points)}, below everything in ${mine.length} games on record`,
          surprise: 0.97,
          coverage: coverageFor(history.seasons, ['weekly'], 'since Sleeper', new Set(mine.map((x) => x.season))),
        })
      }
    }
    return out
  },
]

// ---------------------------------------------------------------------------
// Grounding — the eval gate
// ---------------------------------------------------------------------------

/**
 * Every number a piece of prose contains, keyed for comparison.
 *
 * Proper nouns from the pack are stripped **before** tokenizing, which is what
 * stops "the 49ers" being reported as an ungrounded 49 and "A.J. Brown" as a
 * stray 1. Names are the only place digits legitimately hide inside words.
 */
export function numbersIn(
  text: string,
  properNouns: string[] = [],
): Array<{ raw: string; key: string; context: string }> {
  let cleaned = text
  // Longest first, so "San Francisco 49ers" is removed before "49ers".
  for (const noun of [...properNouns].filter(Boolean).sort((a, b) => b.length - a.length)) {
    cleaned = cleaned.split(noun).join(' ')
  }

  const out: Array<{ raw: string; key: string; context: string }> = []
  const re = /-?\d[\d,]*(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[0]
    const n = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(n)) continue
    out.push({
      raw,
      key: n.toFixed(2),
      context: cleaned.slice(Math.max(0, m.index - 20), m.index + raw.length + 20).replace(/\s+/g, ' '),
    })
  }
  return out
}

/** Every numeric leaf anywhere in an object, however deeply nested. */
function numericLeaves(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  else if (Array.isArray(value)) for (const v of value) numericLeaves(v, out)
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) numericLeaves(v, out)
  }
  return out
}

/** Every string leaf, for the proper nouns the tokenizer must ignore. */
function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out)
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) stringLeaves(v, out)
  }
  return out
}

/**
 * Every figure the pack authorises, including the roundings a writer may use.
 *
 * Walked generically rather than field by field, so a field added to
 * `GazetteFacts` is authorised automatically and there is no second list to
 * drift out of sync with the first.
 *
 * The roundings encode one rule from the prompt: **you may drop decimals, you
 * may not invent them.** 128.64 licenses "128" and "128.6"; it does not license
 * "128.61".
 */
export function groundedKeys(facts: GazetteFacts | PreviewFacts): Set<string> {
  const keys = new Set<string>()
  const add = (n: number) => {
    if (!Number.isFinite(n)) return
    keys.add(n.toFixed(2))
    keys.add(Math.trunc(n).toFixed(2))
    keys.add(Math.round(n).toFixed(2))
    keys.add(Number(n.toFixed(1)).toFixed(2))
  }

  for (const n of numericLeaves(facts)) add(n)

  // Numbers that appear inside strings the pack itself wrote -- records like
  // "8-1", coverage labels, and every figure already baked into a claim.
  for (const s of stringLeaves(facts)) {
    for (const found of s.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      add(Number(found[0].replace(/,/g, '')))
    }
  }

  // Years are free: naming a season is not quoting a statistic.
  for (let y = 2006; y <= 2030; y++) add(y)
  return keys
}

/**
 * Numbers in the prose that the pack cannot account for. Empty means grounded.
 *
 * This is the gate. A hallucinated score is fatal in a ten-person league where
 * everybody already knows what happened, and no amount of prompt instruction is
 * enforcement — reading the output is.
 *
 * The prompt rule that makes this sharp rather than noisy is **counts are
 * written as words**: "ten teams", "three straight". With that, a bare digit
 * that is not in the pack is unambiguously an invention rather than prose, and
 * the check needs no small-integer whitelist that would hide "won by 3".
 */
export function ungroundedNumbers(text: string, facts: GazetteFacts | PreviewFacts): string[] {
  const allowed = groundedKeys(facts)
  const nouns = stringLeaves(facts).filter((s) => /[A-Za-z]/.test(s))
  return numbersIn(text, nouns)
    .filter((n) => !allowed.has(n.key))
    .map((n) => `${n.raw}  (…${n.context}…)`)
}

/**
 * Numbers attributed to the wrong manager. **Warn only, never a gate.**
 *
 * The numeric check above cannot catch this: "Bill put up 148.62" passes cleanly
 * when 148.62 was Jack's, because the figure is real. This looks at each manager
 * named within ~80 characters of a number and asks whether that pairing exists
 * anywhere in the pack.
 *
 * It false-positives on perfectly good sentences -- "Bill lost to Jack's 148.62"
 * puts Bill near a number that is not his -- which is exactly why it prints for a
 * human to read and never blocks a write.
 */
export function misattributedNumbers(text: string, facts: GazetteFacts | PreviewFacts): string[] {
  const managers = new Set(
    isPreview(facts) ? facts.rosters.map((r) => r.manager) : facts.standings.map((r) => r.manager),
  )
  const pairs = new Set<string>()
  const record = (manager: string | null, values: Array<number | null>) => {
    if (!manager) return
    for (const n of values) {
      if (n === null || !Number.isFinite(n)) continue
      pairs.add(`${manager}:${n.toFixed(2)}`)
      pairs.add(`${manager}:${Math.round(n).toFixed(2)}`)
    }
  }

  // Every scope below names exactly one manager per row, so a blanket walk over
  // the row attributes correctly. A week's `games` are the exception and are
  // handled separately, because a row there names two men and crediting each
  // with the other's score is precisely the error this exists to catch.
  const scopes: unknown[][] = isPreview(facts)
    ? [facts.rosters, facts.priciest, facts.bargains, facts.reaches, facts.repeats, facts.careers,
       facts.milestones, facts.lastSeason?.standings ?? []]
    : [facts.standings, facts.powerRankings, facts.againstTheField, facts.ledger]

  if (!isPreview(facts)) {
    for (const g of facts.games) {
      record(g.winner, [g.winnerPoints, g.winnerWeekRank, g.winnerBenchPoints, g.margin])
      record(g.loser, [g.loserPoints, g.loserWeekRank, g.loserBenchPoints, g.margin])
    }
  }

  for (const scope of scopes) {
    for (const row of scope) {
      const owner = stringLeaves(row).find((s) => managers.has(s)) ?? null
      record(owner, numericLeaves(row))
    }
  }

  // One sentence at a time, and only sentences that name exactly one manager.
  //
  // A fixed character window flagged eight figures on a real issue and every one
  // was a false positive: "Justin is 6-2 and first. Mario took the week with
  // 158.16" puts Justin within eighty characters of a number that is obviously
  // Mario's. A sentence naming two people is ambiguous by construction, so the
  // honest move is to say nothing about it rather than cry wolf until the
  // warning stops being read.
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const named = [...managers].filter((m) => sentence.includes(m))
    if (named.length !== 1) continue
    const [manager] = named
    for (const found of sentence.matchAll(/-?\d[\d,]*\.\d+/g)) {
      const key = `${manager}:${Number(found[0].replace(/,/g, '')).toFixed(2)}`
      if (!pairs.has(key)) out.push(`${manager} … ${found[0]}  (${sentence.trim().slice(0, 70)}…)`)
    }
  }
  return [...new Set(out)]
}

function runGenerators(ctx: GenContext): StatCandidate[] {
  const out: StatCandidate[] = []
  for (const gen of STAT_GENERATORS) {
    try {
      out.push(...gen(ctx))
    } catch {
      // A generator that cannot run on this week's data contributes nothing.
      // One broken candidate must never cost the league its newsletter.
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The season preview — the origins issue
// ---------------------------------------------------------------------------

/**
 * The preview is the one edition with no games behind it.
 *
 * It is filed after the auction and before week one, so every rule at the top of
 * this file about not knowing the future applies with the dial turned all the
 * way up: the whole season is the future. What it may read is the room — a
 * hundred and sixty picks, the prices, the ranks — and the record of every year
 * that is already finished.
 *
 * ## Why it is a separate pack rather than a week-zero `GazetteFacts`
 *
 * Almost nothing transfers. There are no games, no standings, no all-play, no
 * belt, no efficiency and no ledger, and a `GazetteFacts` with nine empty arrays
 * would put nine empty tables on the page and hand the model nine fields of
 * nothing to hallucinate around. The two packs share the grounding walk, the
 * notebook and the persona; they share no figures, so they share no shape.
 */

/** One purchase, as the room made it. */
export interface PreviewBuy {
  player: string
  position: string
  nflTeam: string | null
  price: number
  /**
   * Pool rank the night he was bought, snapshotted on the pick.
   *
   * **Null is unranked, never rank zero** — a Sleeper-seeded pool leaves plenty
   * without one, and zero would read as the best player alive. Rows with a null
   * rank are excluded from `bargains` and `reaches` rather than sorted to the
   * top of them.
   */
  rank: number | null
  manager: string
  /**
   * Where the price slotted him among drafted players AT HIS OWN POSITION.
   * 1 = the priciest of them. Null when the position is not scored.
   */
  pricePositionRank?: number | null
  /** Where the board had him among those same players. 1 = the best of them. */
  boardPositionRank?: number | null
}

/** What one man came away with, and what it cost him. */
export interface PreviewRoster {
  manager: string
  spent: number
  /** Budget less spend. In an auction this is money set on fire politely. */
  unspent: number
  players: number
  topBuy: { player: string; position: string; price: number } | null
  /** Spend per position, biggest first. Positions he bought nothing at are absent. */
  byPosition: Array<{ position: string; spent: number; players: number }>
  /** Committed inside the first forty picks of the room — how early he moved. */
  byPick40: number
  /** How many of the pool's top thirty ranked players he walked out with. */
  topThirty: number
  /** Players he nominated, which is a tell of its own. */
  nominations: number
}

/** Who a man is, before this season adds to it. */
export interface PreviewCareer {
  manager: string
  seasons: number
  firstSeason: number
  /** Career regular-season record across the years the record covers. */
  record: string
  titles: number
  /**
   * ⚠️ `season_standings.place` is the REGULAR-SEASON table, not the bracket.
   *
   * In 2025 Jack finished the regular season first and Gabes won the title.
   * Calling either of these a "finish" invites the column to say Jack finished
   * first in a season he lost the final of — so the names say what they are, and
   * `titles` is the only field here that means anybody won anything.
   */
  bestRegularSeasonPlace: number | null
  /** Where he placed in last season's regular season. Null if he did not play it. */
  lastRegularSeasonPlace: number | null
  /** Seasons since his last title. Null when he has never won one. */
  titleDrought: number | null
}

/** A player the same man has bought before. The best material in the pack. */
export interface PreviewRepeat {
  manager: string
  player: string
  /** Every season this man bought this player, oldest first, including this one. */
  seasons: number[]
  /** What he paid each of those years, in the same order. */
  prices: number[]
}

export interface PreviewFacts {
  kind: 'preview'
  season: number
  /** Always zero. The preview sorts before week one and after last season's final. */
  week: 0
  weekLabel: string
  /** The frame. Directive here rather than a suggestion — see the preview prompt. */
  genre: string | null

  city: string | null
  state: string | null
  /** Null is unknown, never free. */
  buyIn: number | null
  sideBet: number | null

  budget: number
  rosterSize: number
  picks: number
  spent: number

  rosters: PreviewRoster[]
  priciest: PreviewBuy[]
  bargains: PreviewBuy[]
  reaches: PreviewBuy[]
  byPosition: Array<{ position: string; spent: number; share: number; players: number; top: string }>
  /**
   * How closely the room priced to the board, within positions.
   *
   * `withinThree` of `scored` picks landed within three places of where the
   * rankings had them at their own position. A high proportion means the room
   * agreed with the list it was given — which is a finding about the auction,
   * and one no amount of squinting at two short lists would establish.
   */
  marketDiscipline: {
    scored: number
    withinThree: number
    widest: PreviewBuy | null
    widestBy: number | null
  }
  repeats: PreviewRepeat[]

  lastSeason: {
    season: number
    champion: string | null
    runnerUp: string | null
    /**
     * The REGULAR-SEASON table. `regularSeasonPlace` one is not the champion —
     * see the warning on {@link PreviewCareer}. `finish` is the bracket, and it
     * is the only field here that says who won anything.
     */
    standings: Array<{
      manager: string
      regularSeasonPlace: number
      finish: 'champion' | 'runner-up' | null
      record: string
      pointsFor: number
    }>
  } | null

  careers: PreviewCareer[]
  milestones: Milestone[]

  /** Continuity, carried over from the END of last season. Not printed. */
  priorThreads: Thread[]
  priorColumns: string[]
  priorHeadlines: string[]
  /**
   * Worlds this season has already been told through, oldest first.
   *
   * The calendar stops two weeks being *assigned* the same genre; this stops
   * them being *written* the same. See {@link PriorIssue.lens}.
   */
  priorLenses: string[]

  notes: string[]
}

/**
 * Is this pack a preview?
 *
 * Tested on `'preview'` and never on `'week'`: `kind` is absent from every issue
 * written before the preview existed, so the negative test is the only one that
 * reads the back catalogue correctly.
 */
export function isPreview(facts: GazetteFacts | PreviewFacts): facts is PreviewFacts {
  return (facts as PreviewFacts).kind === 'preview'
}

/** A pick as the preview needs it — richer than `HistoryPick`, and season-scoped. */
export interface PreviewPick {
  id: number
  season: number
  pickNo: number
  /** CURRENT owner. Money questions go through `drafter` instead. See below. */
  managerId: number
  /**
   * Who actually bought him, after rewinding every trade.
   *
   * A trade moves `picks.manager_id` but not the salary, so attributing spend to
   * the current owner charges one man's money to another. The caller resolves
   * this with `draftersByPick`; a season with no trades makes it identical to
   * `managerId`, which is the normal state for a preview filed in August.
   */
  drafter: number
  nominatorId: number | null
  price: number
  player: string
  position: string
  nflTeam: string | null
  rank: number | null
  /** Stable across pool re-imports, and the only way to spot a repeat buy. */
  sleeperId: string | null
}

export interface PreviewInput {
  season: number
  history: HistoryInput
  /** Every pick of every season on record, with prices and ranks. */
  picks: PreviewPick[]
  budget: number
  rosterSize: number
  sideBet: number | null
  genre: string | null
  /** The last issues of the PREVIOUS season, oldest first. */
  priorIssues: PriorIssue[]
}

/** Positions in the order the league thinks about them, then anything else. */
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

/**
 * The positions worth scoring price against the board at.
 *
 * K and DEF are excluded for the same reason `draft-value.ts` excludes them:
 * they go for a dollar, so their price says nothing about what the room thought.
 * They still appear in `byPosition`, because a spend table that does not total
 * what people actually spent is a lie.
 */
const VALUED_PREVIEW_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

const positionRank = (p: string) => {
  const i = POSITION_ORDER.indexOf(p)
  return i === -1 ? POSITION_ORDER.length : i
}

/**
 * Everything worth saying about a room that has just emptied.
 *
 * Returns null when the season has no picks — which is every season before its
 * auction, and must be a quiet no-op rather than an empty issue.
 */
export function seasonPreview(input: PreviewInput): PreviewFacts | null {
  const { season, history, picks, budget, rosterSize, sideBet, genre, priorIssues } = input

  const nameOf = new Map(history.members.map((m) => [m.managerId, m.displayName]))
  const name = (id: number) => nameOf.get(id) ?? '?'

  const thisYear = picks.filter((p) => p.season === season)
  if (thisYear.length === 0) return null

  const spent = thisYear.reduce((s, p) => s + p.price, 0)

  // Everyone who bought something, in draft order of their first purchase, so
  // the roster table and GAMENOTES agree on an order that is not alphabetical.
  const managerIds = [...new Set(thisYear.map((p) => p.drafter))].sort((a, b) => {
    const first = (id: number) => Math.min(...thisYear.filter((p) => p.drafter === id).map((p) => p.pickNo))
    return first(a) - first(b)
  })

  const buy = (p: PreviewPick): PreviewBuy => ({
    player: p.player,
    position: p.position,
    nflTeam: p.nflTeam,
    price: p.price,
    rank: p.rank,
    manager: name(p.drafter),
  })

  // --- the rosters ---------------------------------------------------------
  const topThirty = new Set(
    thisYear
      .filter((p) => p.rank !== null)
      .sort((a, b) => a.rank! - b.rank!)
      .slice(0, 30)
      .map((p) => p.id),
  )

  const rosters: PreviewRoster[] = managerIds.map((id) => {
    const mine = thisYear.filter((p) => p.drafter === id)
    const paid = mine.reduce((s, p) => s + p.price, 0)
    const top = [...mine].sort((a, b) => b.price - a.price)[0]

    const byPos = new Map<string, { spent: number; players: number }>()
    for (const p of mine) {
      const cur = byPos.get(p.position) ?? { spent: 0, players: 0 }
      cur.spent += p.price
      cur.players++
      byPos.set(p.position, cur)
    }

    return {
      manager: name(id),
      spent: paid,
      unspent: budget - paid,
      players: mine.length,
      topBuy: top ? { player: top.player, position: top.position, price: top.price } : null,
      byPosition: [...byPos.entries()]
        .map(([position, v]) => ({ position, ...v }))
        .sort((a, b) => b.spent - a.spent || positionRank(a.position) - positionRank(b.position)),
      byPick40: mine.filter((p) => p.pickNo <= 40).reduce((s, p) => s + p.price, 0),
      topThirty: mine.filter((p) => topThirty.has(p.id)).length,
      // Nomination is the one thing attributed to the man who did it rather than
      // the man who paid: it is a behaviour, not a charge, so no trade rewind.
      nominations: thisYear.filter((p) => p.nominatorId === id).length,
    }
  })

  // --- the money, league-wide ----------------------------------------------
  const byPrice = [...thisYear].sort((a, b) => b.price - a.price || (a.rank ?? 999) - (b.rank ?? 999))
  const priciest = byPrice.slice(0, 12).map(buy)

  // --- price against the board, WITHIN a position -------------------------
  //
  // ⚠️ Never across positions. This is a superflex league: quarterbacks score
  // far more than anybody and sit far lower on a board that is not built for it,
  // so a cross-position comparison does not measure value at all — it rediscovers
  // the format, and every "overpay" comes out a QB. A first cut of this section
  // did exactly that and returned six quarterbacks in a row. Same rule, and the
  // same reason, as `valueVsRoom` in stats.ts and `valueVsResults` in
  // draft-value.ts; K and DEF are excluded outright because a dollar player's
  // price carries no information.
  const valued: Array<PreviewBuy & { delta: number }> = []
  for (const position of VALUED_PREVIEW_POSITIONS) {
    const group = thisYear.filter((p) => p.position === position && p.rank !== null)
    // Too small a group and a "rank within position" is noise dressed as a
    // measurement — third of four priciest means nothing.
    if (group.length < 6) continue

    const priceRank = new Map<number, number>()
    ;[...group]
      .sort((a, b) => b.price - a.price || a.rank! - b.rank!)
      .forEach((p, i) => priceRank.set(p.id, i + 1))

    const boardRank = new Map<number, number>()
    ;[...group].sort((a, b) => a.rank! - b.rank!).forEach((p, i) => boardRank.set(p.id, i + 1))

    for (const p of group) {
      const pr = priceRank.get(p.id)!
      const br = boardRank.get(p.id)!
      valued.push({
        ...buy(p),
        pricePositionRank: pr,
        boardPositionRank: br,
        // Positive: the room let him go cheaper than the board rated him.
        // Negative: the room paid up past where the board had him.
        delta: pr - br,
      })
    }
  }

  /** Drop the sort key. `delta` orders these lists; it is not for print. */
  const strip = (scored: PreviewBuy & { delta: number }): PreviewBuy => {
    const out = { ...scored } as PreviewBuy & { delta?: number }
    delete out.delta
    return out
  }

  // Thresholds, in the spirit of MIN_SURPRISE: a candidate that is not
  // surprising does not get printed, and padding a list to six teaches the
  // reader that the section means nothing.
  //
  // Both ends of this measure are degenerate if left unfiltered. Cheap tail
  // players dominate a raw delta sort — a dollar receiver who is the board's
  // 37th at his position and the 46th most expensive is a nine-place "bargain"
  // on a player nobody in the room wanted, which is not a story. So a bargain
  // has to be somebody the board actually rated, and a reach has to have real
  // money on it.
  const bargains = [...valued]
    .filter((p) => p.boardPositionRank! <= 20 && p.delta >= 4)
    .sort((a, b) => b.delta - a.delta || b.price - a.price)
    .slice(0, 5)
    .map(strip)

  const reaches = [...valued]
    .filter((p) => p.price >= 10 && p.delta <= -4)
    .sort((a, b) => a.delta - b.delta || b.price - a.price)
    .slice(0, 5)
    .map(strip)

  // How closely the room priced to the board it was handed.
  //
  // Computed rather than left for the column to assert: "nobody disagreed with
  // the rankings" is a claim about a hundred and sixty picks, and a writer
  // eyeballing two lists cannot tell the difference between a disciplined room
  // and a thin section. Within three places at a position is the same tolerance
  // the thresholds above use.
  const disagreements = valued.filter((p) => Math.abs(p.delta) > 3)
  const widest = [...valued].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] ?? null
  const marketDiscipline = {
    scored: valued.length,
    withinThree: valued.length - disagreements.length,
    widest: widest ? strip(widest) : null,
    widestBy: widest ? Math.abs(widest.delta) : null,
  }

  const posTotals = new Map<string, { spent: number; players: number; top: PreviewPick | null }>()
  for (const p of thisYear) {
    const cur = posTotals.get(p.position) ?? { spent: 0, players: 0, top: null }
    cur.spent += p.price
    cur.players++
    if (cur.top === null || p.price > cur.top.price) cur.top = p
    posTotals.set(p.position, cur)
  }
  const byPosition = [...posTotals.entries()]
    .map(([position, v]) => ({
      position,
      spent: v.spent,
      share: spent ? Math.round((v.spent / spent) * 100) : 0,
      players: v.players,
      top: v.top ? `${v.top.player} $${v.top.price}` : '—',
    }))
    .sort((a, b) => b.spent - a.spent)

  // --- the same man, again -------------------------------------------------
  //
  // Keyed on `sleeperId`, the only player identity that survives a pool
  // re-import. A null id is skipped rather than grouped: the resolver refuses to
  // guess between two men of the same name, and grouping the unknowns together
  // would invent a repeat buy out of two different players.
  const repeats: PreviewRepeat[] = []
  for (const p of thisYear) {
    if (p.sleeperId === null) continue
    const before = picks
      .filter((q) => q.sleeperId === p.sleeperId && q.drafter === p.drafter && q.season < season)
      .sort((a, b) => a.season - b.season)
    if (before.length === 0) continue
    const all = [...before, p]
    repeats.push({
      manager: name(p.drafter),
      player: p.player,
      seasons: all.map((q) => q.season),
      prices: all.map((q) => q.price),
    })
  }
  repeats.sort((a, b) => b.seasons.length - a.seasons.length || b.prices.at(-1)! - a.prices.at(-1)!)

  // --- who these men are ---------------------------------------------------
  const prevSeason = [...history.seasons]
    .filter((s) => s.season < season)
    .sort((a, b) => b.season - a.season)[0]

  const lastSeason = prevSeason
    ? {
        season: prevSeason.season,
        champion: prevSeason.championManagerId === null ? null : name(prevSeason.championManagerId),
        runnerUp: prevSeason.runnerUpManagerId === null ? null : name(prevSeason.runnerUpManagerId),
        standings: history.standings
          .filter((s) => s.season === prevSeason.season && s.place !== null)
          .sort((a, b) => a.place! - b.place!)
          .map((s) => ({
            manager: name(s.managerId),
            regularSeasonPlace: s.place!,
            finish:
              s.managerId === prevSeason.championManagerId
                ? ('champion' as const)
                : s.managerId === prevSeason.runnerUpManagerId
                  ? ('runner-up' as const)
                  : null,
            record: `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`,
            pointsFor: r2(s.pointsFor ?? 0),
          })),
      }
    : null

  const summary = leagueSummary(history)
  const careers: PreviewCareer[] = managerIds.map((id) => {
    // Completed seasons only. The season being previewed has no record yet, and
    // `season_standings` for a year in progress holds its FINAL table — the trap
    // documented at the top of this file, which a preview would walk straight
    // into by reading its own season's row.
    const mine = history.standings
      .filter((s) => s.managerId === id && s.season < season)
      .sort((a, b) => a.season - b.season)
    const wins = mine.reduce((s, r) => s + r.wins, 0)
    const losses = mine.reduce((s, r) => s + r.losses, 0)
    const ties = mine.reduce((s, r) => s + r.ties, 0)

    const titleYears = history.seasons
      .filter((s) => s.season < season && s.championManagerId === id)
      .map((s) => s.season)
    const places = mine.map((r) => r.place).filter((p): p is number => p !== null)
    const last = mine.at(-1)

    return {
      manager: name(id),
      seasons: mine.length,
      firstSeason: mine[0]?.season ?? season,
      record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
      titles: summary.rows.find((r) => r.member.managerId === id)?.allTime.titles ?? titleYears.length,
      bestRegularSeasonPlace: places.length ? Math.min(...places) : null,
      lastRegularSeasonPlace: last?.season === prevSeason?.season ? (last?.place ?? null) : null,
      titleDrought: titleYears.length ? season - Math.max(...titleYears) : null,
    }
  })

  // Week zero, so `at(week)` and `at(week - 1)` both see the same completed
  // seasons and nothing of this one. Nothing can have been crossed by a season
  // that has not started, which leaves exactly the doorsteps — the right list
  // for a preview, and the reason this takes the week argument at all.
  const milestones = buildMilestones(history, season, 0, name)

  const notes: string[] = [
    'No game of this season has been played. There are no results, no standings and no records to report.',
    `Every manager began the auction with $${budget} and a roster of ${rosterSize} to fill.`,
    'This is a superflex league: a quarterback may be started in the flex, which is why quarterbacks cost far more here than a general ranking board suggests. Never treat a low board rank on a quarterback as an overpay on its own.',
    'lastSeason.standings is the REGULAR-SEASON table. The team that placed first is not necessarily the champion — the "finish" field is the only place the bracket is recorded, and titles are the only thing anybody won.',
    'BARGAINS and REACHES compare a price against the board WITHIN a position only. A quarterback is measured against other quarterbacks, never against a running back.',
  ]
  if (repeats.length === 0) {
    notes.push('Nobody bought a player they had owned in a previous season.')
  }
  if (bargains.length === 0) {
    notes.push('No pool ranks are on record for this auction, so nothing is scored against the board.')
  }

  return {
    kind: 'preview',
    season,
    week: 0,
    weekLabel: 'Season preview',
    genre,
    city: prevSeasonCity(history, season),
    state: prevSeasonState(history, season),
    buyIn: history.seasons.find((s) => s.season === season)?.buyIn ?? null,
    sideBet,
    budget,
    rosterSize,
    picks: thisYear.length,
    spent,
    rosters,
    priciest,
    bargains,
    reaches,
    byPosition,
    marketDiscipline,
    repeats,
    lastSeason,
    careers,
    milestones,
    priorThreads: priorIssues.at(-1)?.threads ?? [],
    priorColumns: priorIssues.slice(-2).map((i) => i.columnText),
    priorHeadlines: priorIssues.slice(-4).map((i) => i.headline),
    priorLenses: priorIssues.map((i) => i.lens).filter((l): l is string => l !== null),
    notes,
  }
}

/** Where this year's auction was held. Null is unknown, and stays unknown. */
function prevSeasonCity(history: HistoryInput, season: number): string | null {
  return history.seasons.find((s) => s.season === season)?.draftCity ?? null
}

function prevSeasonState(history: HistoryInput, season: number): string | null {
  return history.seasons.find((s) => s.season === season)?.draftState ?? null
}
