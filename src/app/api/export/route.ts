import { getSql } from '@/server/sql'

export const dynamic = 'force-dynamic'

/**
 * Draft results as CSV, shaped like the old sheet's pick log so it pastes
 * straight back into Google Sheets.
 */
export async function GET() {
  const sql = getSql()
  const rows = await sql`
    SELECT pk.pick_no, nom.display_name AS nominator, p.name AS player, p.team, p.position,
           win.display_name AS drafted_by, pk.price
    FROM picks pk
    JOIN players p ON p.id = pk.player_id
    JOIN managers win ON win.id = pk.manager_id
    JOIN managers nom ON nom.id = pk.nominator_id
    ORDER BY pk.pick_no`

  const header = ['Pick', 'Nominator', 'Player', 'Team', 'Position', 'Drafted By', 'Price']
  const body = rows.map((r) =>
    [r.pick_no, r.nominator, r.player, r.team ?? '', r.position, r.drafted_by, r.price].map(cell),
  )
  const csv = [header.join(','), ...body.map((r) => r.join(','))].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="draft-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Quote anything containing a comma, quote, or newline; double internal quotes. */
function cell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
