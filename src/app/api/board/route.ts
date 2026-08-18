import { NextResponse } from 'next/server'
import { getSql } from '@/server/sql'
import { listTrades } from '@/server/trade-service'

/**
 * The heavy payload: the undrafted pool, every roster, and the trade log.
 *
 * Split from /api/state so the 400ms poll stays small — clients refetch this
 * only when the state version changes.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const sql = getSql()
  const [{ season }] = await sql`SELECT season FROM draft WHERE id = 1`

  const [pool, rosters, trades] = await Promise.all([
    // "Already drafted" is scoped to this season. Unscoped, every player taken
    // in a previous year would be missing from the pool forever — the league
    // would silently become a keeper league.
    // Injury rides along on the pool query — no extra round trip, and no
    // provider on the request path. It is a stored snapshot from
    // `npm run news:refresh`, so draft night cannot be affected by Sleeper
    // being down. See docs/BACKLOG.md §1.
    sql`SELECT p.id, p.name, p.team, p.position, p.search_rank, p.pos_rank, p.bye_week,
               p.injury_status, p.injury_body_part, p.injury_notes,
               p.practice_participation, p.injury_updated_at
        FROM players p
        WHERE NOT EXISTS (
                SELECT 1 FROM picks pk
                WHERE pk.player_id = p.id AND pk.season = ${season})
          AND NOT EXISTS (
                SELECT 1 FROM lots l
                WHERE l.player_id = p.id AND l.status = 'open' AND l.season = ${season})
        ORDER BY p.search_rank NULLS LAST, p.name`,
    // Bye week still comes from the live pool — it is this season's schedule
    // and only meaningful while the draft is running. Name, team, position and
    // rank come from the pick's own snapshot.
    //
    // ⚠️ Rank is read from `pk.`, never the joined `p.`, even though for the
    // current season they agree today. One source of truth means the live board
    // and the archive can never disagree, and a mid-draft pool re-import cannot
    // move the /stats value benchmark under a running draft. Do not "fix" this
    // into COALESCE(pk.player_rank, p.search_rank).
    sql`SELECT pk.id, pk.pick_no, pk.manager_id, pk.nominator_id, pk.price, pk.slot_override,
               pk.player_name AS name, pk.player_team AS team,
               pk.player_position AS position,
               pk.player_rank, pk.player_pos_rank, p.bye_week
        FROM picks pk LEFT JOIN players p ON p.id = pk.player_id
        WHERE pk.season = ${season}
        ORDER BY pk.pick_no`,
    listTrades(Number(season)),
  ])

  return NextResponse.json(
    {
      pool: pool.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        position: p.position,
        rank: p.search_rank,
        posRank: p.pos_rank,
        byeWeek: p.bye_week,
        // Null status means UNKNOWN, not healthy. The UI must not render an
        // absent injury as a clean bill of health.
        injury: p.injury_status
          ? {
              status: p.injury_status as string,
              bodyPart: (p.injury_body_part as string | null) ?? null,
              notes: (p.injury_notes as string | null) ?? null,
              practice: (p.practice_participation as string | null) ?? null,
              updatedAt: p.injury_updated_at ? String(p.injury_updated_at) : null,
            }
          : null,
      })),
      rosters: rosters.map((r) => ({
        id: r.id,
        pickNo: r.pick_no,
        // Current owner — a trade moves this. `price` stays charged to whoever
        // bought them, via budget_adjustments; see src/server/trade-service.ts.
        managerId: r.manager_id,
        nominatorId: r.nominator_id,
        price: Number(r.price),
        slotOverride: r.slot_override,
        name: r.name,
        team: r.team,
        position: r.position,
        // Frozen at award time — see the warning on the query above.
        rank: r.player_rank,
        posRank: r.player_pos_rank,
        byeWeek: r.bye_week,
      })),
      trades,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
