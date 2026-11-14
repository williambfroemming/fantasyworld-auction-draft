/**
 * Context for the playoff cards (docs/PLAYOFF_MODE_ROADMAP.md, step 89).
 *
 * What a matchup card says beside the seed and the score: how many titles a
 * team has, how often it has been here, how its last final went, and what the
 * two teams have done to each other before.
 *
 * Pure and DB-free, like `history.ts`: plain rows in, plain rows out.
 *
 * ## The one rule both functions share
 *
 * **Nothing here may know about the season being shown, or anything after it.**
 * In `/?preview=2025&through=15` a finished season stands in for the live one,
 * and its own outcome is on record: counting it would print "one title" beside
 * the team that is two games from winning that very title, and "last final:
 * won 2025" on the card for the 2025 semi-final. So every history figure reads
 * strictly earlier seasons, and the one thing read from the shown season (its
 * regular-season meetings) stops at the bracket's `throughWeek`.
 */
import { isCountedPlayoff, type HistoryMatchup, type HistoryMember, type HistorySeason, type HistoryStanding } from './history'
import type { PairContext, PlayoffBracket, TeamContext } from './playoff-types'

/**
 * One season's champion **by name**, the way the front page counts titles.
 *
 * Structurally satisfied by `SeasonListing` from `listHistorySeasons()` in
 * `src/server/history-service.ts`, so that listing can be passed straight in.
 * There `champion` is `COALESCE(managers.display_name, legacy_champions.champion_name)`:
 * a display name for a season with a `champion_manager_id`, and the bare
 * workbook name for a 2006-2010 season that has none.
 */
export interface ChampionListing {
  season: number
  champion: string | null
}

export interface TeamContextInput {
  /** The season being shown. It and every later season are excluded from every figure. */
  season: number
  members: Array<Pick<HistoryMember, 'managerId' | 'displayName'>>
  /** The name-keyed champion per season. See {@link ChampionListing}. */
  champions: ChampionListing[]
  /** For `lastFinal`: `championManagerId` and `runnerUpManagerId`. */
  seasons: Array<Pick<HistorySeason, 'season' | 'championManagerId' | 'runnerUpManagerId'>>
  /** For `playoffAppearances`: `madePlayoffs`. */
  standings: Array<Pick<HistoryStanding, 'season' | 'managerId' | 'madePlayoffs'>>
}

/**
 * Titles, playoff appearances and the last final, for every member.
 *
 * One row per entry in `members`, in that order, whether or not the member is
 * in this season's bracket: the caller picks the ones it draws.
 *
 * ## Titles are counted by display name
 *
 * Exactly as `src/app/page.tsx` counts the reigning champion's: a title is a
 * row of `champions` whose name equals the member's `displayName`. Counting on
 * `championManagerId` instead would drop any 2006-2010 title that is on record
 * as a name alone, which is two of Bryan's five and two of Daniel's four.
 * The cost of matching on a name is accepted and worth knowing: a champion name
 * that equals no member's display name is counted for nobody, silently.
 *
 * ## Appearances are completed earlier seasons only
 *
 * `madePlayoffs` on a standings row. The shown season is excluded for the
 * shared reason above; the team is in this bracket, the card does not need a
 * number to say so, and "would be a fifth appearance" arithmetic stays honest.
 *
 * ## `lastFinal`: null is "none on record"
 *
 * The most recent earlier season in which the member was the champion or the
 * runner-up. The runner-up is on record only from 2011, so a null here never
 * means "has never played in one".
 *
 * A name-only title (2006-2010) **does** count as a won final: a title is on
 * record and a title is won in the last game. The asymmetry that follows is
 * deliberate and unavoidable: for those five years the winner is known and the
 * loser is not, so a member whose true last final was a lost one in, say, 2009
 * shows an earlier win (or null) instead. The field's own doc says "on record".
 * In practice it bites nobody: every member with a 2006-2010 title also has a
 * later final on record.
 */
export function teamContext(input: TeamContextInput): TeamContext[] {
  const earlier = <T extends { season: number }>(rows: T[]) => rows.filter((r) => r.season < input.season)
  const champions = earlier(input.champions)
  const seasons = earlier(input.seasons)
  const standings = earlier(input.standings)

  return input.members.map((member) => {
    const titleSeasons = champions.filter((c) => c.champion !== null && c.champion === member.displayName)

    // Every final this member is known to have played, by season. A season can
    // reach this map twice (by id and by name) and must agree with itself, so
    // the id-keyed row is written last and wins.
    const finals = new Map<number, boolean>()
    for (const c of titleSeasons) finals.set(c.season, true)
    for (const s of seasons) {
      if (s.championManagerId === member.managerId) finals.set(s.season, true)
      else if (s.runnerUpManagerId === member.managerId) finals.set(s.season, false)
    }
    const lastSeason = finals.size ? Math.max(...finals.keys()) : null

    return {
      managerId: member.managerId,
      titles: titleSeasons.length,
      playoffAppearances: standings.filter((s) => s.managerId === member.managerId && s.madePlayoffs).length,
      lastFinal: lastSeason === null ? null : { season: lastSeason, won: finals.get(lastSeason)! },
    }
  })
}

