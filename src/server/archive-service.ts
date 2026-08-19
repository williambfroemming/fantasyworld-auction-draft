/**
 * Past seasons, read-only.
 *
 * The league is not a keeper league — nothing carries forward between years, no
 * player, no price, no budget. The only thing that persists is the *record*, and
 * this is how that record is read back. See docs/BACKLOG.md §2.
 *
 * ## Why nothing here joins to `players`
 *
 * The pool is re-imported from a fresh rankings CSV every season. A player
 * changes team, changes position, or retires out of the file altogether, and
 * `players.id` is not even a stable key across imports (a Sleeper id in one
 * year, a derived slug in another). Rendering a 2026 pick through today's
 * `players` row would show a 2028 team on a 2026 board — history quietly
 * rewritten by a routine data refresh.
 *
 * So an archived season renders entirely from what was written down that night:
 * `picks.player_name / player_team / player_position`, copied in at award time,
 * and `season_orders` for the seating and the names on the columns.
 *
 * ## Why budgets are recomputed here rather than read from manager_totals
 *
 * `manager_totals` describes the CURRENT season only — that filter is what stops
 * last year's spend from bankrupting everyone this year. It is therefore the
 * wrong tool for a past season, and the arithmetic is repeated below against the
 * archived rows instead. Budget still isn't stored anywhere.
 */
import { getSql } from './sql'
import { listTrades, type TradeSummary } from './trade-service'
import { managerColor } from '@/lib/colors'

export interface ArchiveManager {
  id: number
  /** What the board called them that season, not what it calls them today. */
  displayName: string
  color: string
  draftSlot: number
  spent: number
  budget: number
  rostered: number
}

export interface ArchivePick {
  id: number
  /**
   * Fantasy points this player scored that season, from `player_seasons`.
   * Null means unknown — the season is not played yet, or the player has no
   * row — and must never be read as zero.
   */
  points?: number | null
  pickNo: number
  managerId: number
  nominatorId: number
  price: number
  slotOverride: string | null
  name: string
  team: string | null
  position: string
  /**
   * Pool rank the night this player was bought, from the pick's OWN snapshot
   * column — not a join to `players`. This is what lets /stats score a finished
   * season's bargains and overpays years later.
   *
   * Null for any season drafted before `picks.player_rank` existed. Those picks
   * simply go unscored; there is no way to recover the rank once that season's
   * pool has been replaced.
   */
  rank: number | null
  posRank: number | null
  /** Always null in the archive — bye weeks belong to a season that is over. */
  byeWeek: null
}

export interface SeasonSummary {
  season: number
  picks: number
  spent: number
  /** True for the season currently being drafted; that one is live, not archived. */
  isCurrent: boolean
}

export interface ArchiveSeason {
  season: number
  rosterSize: number
  startingBudget: number
  /**
   * The season's record is complete.
   *
   * Read this rather than inferring completeness from roster counts. 2022 has a
   * pick missing from the record that cannot be recovered, so "is every roster
   * full?" says that season is still in progress, forever.
   */
  isFinal: boolean
  /**
   * Anything a reader of this season needs told — an unbalanced budget, a pick
   * that is missing from the source. Rendered on the board rather than left for
   * somebody to rediscover.
   */
  notes: string[]
  managers: ArchiveManager[]
  rosters: ArchivePick[]
  trades: TradeSummary[]
}

/**
 * Every season the league has a record of, newest first.
 *
 * Built from `picks` rather than a seasons table: a season exists exactly when
 * somebody drafted in it. The current season is always included even with zero
 * picks, because "2027, not started yet" is a real answer to "what years are
 * there".
 */
export async function listSeasons(): Promise<SeasonSummary[]> {
  const sql = getSql()
  const [{ season: current }] = await sql`SELECT season FROM draft WHERE id = 1`
  const rows = await sql`
    SELECT season, count(*)::int AS picks, COALESCE(sum(price), 0)::int AS spent
    FROM picks GROUP BY season ORDER BY season DESC`

  const seasons = rows.map((r) => ({
    season: Number(r.season),
    picks: Number(r.picks),
    spent: Number(r.spent),
    isCurrent: Number(r.season) === Number(current),
  }))

  if (!seasons.some((s) => s.isCurrent)) {
    seasons.unshift({ season: Number(current), picks: 0, spent: 0, isCurrent: true })
  }
  return seasons.sort((a, b) => b.season - a.season)
}

