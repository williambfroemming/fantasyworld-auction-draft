import { NextResponse } from 'next/server'
import { getSql } from '@/server/sql'

/**
 * The heavy payload: the undrafted pool plus every roster.
 *
 * Split from /api/state so the 400ms poll stays small — clients refetch this
 * only when the state version changes.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const sql = getSql()

  const [pool, rosters] = await Promise.all([
    sql`SELECT p.id, p.name, p.team, p.position, p.search_rank, p.pos_rank, p.tier, p.bye_week
        FROM players p
        WHERE NOT EXISTS (SELECT 1 FROM picks pk WHERE pk.player_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM lots l WHERE l.player_id = p.id AND l.status = 'open')
        ORDER BY p.search_rank NULLS LAST, p.name`,
    sql`SELECT pk.id, pk.pick_no, pk.manager_id, pk.price, pk.slot_override,
               p.name, p.team, p.position, p.bye_week
        FROM picks pk JOIN players p ON p.id = pk.player_id
        ORDER BY pk.pick_no`,
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
        tier: p.tier,
        byeWeek: p.bye_week,
      })),
      rosters: rosters.map((r) => ({
        id: r.id,
        pickNo: r.pick_no,
        managerId: r.manager_id,
        price: Number(r.price),
        slotOverride: r.slot_override,
        name: r.name,
        team: r.team,
        position: r.position,
        byeWeek: r.bye_week,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