export interface PairContextInput {
  bracket: PlayoffBracket
  /**
   * Every matchup row on record, all seasons. It does not need truncating
   * first: this function applies the bracket's season and `throughWeek` itself,
   * so the truncated and the untruncated list give the same answer.
   */
  matchups: HistoryMatchup[]
}

/**
 * This season's meetings and the playoff history, for each current-round game
 * with both teams known. The third-place game is included once both semi-final
 * losers are known. A decided bracket (`currentRound` null) returns `[]`.
 *
 * Every game is stored as two `HistoryMatchup` rows, one per manager. Only
 * **a's** row of each game is read, so nothing is counted twice and the points
 * are already "from a's side".
 *
 * ## `thisSeason`
 *
 * Regular-season rows of the bracket's season, week by week, no later than
 * `throughWeek`. Usually one meeting; an empty list is real (ten teams, fourteen
 * weeks: some pairs meet twice and none are guaranteed to meet).
 *
 * ## `playoffMeetings`
 *
 * Rows passing `isCountedPlayoff` (championship path and the third-place game;
 * the fifth-place game is not a game people were playing seriously), from
 * **strictly earlier seasons**.
 *
 * Leaving out this season's own playoff rows is deliberate, and nearly moot.
 * In a single-elimination bracket two teams cannot meet twice: a championship
 * game's loser is out, and the two teams in the third-place game lost different
 * semi-finals, so they cannot have played each other in an earlier round either.
 * The one row the rule does exclude is the game on the card itself, should it
 * ever be stored while its round is still current, which would otherwise be
 * reported as its own history.
 *
 * ⚠️ "All-time" is only as long as the weekly record. Before 2020 the league
 * has standings and a podium but no games, so there is no row to say who beat
 * whom in a playoff. The 2011-2019 finals could be reconstructed from champion
 * and runner-up, and are not: finals without semi-finals would make the count a
 * mix of two coverages with one label. See {@link playoffMeetingsSince}.
 *
 * A tied playoff game (none on record, and the bracket derivation refuses to
 * draw one) adds to neither tally and cannot be `last`, which needs a winner.
 */
export function pairContext(input: PairContextInput): PairContext[] {
  const { bracket, matchups } = input
  if (bracket.currentRound === null) return []
  const games = bracket.rounds[bracket.currentRound - 1] ?? []

  const out: PairContext[] = []
  for (const game of games) {
    const a = game.a.managerId
    const b = game.b.managerId
    if (a === null || b === null) continue

    const aSide = matchups.filter((m) => m.managerId === a && m.opponentManagerId === b)

    const thisSeason = aSide
      .filter((m) => m.season === bracket.season && !m.isPlayoff && m.week <= bracket.throughWeek)
      .sort((x, y) => x.week - y.week)
      .map((m) => ({ week: m.week, aPoints: m.points, bPoints: m.opponentPoints }))

    const playoff = aSide
      .filter((m) => m.season < bracket.season && isCountedPlayoff(m))
      .sort((x, y) => y.season - x.season || y.week - x.week)
    const decided = playoff.filter((m) => m.result !== 'T')
    const last = decided[0]

    out.push({
      gameId: game.id,
      thisSeason,
      playoffMeetings: {
        aWins: playoff.filter((m) => m.result === 'W').length,
        bWins: playoff.filter((m) => m.result === 'L').length,
        last: last ? { season: last.season, winnerManagerId: last.result === 'W' ? a : b } : null,
      },
    })
  }
  return out
}

/**
 * The first season `playoffMeetings` can see: the earliest season before
 * `season` with a counted playoff game on record. Null when there is none.
 *
 * For the card's label ("playoff meetings since 2020"), so a zero is never read
 * as "these two have never met in the playoffs" about years with no games on
 * record. Derived from the rows, never a hardcoded 2020.
 */
export function playoffMeetingsSince(matchups: HistoryMatchup[], season: number): number | null {
  let first: number | null = null
  for (const m of matchups) {
    if (m.season < season && isCountedPlayoff(m) && (first === null || m.season < first)) first = m.season
  }
  return first
}