/** One season's finished board. Returns null for a year with no record. */
export async function getArchivedSeason(season: number): Promise<ArchiveSeason | null> {
  const sql = getSql()
  if (!Number.isInteger(season)) return null

  // ⚠️ The season's OWN settings, falling back to the current draft's only when
  // that season has none on record.
  //
  // This used to read `draft` unconditionally, which rendered every archived
  // year with today's roster size and budget. That was invisible while the app
  // knew one season and became wrong the moment it knew several: 2022's rosters
  // are not all 16 (one manager's sixteenth pick is missing from the record),
  // and a future rule change would silently rewrite every past board.
  const [settings] = await sql`
    SELECT COALESCE(s.roster_size, d.roster_size)         AS roster_size,
           COALESCE(s.starting_budget, d.starting_budget) AS starting_budget,
           COALESCE(s.is_final, false)                    AS is_final,
           COALESCE(s.notes, '{}')                        AS notes
      FROM draft d
      LEFT JOIN seasons s ON s.season = ${season}
     WHERE d.id = 1`

  const [orderRows, pickRows, adjRows] = await Promise.all([
    sql`SELECT so.manager_id, so.draft_slot, so.display_name, so.color
        FROM season_orders so WHERE so.season = ${season}
        ORDER BY so.draft_slot`,
    // Every column here is `pk.` — the rule at the top of this file still
    // holds, there is no join to `players`. player_rank is the pick's own
    // snapshot, written at award time exactly like player_name.
    // The one permitted join, and the reason it is permitted: `player_seasons`
    // is keyed by (season, player_id) and records what a player scored in THAT
    // year. It is history, not the pool — re-importing next August's rankings
    // cannot change a 2021 row, which is exactly what makes a `players` join
    // unsafe and this one fine. It is what lets /stats say a $1 pick finished
    // WR4 years later.
    sql`SELECT pk.id, pk.pick_no, pk.manager_id, pk.nominator_id, pk.price, pk.slot_override,
               pk.player_name, pk.player_team, pk.player_position,
               pk.player_rank, pk.player_pos_rank, ps.total_points
        FROM picks pk
        LEFT JOIN player_seasons ps
          ON ps.season = pk.season AND ps.player_id = pk.player_sleeper_id
        WHERE pk.season = ${season} ORDER BY pk.pick_no`,
    sql`SELECT manager_id, COALESCE(SUM(amount), 0)::int AS total
        FROM budget_adjustments WHERE season = ${season} GROUP BY manager_id`,
  ])

  if (pickRows.length === 0 && orderRows.length === 0) return null

  // A season predating season_orders, or one where the snapshot never ran, still
  // has picks — fall back to the live manager rows so the board is readable
  // rather than empty. Names may be today's; that is strictly better than
  // showing nothing.
  const seats =
    orderRows.length > 0
      ? orderRows
      : await sql`SELECT id AS manager_id, draft_slot, display_name, color
                  FROM managers ORDER BY draft_slot`

  const adjustments = new Map(adjRows.map((a) => [Number(a.manager_id), Number(a.total)]))
  const startingBudget = Number(settings.starting_budget)

  const managers: ArchiveManager[] = seats.map((s) => {
    const mine = pickRows.filter((p) => Number(p.manager_id) === Number(s.manager_id))
    const spent = mine.reduce((sum, p) => sum + Number(p.price), 0)
    return {
      id: Number(s.manager_id),
      displayName: s.display_name,
      // See the note in draft-service: theme-aware at the serialisation boundary.
      color: managerColor(s.color),
      draftSlot: Number(s.draft_slot),
      spent,
      budget: startingBudget - spent + (adjustments.get(Number(s.manager_id)) ?? 0),
      rostered: mine.length,
    }
  })

  return {
    season,
    rosterSize: Number(settings.roster_size),
    startingBudget,
    isFinal: Boolean(settings.is_final),
    notes: (settings.notes as string[] | null) ?? [],
    managers,
    rosters: pickRows.map((p) => ({
      id: Number(p.id),
      pickNo: Number(p.pick_no),
      managerId: Number(p.manager_id),
      nominatorId: Number(p.nominator_id),
      price: Number(p.price),
      slotOverride: p.slot_override,
      name: p.player_name,
      team: p.player_team,
      position: p.player_position,
      rank: p.player_rank === null ? null : Number(p.player_rank),
      posRank: p.player_pos_rank === null ? null : Number(p.player_pos_rank),
      // Null is unknown, never zero — see `ResultPick.points` in draft-value.ts.
      points: p.total_points === null || p.total_points === undefined ? null : Number(p.total_points),
      byeWeek: null,
    })),
    trades: await listTrades(season, 100),
  }
}
