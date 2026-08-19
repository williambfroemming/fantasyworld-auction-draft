/**
 * Reading the league's history out of Postgres.
 *
 * The thin half of the pair: everything that *computes* anything lives in
 * `src/lib/history.ts`, which is pure and unit-tested. This file does six queries
 * and converts types at the boundary.
 *
 * ## ⚠️ Every points column is a string until it is not
 *
 * Neon returns `numeric` as a string, so `'124.20' + '110.00'` is
 * `'124.20110.00'` — a sum that renders, sorts, and is wrong. `numeric` is still
 * the right column type (Postgres sums it exactly, where 140 doubles land on
 * 1497.9999999999998), which makes this boundary the one place the conversion
 * can be done once. Nothing downstream should ever see a stringified number.
 *
 * ## Not on the hot path, and not fetched by the client
 *
 * History does not change, so the pages that use this are Server Components with
 * `revalidate`. There is no route, no poll, and nothing here is reachable from
 * `/api/state` or the polling fingerprint in `src/lib/version.ts`.
 */
import { getSql } from './sql'
import type {
  HistoryInput,
  HistoryLineup,
  HistoryMatchup,
  HistoryMember,
  HistorySeason,
  HistoryStanding,
} from '@/lib/history'
import { leagueSummary, type LeagueSummaryReport } from '@/lib/history'

/** `numeric` and `bigint` arrive as strings; null stays null. */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

export async function getHistoryInput(): Promise<HistoryInput> {
  const sql = getSql()

  const [members, seasons, standings, matchups, lineups] = await Promise.all([
    sql`SELECT id, name, display_name, color FROM managers ORDER BY id`,
    sql`SELECT season, data_tier, regular_season_weeks,
               champion_manager_id, runner_up_manager_id, third_manager_id,
               champion_prize, runner_up_prize, third_prize,
               draft_city, draft_state
          FROM seasons ORDER BY season`,
    sql`SELECT season, manager_id, place, wins, losses, ties,
               points_for, points_against, made_playoffs, playoff_wins, playoff_losses
          FROM season_standings ORDER BY season, place`,
    sql`SELECT season, week, manager_id, points, opponent_manager_id, opponent_points,
               is_playoff, playoff_round, playoff_placement, result
          FROM season_matchups ORDER BY season, week`,
    sql`SELECT season, week, manager_id, actual_points, optimal_points
          FROM season_lineups ORDER BY season, week`,
  ])

  return {
    members: members.map(
      (r): HistoryMember => ({
        managerId: Number(r.id),
        name: String(r.name),
        displayName: String(r.display_name),
        color: String(r.color),
      }),
    ),
    seasons: seasons.map(
      (r): HistorySeason => ({
        season: Number(r.season),
        dataTier: r.data_tier as HistorySeason['dataTier'],
        regularSeasonWeeks: numOrNull(r.regular_season_weeks),
        championManagerId: numOrNull(r.champion_manager_id),
        runnerUpManagerId: numOrNull(r.runner_up_manager_id),
        thirdManagerId: numOrNull(r.third_manager_id),
        // Null is unknown, not zero — see the schema. `numOrNull` preserves that.
        championPrize: numOrNull(r.champion_prize),
        runnerUpPrize: numOrNull(r.runner_up_prize),
        thirdPrize: numOrNull(r.third_prize),
        draftCity: r.draft_city === null ? null : String(r.draft_city),
        draftState: r.draft_state === null ? null : String(r.draft_state),
      }),
    ),
    standings: standings.map(
      (r): HistoryStanding => ({
        season: Number(r.season),
        managerId: Number(r.manager_id),
        place: numOrNull(r.place),
        wins: num(r.wins),
        losses: num(r.losses),
        ties: num(r.ties),
        pointsFor: numOrNull(r.points_for),
        pointsAgainst: numOrNull(r.points_against),
        madePlayoffs: Boolean(r.made_playoffs),
        playoffWins: numOrNull(r.playoff_wins),
        playoffLosses: numOrNull(r.playoff_losses),
      }),
    ),
    matchups: matchups.map(
      (r): HistoryMatchup => ({
        season: Number(r.season),
        week: num(r.week),
        managerId: Number(r.manager_id),
        points: num(r.points),
        opponentManagerId: Number(r.opponent_manager_id),
        opponentPoints: num(r.opponent_points),
        isPlayoff: Boolean(r.is_playoff),
        playoffRound: numOrNull(r.playoff_round),
        playoffPlacement: numOrNull(r.playoff_placement),
        result: r.result as HistoryMatchup['result'],
      }),
    ),
    lineups: lineups.map(
      (r): HistoryLineup => ({
        season: Number(r.season),
        week: num(r.week),
        managerId: Number(r.manager_id),
        actual: num(r.actual_points),
        optimal: num(r.optimal_points),
      }),
    ),
  }
}

export async function getLeagueSummary(): Promise<LeagueSummaryReport> {
  return leagueSummary(await getHistoryInput())
}

export interface SeasonListing {
  season: number
  dataTier: HistorySeason['dataTier']
  champion: string | null
  city: string | null
  state: string | null
}

/** Every season the league has any record of, newest first. */
export async function listHistorySeasons(): Promise<SeasonListing[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT s.season, s.data_tier, s.draft_city, s.draft_state,
           COALESCE(m.display_name, lc.champion_name) AS champion
      FROM seasons s
      LEFT JOIN managers m          ON m.id = s.champion_manager_id
      LEFT JOIN legacy_champions lc ON lc.season = s.season
     ORDER BY s.season DESC`
  return rows.map((r) => ({
    season: Number(r.season),
    dataTier: r.data_tier as HistorySeason['dataTier'],
    champion: r.champion === null ? null : String(r.champion),
    city: r.draft_city === null ? null : String(r.draft_city),
    state: r.draft_state === null ? null : String(r.draft_state),
  }))
}
