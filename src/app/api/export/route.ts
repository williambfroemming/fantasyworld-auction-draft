import { getSql } from '@/server/sql'

export const dynamic = 'force-dynamic'

/**
 * Draft results as CSV, shaped like the old sheet's pick log so it pastes
 * straight back into Google Sheets.
 *
 *   /api/export            the season currently being drafted
 *   /api/export?season=2026  any finished season from the archive
 *
 * Player details come from the pick's own snapshot rather than a join to
 * `players`, so exporting 2026 in 2028 gives the teams that were true in 2026.
 */
export async function GET(request: Request) {
  const sql = getSql()

  const requested = new URL(request.url).searchParams.get('season')
  const season =
    requested !== null && /^\d{4}$/.test(requested)
      ? Number(requested)
      : Number((await sql`SELECT season FROM draft WHERE id = 1`)[0].season)

  // Manager names come from that season's snapshot where one exists, so an
  // export of 2026 shows what people were called in 2026 even after a rename.
  const rows = await sql`
    SELECT pk.pick_no,
           COALESCE(nom_o.display_name, nom.display_name) AS nominator,
           pk.player_name AS player, pk.player_team AS team,
           pk.player_position AS position,
           COALESCE(win_o.display_name, win.display_name) AS drafted_by, pk.price
    FROM picks pk
    JOIN managers win ON win.id = pk.manager_id
    JOIN managers nom ON nom.id = pk.nominator_id
    LEFT JOIN season_orders win_o ON win_o.manager_id = pk.manager_id AND win_o.season = pk.season
    LEFT JOIN season_orders nom_o ON nom_o.manager_id = pk.nominator_id AND nom_o.season = pk.season
    WHERE pk.season = ${season}
    ORDER BY pk.pick_no`

  const header = ['Pick', 'Nominator', 'Player', 'Team', 'Position', 'Drafted By', 'Price']
  const body = rows.map((r) =>
    [r.pick_no, r.nominator, r.player, r.team ?? '', r.position, r.drafted_by, r.price].map(cell),
  )
  const csv = [header.join(','), ...body.map((r) => r.join(','))].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="draft-${season}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Quote anything containing a comma, quote, or newline; double internal quotes. */
function cell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
