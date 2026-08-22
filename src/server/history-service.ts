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
import { draftDna, type DnaPick, type DraftDna } from '@/lib/draft-dna'
import { draftersByPick } from '@/lib/stats'
import type { StatsTrade } from '@/lib/stats'

/** `numeric` and `bigint` arrive as strings; null stays null. */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

export async function getHistoryInput(): Promise<HistoryInput> {
  const sql = getSql()

  const [members, seasons, standings, matchups, lineups, picks, trades] = await Promise.all([
    sql`SELECT id, name, display_name, color FROM managers ORDER BY id`,
    sql`SELECT season, data_tier, regular_season_weeks,
               champion_manager_id, runner_up_manager_id, third_manager_id,
               champion_prize, runner_up_prize, third_prize, buy_in,
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
    sql`SELECT id, season, manager_id, player_name, player_position, price
          FROM picks ORDER BY season DESC, price DESC`,
    // A handful of rows, and the only surviving record of who bought a traded
    // player. Without it every pick above is attributed to its current owner.
    sql`SELECT id, created_at, manager_a_id, manager_b_id, picks_a_to_b, picks_b_to_a
          FROM trades ORDER BY created_at`,
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
        buyIn: numOrNull(r.buy_in),
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
        id: Number(r.id),
        season: Number(r.season),
        managerId: Number(r.manager_id),
        playerName: String(r.player_name),
        playerPosition: String(r.player_position),
        price: num(r.price),
      }),
    ),
    trades: trades.map(
      (r): StatsTrade => ({
        id: Number(r.id),
        createdAt: new Date(r.created_at as string).toISOString(),
        managerAId: Number(r.manager_a_id),
        managerBId: Number(r.manager_b_id),
        players: [
          ...((r.picks_a_to_b as number[]) ?? []).map((id) => ({
            pickId: Number(id),
            toManagerId: Number(r.manager_b_id),
          })),
          ...((r.picks_b_to_a as number[]) ?? []).map((id) => ({
            pickId: Number(id),
            toManagerId: Number(r.manager_a_id),
          })),
        ],
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
  /**
   * Null for the 2006–2010 seasons, whose champion survives in
   * `legacy_champions` as a **name only** — there is no manager row to hang a
   * colour on. Treat it as unknown, not as "no colour".
   */
  championManagerId: number | null
  championColor: string | null
  championPrize: number | null
  buyIn: number | null
}

/**
 * Every season the league has any record of, newest first.
 *
 * The prize and colour columns are here rather than in a second query because
 * this already reads `seasons` — the landing page (`docs/BACKLOG.md` §11) wants
 * the reigning champion and what they won, and `/history` simply ignores the
 * extra fields.
 */
export async function listHistorySeasons(): Promise<SeasonListing[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT s.season, s.data_tier, s.draft_city, s.draft_state,
           s.champion_prize, s.buy_in, s.champion_manager_id, m.color,
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
    championManagerId: numOrNull(r.champion_manager_id),
    championColor: r.color === null ? null : String(r.color),
    championPrize: numOrNull(r.champion_prize),
    buyIn: numOrNull(r.buy_in),
  }))
}

export interface ChampionStarter {
  slot: string
  playerName: string
  position: string | null
  nflTeam: string | null
  points: number
}

export interface ChampionshipLineup {
  season: number
  week: number
  points: number
  opponent: string | null
  opponentPoints: number | null
  starters: ChampionStarter[]
}

/**
 * The eleven names that actually won it — the champion's starting lineup from
 * the final, with what each of them scored.
 *
 * ## Finding the final without guessing
 *
 * `playoff_round` alone is not enough: the same round holds the consolation
 * bracket, and in 2025 week 17 round 3 contains both the championship game and
 * the third-place game. What separates them is `playoff_placement` — a
 * consolation game carries the place it decides (3, 5, …) and the final carries
 * null or 1. So the final is the champion's **latest** playoff win that is not a
 * placement game.
 *
 * ⚠️ **Weekly-era seasons only.** `player_weeks` starts in 2020; before that the
 * league has standings and a champion's name and nothing else. Null is the
 * ordinary answer for 2006–2019 and callers render the champion without a
 * lineup rather than treating it as missing data.
 */
export async function getChampionshipLineup(season: number): Promise<ChampionshipLineup | null> {
  const sql = getSql()

  const [final] = await sql`
    SELECT sm.week, sm.points, sm.opponent_manager_id,
           opp.points AS opponent_points,
           om.display_name AS opponent_name
      FROM seasons s
      JOIN season_matchups sm
        ON sm.season = s.season AND sm.manager_id = s.champion_manager_id
      LEFT JOIN season_matchups opp
        ON opp.season = sm.season AND opp.week = sm.week
       AND opp.manager_id = sm.opponent_manager_id
      LEFT JOIN managers om ON om.id = sm.opponent_manager_id
     WHERE s.season = ${season}
       AND sm.is_playoff
       AND sm.result = 'W'
       AND (sm.playoff_placement IS NULL OR sm.playoff_placement = 1)
     ORDER BY sm.week DESC
     LIMIT 1`

  if (!final) return null

  const rows = await sql`
    SELECT pw.slot, pw.player_name, pw.position, pw.nfl_team, pw.points
      FROM player_weeks pw
      JOIN seasons s ON s.season = pw.season
     WHERE pw.season = ${season}
       AND pw.week = ${Number(final.week)}
       AND pw.manager_id = s.champion_manager_id
       AND pw.is_starter
     ORDER BY pw.points DESC`

  // A weekly-era season with no rows is a gap in the import, not a lineup of
  // nobody — say nothing rather than draw an empty card.
  if (rows.length === 0) return null

  return {
    season,
    week: Number(final.week),
    points: Number(final.points),
    opponent: final.opponent_name === null ? null : String(final.opponent_name),
    opponentPoints: numOrNull(final.opponent_points),
    starters: rows.map((r) => ({
      slot: String(r.slot ?? ''),
      playerName: String(r.player_name),
      position: r.position === null ? null : String(r.position),
      nflTeam: r.nfl_team === null ? null : String(r.nfl_team),
      points: Number(r.points),
    })),
  }
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
  /**
   * ⚠️ Nearly a constant, and not worth reporting on its own. Every season lands
   * between $1,979 and $2,000 of a $2,000 ceiling, because the room spends
   * essentially all of it every year — as does `picks`, which is always
   * `managers × rosterSize`. `medianPrice` and `dollarPicks` below are the two
   * that actually move, and they are what a summary should lead with.
   */
  spent: number
  /** Half the draft went for this or less. Has ranged $3–$7. */
  medianPrice: number
  /** Players bought for exactly $1. Has ranged 31–53 — the widest spread here. */
  dollarPicks: number
  /** Managers who finished above the budget. The record does not always balance. */
  overBudget: Array<{ displayName: string; spent: number }>
  topPick: { playerName: string; price: number; displayName: string } | null
  /**
   * The draft's story, written once and stored. Null until someone runs
   * `npm run draft:recap` for that season.
   */
  recap: string | null
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
           COALESCE(sum(pk.price), 0)::int AS spent,
           COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY pk.price), 0)::int
                                  AS median_price,
           count(*) FILTER (WHERE pk.price = 1)::int AS dollar_picks
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

  const noteRows = await sql`SELECT season, notes, draft_recap FROM seasons`
  const notes = new Map(noteRows.map((r) => [Number(r.season), (r.notes as string[] | null) ?? []]))
  const recaps = new Map(
    noteRows.map((r) => [Number(r.season), (r.draft_recap as string | null) ?? null]),
  )

  return rows.map((r) => {
    const season = Number(r.season)
    const top = topRows.find((t) => Number(t.season) === season)
    return {
      season,
      picks: Number(r.picks),
      spent: Number(r.spent),
      medianPrice: Number(r.median_price),
      dollarPicks: Number(r.dollar_picks),
      recap: recaps.get(season) ?? null,
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

/**
 * How one manager drafts, across every auction on record.
 *
 * A **dedicated pair of queries rather than an extension of
 * `getHistoryInput()`**. That loader already feeds the all-time table, the
 * record book and the head-to-head grid, and none of them should start paying
 * for a points join to render a section they do not draw.
 *
 * ⚠️ The join to `player_seasons` is the one join to a pick that is safe. It is
 * keyed by `(season, player_id)` and records what a player scored in *that*
 * year, so re-importing next August's pool cannot change a 2021 row — unlike
 * `players`, which is replaced wholesale and would show a future team on a past
 * board. The key is `picks.player_sleeper_id`, the only player identity that
 * survives a season; it is nullable on purpose, and a null simply means that
 * pick goes unscored.
 *
 * ⚠️ `total_points` is `numeric`, which Neon returns **as a string**. Summing
 * those concatenates instead of adding, so it goes through `Number()` here at
 * the boundary rather than anywhere downstream.
 */
export async function getDraftDna(managerId: number): Promise<DraftDna> {
  const sql = getSql()

  const [pickRows, tradeRows] = await Promise.all([
    sql`SELECT pk.id, pk.season, pk.pick_no, pk.manager_id, pk.price,
               pk.player_name, pk.player_position, ps.total_points
          FROM picks pk
          LEFT JOIN player_seasons ps
            ON ps.season = pk.season AND ps.player_id = pk.player_sleeper_id
         ORDER BY pk.season DESC, pk.pick_no`,
    // Only the two columns the rewind needs. Player names on a trade are for
    // the trade log; this is arithmetic.
    sql`SELECT id, created_at, manager_a_id, manager_b_id, picks_a_to_b, picks_b_to_a
          FROM trades ORDER BY created_at`,
  ])

  const picks: DnaPick[] = pickRows.map((r) => ({
    id: Number(r.id),
    season: Number(r.season),
    pickNo: Number(r.pick_no),
    managerId: Number(r.manager_id),
    name: String(r.player_name),
    position: String(r.player_position),
    price: num(r.price),
    points: numOrNull(r.total_points),
  }))

  const trades: StatsTrade[] = tradeRows.map((r) => ({
    id: Number(r.id),
    createdAt: new Date(r.created_at as string).toISOString(),
    managerAId: Number(r.manager_a_id),
    managerBId: Number(r.manager_b_id),
    players: [
      ...((r.picks_a_to_b as number[]) ?? []).map((id) => ({
        pickId: Number(id),
        toManagerId: Number(r.manager_b_id),
      })),
      ...((r.picks_b_to_a as number[]) ?? []).map((id) => ({
        pickId: Number(id),
        toManagerId: Number(r.manager_a_id),
      })),
    ],
  }))

  return draftDna(picks, trades, managerId)
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

// ---------------------------------------------------------------------------
// Player history — the league seen from one player's side
// ---------------------------------------------------------------------------

/** One manager's share of a player, over a season or over the whole run. */
export interface PlayerOwnerLine {
  managerId: number
  displayName: string
  weeksRostered: number
  weeksStarted: number
  /** Every point scored while on this manager's roster, bench included. */
  points: number
  /** Only the weeks they actually started them. */
  pointsStarted: number
}

/** Points and weeks over some subset — a whole run, or just the playoffs. */
export interface PlayerSplit {
  weeksRostered: number
  weeksStarted: number
  points: number
  pointsStarted: number
}

/**
 * What an auction cost, and who put them on the block.
 *
 * The nominator is very often not the buyer — across 2021–2025, 474 of 800 picks
 * (59%) were won by somebody other than whoever threw the name out. That gap is
 * the interesting part, so it is stated rather than left to be inferred.
 */
export interface PlayerDraftLine {
  /** The buyer, resolved through `draftersByPick` — never the current owner. */
  managerId: number
  displayName: string
  price: number
  nominatedBy: { managerId: number; displayName: string } | null
  /** True when whoever nominated them also ended up winning them. */
  nominatorWon: boolean
}

export interface PlayerSeasonLine {
  season: number
  weeksRostered: number
  weeksStarted: number
  points: number
  pointsStarted: number
  /** Weeks before this season's `playoff_week_start`. */
  regular: PlayerSplit
  /** Weeks from `playoff_week_start` on. */
  playoff: PlayerSplit
  /**
   * Everyone who rostered them that season, most weeks first.
   *
   * More than one is common and is the interesting case — a waiver find who gets
   * traded belongs to both managers, and naming only one erases either the find
   * or the payoff. Same reasoning as `BestPickup.owners`.
   */
  owners: PlayerOwnerLine[]
  /** The auction that season. Null before 2021, and for anyone undrafted. */
  draft: PlayerDraftLine | null
}

export interface PlayerWeekPoint {
  season: number
  week: number
  points: number
  isStarter: boolean
  isPlayoff: boolean
  managerId: number
  displayName: string
}

export interface PlayerHistory {
  playerId: string
  playerName: string
  position: string | null
  /**
   * The window these totals actually cover.
   *
   * Weekly data starts in 2020 (`seasons.data_tier`), so a "career" total here
   * means "since 2020" and the page must say so. The league has records back to
   * 2006; presenting six years as a career is a confident wrong answer about the
   * one thing this page exists to report.
   */
  firstSeason: number
  lastSeason: number
  weeksRostered: number
  weeksStarted: number
  points: number
  pointsStarted: number
  /** Career totals, split on each season's own playoff boundary. */
  regular: PlayerSplit
  playoff: PlayerSplit
  seasons: PlayerSeasonLine[]
  /** Career ownership, most weeks first — "who kept rostering this guy". */
  owners: PlayerOwnerLine[]
  /** Best single week, and who was holding them for it. */
  best: PlayerWeekPoint | null
  /** Every week, oldest first. The series behind the chart. */
  weekly: PlayerWeekPoint[]
}

/** A `player_weeks` row joined to its manager, before aggregation. */
export interface PlayerWeekRow {
  season: number
  week: number
  managerId: number
  displayName: string
  points: number
  isStarter: boolean
  /**
   * Resolved by the caller against that season's `playoff_week_start`, not by
   * comparing to a constant. The boundary is **week 14 in 2020 and week 15 from
   * 2021 on** — a hardcoded 15 files 2020's first playoff week as a regular one
   * forever, and nothing about the result looks wrong.
   */
  isPlayoff: boolean
  playerName: string | null
  position: string | null
}

/** A draft row for this player, already attributed to the drafter. */
export interface PlayerDraftRow {
  season: number
  managerId: number
  displayName: string
  price: number
  nominatorId: number | null
  nominatorName: string | null
}

function addOwner(
  into: Map<number, PlayerOwnerLine>,
  r: PlayerWeekRow,
): void {
  const line = into.get(r.managerId) ?? {
    managerId: r.managerId,
    displayName: r.displayName,
    weeksRostered: 0,
    weeksStarted: 0,
    points: 0,
    pointsStarted: 0,
  }
  line.weeksRostered += 1
  line.points += r.points
  if (r.isStarter) {
    line.weeksStarted += 1
    line.pointsStarted += r.points
  }
  into.set(r.managerId, line)
}

const byWeeksDesc = (a: PlayerOwnerLine, b: PlayerOwnerLine) =>
  b.weeksRostered - a.weeksRostered || b.points - a.points || a.displayName.localeCompare(b.displayName)

/**
 * Shape raw weeks into the player view. Pure, so it is unit-testable without a
 * database — the aggregation rules are the part worth pinning down.
 *
 * Points are counted **rostered, not started**, for the headline totals. From a
 * manager's side `getFavoritePlayers` counts only starts, because a player
 * benched did not help them. From the player's side that would silently delete
 * the weeks somebody sat him, which is a different and wrong question. Both
 * numbers are carried so a caller never has to guess which one it has.
 */
export function buildPlayerHistory(
  playerId: string,
  rows: PlayerWeekRow[],
  drafts: PlayerDraftRow[] = [],
): PlayerHistory | null {
  if (rows.length === 0) return null

  const ordered = [...rows].sort((a, b) => a.season - b.season || a.week - b.week)
  const draftBySeason = new Map(drafts.map((d) => [d.season, d]))

  const careerOwners = new Map<number, PlayerOwnerLine>()
  const seasons = new Map<number, PlayerSeasonLine>()
  const seasonOwners = new Map<number, Map<number, PlayerOwnerLine>>()

  let best: PlayerWeekPoint | null = null
  const weekly: PlayerWeekPoint[] = []
  const careerRegular = emptySplit()
  const careerPlayoff = emptySplit()

  for (const r of ordered) {
    const point: PlayerWeekPoint = {
      season: r.season,
      week: r.week,
      points: r.points,
      isStarter: r.isStarter,
      isPlayoff: r.isPlayoff,
      managerId: r.managerId,
      displayName: r.displayName,
    }
    weekly.push(point)
    addSplit(r.isPlayoff ? careerPlayoff : careerRegular, r)

    // Strictly greater, so the earliest week wins a tie rather than the latest.
    if (!best || r.points > best.points) best = point

    addOwner(careerOwners, r)

    const perSeason = seasonOwners.get(r.season) ?? new Map<number, PlayerOwnerLine>()
    addOwner(perSeason, r)
    seasonOwners.set(r.season, perSeason)

    const d = draftBySeason.get(r.season)
    const line = seasons.get(r.season) ?? {
      season: r.season,
      weeksRostered: 0,
      weeksStarted: 0,
      points: 0,
      pointsStarted: 0,
      regular: emptySplit(),
      playoff: emptySplit(),
      owners: [],
      draft: d
        ? {
            managerId: d.managerId,
            displayName: d.displayName,
            price: d.price,
            nominatedBy:
              d.nominatorId !== null
                ? { managerId: d.nominatorId, displayName: d.nominatorName ?? String(d.nominatorId) }
                : null,
            // Compared against the *drafter*, not the current owner: a pick that
            // was later traded still belongs, for this purpose, to whoever
            // actually bid on it in the room.
            nominatorWon: d.nominatorId === d.managerId,
          }
        : null,
    }
    line.weeksRostered += 1
    line.points += r.points
    if (r.isStarter) {
      line.weeksStarted += 1
      line.pointsStarted += r.points
    }
    addSplit(r.isPlayoff ? line.playoff : line.regular, r)
    seasons.set(r.season, line)
  }

  for (const [season, line] of seasons) {
    line.owners = [...(seasonOwners.get(season)?.values() ?? [])].sort(byWeeksDesc)
  }

  const seasonList = [...seasons.values()].sort((a, b) => a.season - b.season)
  const latest = ordered[ordered.length - 1]

  return {
    playerId,
    playerName: latest.playerName ?? playerId,
    position: latest.position,
    firstSeason: seasonList[0].season,
    lastSeason: seasonList[seasonList.length - 1].season,
    weeksRostered: ordered.length,
    weeksStarted: ordered.filter((r) => r.isStarter).length,
    points: round2(ordered.reduce((s, r) => s + r.points, 0)),
    pointsStarted: round2(
      ordered.filter((r) => r.isStarter).reduce((s, r) => s + r.points, 0),
    ),
    regular: roundSplit(careerRegular),
    playoff: roundSplit(careerPlayoff),
    seasons: seasonList.map((s) => ({
      ...s,
      points: round2(s.points),
      pointsStarted: round2(s.pointsStarted),
      regular: roundSplit(s.regular),
      playoff: roundSplit(s.playoff),
      owners: s.owners.map(roundOwner),
    })),
    owners: [...careerOwners.values()].sort(byWeeksDesc).map(roundOwner),
    best,
    weekly,
  }
}

function emptySplit(): PlayerSplit {
  return { weeksRostered: 0, weeksStarted: 0, points: 0, pointsStarted: 0 }
}

function addSplit(into: PlayerSplit, r: PlayerWeekRow): void {
  into.weeksRostered += 1
  into.points += r.points
  if (r.isStarter) {
    into.weeksStarted += 1
    into.pointsStarted += r.points
  }
}

function roundSplit(s: PlayerSplit): PlayerSplit {
  return { ...s, points: round2(s.points), pointsStarted: round2(s.pointsStarted) }
}

/** Float addition drifts; every total here is money-adjacent enough to notice. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function roundOwner(o: PlayerOwnerLine): PlayerOwnerLine {
  return { ...o, points: round2(o.points), pointsStarted: round2(o.pointsStarted) }
}

/** A row in the player index — enough to find someone, no more. */
export interface PlayerListing {
  playerId: string
  playerName: string
  position: string | null
  firstSeason: number
  lastSeason: number
  weeksRostered: number
  points: number
  /** Most ever paid at auction. Null for anyone only ever picked up free. */
  topPrice: number | null
}

/**
 * Every player the league has ever rostered, for the index and its search box.
 *
 * Deliberately the whole list rather than a server-side query per keystroke:
 * there are ~600 of them across six seasons, which is a small payload once and
 * then instant filtering, versus a round trip per character. It is also a
 * cacheable page rather than a search endpoint.
 *
 * Name and position are taken from the **most recent** week on record, so a
 * player reads as whoever he is now rather than whoever he was in 2020.
 */
export async function listPlayers(): Promise<PlayerListing[]> {
  const sql = getSql()

  const rows = await sql`
    WITH weeks AS (
      SELECT pw.player_id,
             (array_agg(pw.player_name ORDER BY pw.season DESC, pw.week DESC))[1] AS player_name,
             (array_agg(pw.position    ORDER BY pw.season DESC, pw.week DESC))[1] AS position,
             min(pw.season)::int AS first_season,
             max(pw.season)::int AS last_season,
             count(*)::int       AS weeks_rostered,
             sum(pw.points)      AS points
        FROM player_weeks pw
       GROUP BY pw.player_id
    ),
    prices AS (
      SELECT pk.player_sleeper_id AS player_id, max(pk.price)::int AS top_price
        FROM picks pk
       WHERE pk.player_sleeper_id IS NOT NULL
       GROUP BY pk.player_sleeper_id
    )
    SELECT w.*, p.top_price
      FROM weeks w
      LEFT JOIN prices p ON p.player_id = w.player_id
     ORDER BY w.points DESC`

  return rows.map((r) => ({
    playerId: String(r.player_id),
    playerName: (r.player_name as string | null) ?? String(r.player_id),
    position: (r.position as string | null) ?? null,
    firstSeason: Number(r.first_season),
    lastSeason: Number(r.last_season),
    weeksRostered: Number(r.weeks_rostered),
    points: round2(Number(r.points)),
    topPrice: r.top_price === null ? null : Number(r.top_price),
  }))
}

/**
 * One player's whole run in the league.
 *
 * Keyed by **Sleeper id**, the only player key that survives a season
 * (AGENTS.md): `players.id` is a CSV slug that dies every August when the pool
 * is re-imported, so a page keyed on it would break annually and silently.
 *
 * Ownership comes from `player_weeks`, which records who actually held them each
 * week. That sidesteps the trade-attribution problem entirely — no rewind is
 * needed, because the weekly rows already say who had them. The **draft price**
 * is the one part that is a money question, and it goes through `draftersByPick`
 * like every other one.
 */
export async function getPlayerHistory(sleeperId: string): Promise<PlayerHistory | null> {
  const sql = getSql()

  const [weekRows, pickRows, tradeRows, managerRows, seasonRows] = await Promise.all([
    sql`
      SELECT pw.season, pw.week, pw.manager_id, pw.points, pw.is_starter,
             pw.player_name, pw.position,
             m.display_name
        FROM player_weeks pw
        JOIN managers m ON m.id = pw.manager_id
       WHERE pw.player_id = ${sleeperId}
       ORDER BY pw.season, pw.week`,
    sql`
      SELECT pk.id, pk.season, pk.manager_id, pk.price, pk.nominator_id
        FROM picks pk
       WHERE pk.player_sleeper_id = ${sleeperId}
       ORDER BY pk.season`,
    sql`
      SELECT t.id, t.season, t.manager_a_id, t.manager_b_id,
             t.picks_a_to_b, t.picks_b_to_a, t.created_at
        FROM trades t
       ORDER BY t.created_at`,
    sql`SELECT id, display_name FROM managers`,
    // The playoff boundary moves: week 14 in 2020, week 15 from 2021. Read it
    // per season rather than assuming, or 2020's first playoff week is filed as
    // a regular-season one and nothing about the total looks wrong.
    sql`SELECT season, playoff_week_start FROM seasons`,
  ])

  const playoffStart = new Map(
    seasonRows
      .filter((s) => s.playoff_week_start !== null)
      .map((s) => [Number(s.season), Number(s.playoff_week_start)]),
  )

  const rows: PlayerWeekRow[] = weekRows.map((r) => {
    const season = Number(r.season)
    const start = playoffStart.get(season)
    return {
      season,
      week: Number(r.week),
      managerId: Number(r.manager_id),
      displayName: String(r.display_name),
      points: Number(r.points),
      isStarter: Boolean(r.is_starter),
      // No boundary on record means the season cannot be split, so everything
      // counts as regular season rather than being guessed into the playoffs.
      isPlayoff: start !== undefined && Number(r.week) >= start,
      playerName: (r.player_name as string | null) ?? null,
      position: (r.position as string | null) ?? null,
    }
  })

  // Attribute each auction to whoever actually bought them. `draftersByPick`
  // tolerates a partial pick list — it skips ids it has never seen — so passing
  // only this player's picks is safe and keeps the query small.
  const statsPicks = pickRows.map((p) => ({
    id: Number(p.id),
    pickNo: 0,
    managerId: Number(p.manager_id),
    nominatorId: 0,
    price: Number(p.price),
    position: '',
    name: '',
    rank: null,
    posRank: null,
  }))
  const statsTrades = tradeRows.map((t) => ({
    id: Number(t.id),
    managerAId: Number(t.manager_a_id),
    managerBId: Number(t.manager_b_id),
    createdAt: String(t.created_at),
    players: [
      ...(t.picks_a_to_b as number[]).map((pickId) => ({
        pickId: Number(pickId),
        toManagerId: Number(t.manager_b_id),
      })),
      ...(t.picks_b_to_a as number[]).map((pickId) => ({
        pickId: Number(pickId),
        toManagerId: Number(t.manager_a_id),
      })),
    ],
  }))

  const drafter = draftersByPick(statsPicks as never, statsTrades as never)
  // From `managers`, not from the weekly rows: someone who drafted a player and
  // cut them before week 1 has no `player_weeks` row to take a name from, and
  // that is exactly the case a draft-price line needs to render.
  const names = new Map(managerRows.map((m) => [Number(m.id), String(m.display_name)]))

  const drafts: PlayerDraftRow[] = pickRows.map((p) => {
    const managerId = drafter.get(Number(p.id)) ?? Number(p.manager_id)
    const nominatorId = p.nominator_id === null ? null : Number(p.nominator_id)
    return {
      season: Number(p.season),
      managerId,
      displayName: names.get(managerId) ?? String(managerId),
      price: Number(p.price),
      nominatorId,
      nominatorName: nominatorId === null ? null : (names.get(nominatorId) ?? null),
    }
  })

  return buildPlayerHistory(sleeperId, rows, drafts)
}
