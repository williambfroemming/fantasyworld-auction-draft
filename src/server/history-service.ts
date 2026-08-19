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
import {
  headToHead,
  leagueSummary,
  memberProfile,
  records,
  seasonInReview,
  type HistoryPick,
  type LeagueSummaryReport,
} from '@/lib/history'

/** `numeric` and `bigint` arrive as strings; null stays null. */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

export async function getHistoryInput(): Promise<HistoryInput> {
  const sql = getSql()

  const [members, seasons, standings, matchups, lineups, picks] = await Promise.all([
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
    // Auction picks, for the draft half of a member page. Snapshot columns only
    // — never a join to `players`, which is re-imported every August.
    sql`SELECT season, manager_id, player_name, player_position, price
          FROM picks ORDER BY season DESC, price DESC`,
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
    picks: picks.map(
      (r): HistoryPick => ({
        season: Number(r.season),
        managerId: Number(r.manager_id),
        playerName: String(r.player_name),
        playerPosition: String(r.player_position),
        price: num(r.price),
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

export async function getRecordBook() {
  const input = await getHistoryInput()
  return { book: records(input), members: input.members }
}

/**
 * A review card per season, newest first.
 *
 * Every season the league has any record of is included — a standings-era season
 * yields a champion and nothing else, which is the honest answer rather than a
 * gap in the deck.
 */
export async function getSeasonReviews() {
  const input = await getHistoryInput()
  const reviews = input.seasons
    .map((s) => seasonInReview(input, s.season))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.season - a.season)
  return { reviews, members: input.members }
}

export interface AuctionSummary {
  season: number
  picks: number
  spent: number
  /** Managers who finished above the budget. The record does not always balance. */
  overBudget: Array<{ displayName: string; spent: number }>
  topPick: { playerName: string; price: number; displayName: string } | null
  notes: string[]
  isCurrent: boolean
}

/**
 * Every auction the league has on record, newest first.
 *
 * Built from `picks` rather than a list of seasons, because an auction exists
 * exactly when somebody drafted in it — the same rule `listSeasons` uses.
 */
export async function listAuctions(): Promise<AuctionSummary[]> {
  const sql = getSql()
  const [{ season: current }] = await sql`SELECT season FROM draft WHERE id = 1`

  const rows = await sql`
    SELECT pk.season,
           count(*)::int          AS picks,
           COALESCE(sum(pk.price), 0)::int AS spent
      FROM picks pk GROUP BY pk.season ORDER BY pk.season DESC`

  const spendRows = await sql`
    SELECT pk.season, m.display_name, sum(pk.price)::int AS spent
      FROM picks pk JOIN managers m ON m.id = pk.manager_id
     GROUP BY pk.season, m.display_name
     HAVING sum(pk.price) > COALESCE(
       (SELECT s.starting_budget FROM seasons s WHERE s.season = pk.season),
       (SELECT d.starting_budget FROM draft d WHERE d.id = 1))
     ORDER BY sum(pk.price) DESC`

  const topRows = await sql`
    SELECT DISTINCT ON (pk.season) pk.season, pk.player_name, pk.price, m.display_name
      FROM picks pk JOIN managers m ON m.id = pk.manager_id
     ORDER BY pk.season, pk.price DESC, pk.pick_no`

  const noteRows = await sql`SELECT season, notes FROM seasons`
  const notes = new Map(noteRows.map((r) => [Number(r.season), (r.notes as string[] | null) ?? []]))

  return rows.map((r) => {
    const season = Number(r.season)
    const top = topRows.find((t) => Number(t.season) === season)
    return {
      season,
      picks: Number(r.picks),
      spent: Number(r.spent),
      overBudget: spendRows
        .filter((s) => Number(s.season) === season)
        .map((s) => ({ displayName: String(s.display_name), spent: Number(s.spent) })),
      topPick: top
        ? {
            playerName: String(top.player_name),
            price: Number(top.price),
            displayName: String(top.display_name),
          }
        : null,
      notes: notes.get(season) ?? [],
      isCurrent: season === Number(current),
    }
  })
}

export async function getHeadToHead() {
  const input = await getHistoryInput()
  return { report: headToHead(input.matchups, input.seasons), members: input.members }
}

export async function getMemberProfile(managerId: number) {
  const input = await getHistoryInput()
  return { profile: memberProfile(input, managerId), members: input.members }
}

export async function listMembers() {
  const input = await getHistoryInput()
  const summary = leagueSummary(input)
  return summary.rows.map((r) => ({
    member: r.member,
    titles: r.allTime.titles,
    seasons: r.allTime.seasons,
    wins: r.allTime.wins,
    losses: r.allTime.losses,
    winPct: r.allTime.winPct,
  }))
}

export interface FavoritePlayer {
  playerId: string
  playerName: string
  position: string | null
  /** How many separate auctions they bought this player in. */
  timesDrafted: number
  totalSpent: number
  seasons: number[]
  weeksRostered: number
  weeksStarted: number
  pointsScored: number
}

/**
 * Who a manager keeps coming back to.
 *
 * Two different affections, side by side: money spent at auction, and weeks
 * actually carried. They disagree more often than you would think — a player
 * bought once for $54 and dropped by week four is a different kind of favourite
 * from one rostered for four seasons off waivers.
 *
 * A **FULL JOIN** on purpose. Drafting and rostering are independent: a waiver
 * pickup has weeks and no price, and a player bought in 2026 has a price and no
 * weeks yet. An inner join would quietly hide both.
 *
 * Aggregated in SQL rather than in `history.ts` because this is the one report
 * that needs `player_weeks` — 17,000 rows that no other page loads.
 *
 * ⚠️ **Team defenses are excluded.** There is exactly one DEF slot, so whoever
 * holds a defense starts it essentially every week — Daniel's 49ers would sit
 * near the top of his list on 25 starts. That is a fact about the roster shape,
 * not about who he likes, and it crowds out the players the table exists to
 * surface. This league rosters no kickers, so DEF is the only exclusion needed.
 */
export async function getFavoritePlayers(
  managerId: number,
  limit = 20,
): Promise<FavoritePlayer[]> {
  const sql = getSql()
  const rows = await sql`
    WITH drafted AS (
      SELECT pk.player_sleeper_id            AS player_id,
             count(*)::int                   AS times_drafted,
             sum(pk.price)::int              AS total_spent,
             array_agg(pk.season ORDER BY pk.season) AS seasons,
             (array_agg(pk.player_name ORDER BY pk.season DESC))[1]     AS player_name,
             (array_agg(pk.player_position ORDER BY pk.season DESC))[1] AS position
        FROM picks pk
       WHERE pk.manager_id = ${managerId}
         AND pk.player_sleeper_id IS NOT NULL
         AND pk.player_position <> 'DEF'
       GROUP BY pk.player_sleeper_id
    ),
    carried AS (
      SELECT pw.player_id,
             count(*)::int                                AS weeks_rostered,
             count(*) FILTER (WHERE pw.is_starter)::int    AS weeks_started,
             COALESCE(sum(pw.points) FILTER (WHERE pw.is_starter), 0) AS points_scored,
             (array_agg(pw.player_name ORDER BY pw.season DESC))[1] AS player_name,
             (array_agg(pw.position    ORDER BY pw.season DESC))[1] AS position
        FROM player_weeks pw
       WHERE pw.manager_id = ${managerId}
         AND pw.position <> 'DEF'
       GROUP BY pw.player_id
    )
    SELECT COALESCE(d.player_id, c.player_id)          AS player_id,
           COALESCE(d.player_name, c.player_name)      AS player_name,
           COALESCE(d.position, c.position)            AS position,
           COALESCE(d.times_drafted, 0)                AS times_drafted,
           COALESCE(d.total_spent, 0)                  AS total_spent,
           COALESCE(d.seasons, '{}')                   AS seasons,
           COALESCE(c.weeks_rostered, 0)               AS weeks_rostered,
           COALESCE(c.weeks_started, 0)                AS weeks_started,
           COALESCE(c.points_scored, 0)                AS points_scored
      FROM drafted d
      FULL JOIN carried c ON c.player_id = d.player_id
     ORDER BY COALESCE(d.total_spent, 0) DESC,
              COALESCE(c.weeks_rostered, 0) DESC
     LIMIT ${limit}`

  return rows.map((r) => ({
    playerId: String(r.player_id),
    playerName: String(r.player_name ?? r.player_id),
    position: r.position === null ? null : String(r.position),
    timesDrafted: num(r.times_drafted),
    totalSpent: num(r.total_spent),
    seasons: ((r.seasons as number[] | null) ?? []).map(Number),
    weeksRostered: num(r.weeks_rostered),
    weeksStarted: num(r.weeks_started),
    pointsScored: num(r.points_scored),
  }))
}

/**
 * The same, ranked by weeks **started** — the best available answer to "who is
 * this person's favourite player".
 *
 * Started beats rostered because starting somebody is a decision taken every
 * week, while a roster spot can be inertia: the guy you never got round to
 * dropping counts the same as the guy you built around. Weeks rostered stays in
 * the table beside it, because the gap between the two is itself interesting.
 *
 * It is not a pure measure of affection — a great player gets started because he
 * is great — but no available signal separates loyalty from good judgement, and
 * this one at least reflects a repeated choice.
 */
export async function getMostStarted(managerId: number, limit = 10) {
  const all = await getFavoritePlayers(managerId, 200)
  return [...all]
    .filter((p) => p.weeksStarted > 0)
    .sort((a, b) => b.weeksStarted - a.weeksStarted || b.weeksRostered - a.weeksRostered)
    .slice(0, limit)
}

export interface PickupOwner {
  managerId: number
  displayName: string
  pointsStarted: number
  weeksStarted: number
  weeksRostered: number
}

export interface BestPickup {
  season: number
  playerId: string
  playerName: string
  position: string | null
  /** Totals across everyone who held them that season. */
  pointsStarted: number
  weeksStarted: number
  weeksRostered: number
  /**
   * Split by manager, most productive first.
   *
   * More than one entry is common and interesting: in 2023 Eric/Blakey picked
   * C.J. Stroud up and Bill finished the season with him, and Bill found Kyren
   * Williams before trading him to Daniel. Crediting one manager would erase
   * either the find or the payoff, and they are rarely the same person.
   */
  owners: PickupOwner[]
}

export async function getBestPickups(perSeason = 3): Promise<Map<number, BestPickup[]>> {
  const sql = getSql()
  const rows = await sql`
    WITH week_one AS (
      -- Everybody who was on any roster in week 1, league-wide.
      SELECT DISTINCT season, player_id FROM player_weeks WHERE week = 1
    ),
    by_owner AS (
      SELECT pw.season,
             pw.player_id,
             pw.manager_id,
             COALESCE(sum(pw.points) FILTER (WHERE pw.is_starter), 0) AS points_started,
             count(*) FILTER (WHERE pw.is_starter)::int               AS weeks_started,
             count(*)::int                                            AS weeks_rostered,
             (array_agg(pw.player_name ORDER BY pw.week DESC))[1]     AS player_name,
             (array_agg(pw.position    ORDER BY pw.week DESC))[1]     AS position
        FROM player_weeks pw
       WHERE pw.position <> 'DEF'
         AND NOT EXISTS (
               SELECT 1 FROM week_one w
                WHERE w.season = pw.season AND w.player_id = pw.player_id)
       GROUP BY pw.season, pw.player_id, pw.manager_id
    ),
    -- Rank on the player's whole season, not one owner's share of it: a pickup
    -- who was traded mid-season is one story, and splitting it across two rows
    -- would rank both halves below a lesser player nobody moved.
    totals AS (
      SELECT season, player_id,
             sum(points_started) AS total_points,
             sum(weeks_started)::int AS total_starts
        FROM by_owner GROUP BY season, player_id
    ),
    ranked AS (
      SELECT t.*, row_number() OVER (
               PARTITION BY t.season ORDER BY t.total_points DESC, t.total_starts DESC
             ) AS rn
        FROM totals t
       WHERE t.total_starts > 0
    )
    SELECT o.*, r.total_points, r.total_starts, r.rn, m.display_name
      FROM ranked r
      JOIN by_owner o ON o.season = r.season AND o.player_id = r.player_id
      JOIN managers m ON m.id = o.manager_id
     WHERE r.rn <= ${perSeason}
     ORDER BY r.season DESC, r.rn, o.points_started DESC`

  const out = new Map<number, BestPickup[]>()
  for (const r of rows) {
    const season = Number(r.season)
    const playerId = String(r.player_id)
    const list = out.get(season) ?? []
    let entry = list.find((p) => p.playerId === playerId)
    if (!entry) {
      entry = {
        season,
        playerId,
        playerName: String(r.player_name ?? playerId),
        position: r.position === null ? null : String(r.position),
        pointsStarted: num(r.total_points),
        weeksStarted: num(r.total_starts),
        weeksRostered: 0,
        owners: [],
      }
      list.push(entry)
    }
    // A manager who rostered them and never started them realised nothing, and
    // the metric is points realised. Their row would be a line of zeroes.
    if (num(r.weeks_started) === 0) {
      entry.weeksRostered += num(r.weeks_rostered)
      out.set(season, list)
      continue
    }
    entry.owners.push({
      managerId: Number(r.manager_id),
      displayName: String(r.display_name),
      pointsStarted: num(r.points_started),
      weeksStarted: num(r.weeks_started),
      weeksRostered: num(r.weeks_rostered),
    })
    entry.weeksRostered += num(r.weeks_rostered)
    out.set(season, list)
  }
  return out
}
