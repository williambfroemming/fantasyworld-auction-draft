/**
 * What drafts the league has on record.
 *
 *   npm run season:list
 *
 * The quickest answer to "is 2026 still there?" — which is the question
 * docs/BACKLOG.md §2 exists to make answerable.
 */
import { neon } from '@neondatabase/serverless'
import '../src/db/neon-local'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  const [d] = await sql`SELECT season, status, roster_size FROM draft WHERE id = 1`
  const current = Number(d.season)

  const rows = await sql`
    SELECT p.season,
           count(*)::int                       AS picks,
           COALESCE(sum(p.price), 0)::int      AS spent,
           count(DISTINCT p.manager_id)::int   AS managers,
           (SELECT count(*)::int FROM trades t WHERE t.season = p.season) AS trades,
           (SELECT count(*)::int FROM season_orders s WHERE s.season = p.season) AS seats
    FROM picks p GROUP BY p.season ORDER BY p.season DESC`

  console.log(`\nCurrent season: ${current} (status "${d.status}")\n`)
  console.table(
    rows.map((r) => ({
      season: Number(r.season),
      picks: Number(r.picks),
      spent: `$${r.spent}`,
      managers: Number(r.managers),
      trades: Number(r.trades),
      'order kept': Number(r.seats) > 0 ? 'yes' : 'NO',
      state: Number(r.season) === current ? 'current' : 'archived',
    })),
  )

  if (rows.length === 0) console.log('No picks on record in any season.\n')
  else console.log(`\nArchived boards: /board  ·  CSV: /api/export?season=<year>\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
