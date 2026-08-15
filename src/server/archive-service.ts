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
  pickNo: number
  managerId: number
  nominatorId: number
  price: number
  slotOverride: string | null
  name: string
  team: string | null
  position: string
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

  const [settings] = await sql`SELECT roster_size, starting_budget FROM draft WHERE id = 1`

  const [orderRows, pickRows, adjRows] = await Promise.all([
    sql`SELECT so.manager_id, so.draft_slot, so.display_name, so.color
        FROM season_orders so WHERE so.season = ${season}
        ORDER BY so.draft_slot`,
    sql`SELECT pk.id, pk.pick_no, pk.manager_id, pk.nominator_id, pk.price, pk.slot_override,
               pk.player_name, pk.player_team, pk.player_position
        FROM picks pk WHERE pk.season = ${season} ORDER BY pk.pick_no`,
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
      color: s.color,
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
      byeWeek: null,
    })),
    trades: await listTrades(season, 100),
  }
}
