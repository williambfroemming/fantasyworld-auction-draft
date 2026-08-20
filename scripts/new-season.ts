/**
 * Start a new season. The non-destructive replacement for "reset and start over".
 *
 *   npm run season:new -- 2027
 *   npm run season:new -- 2027 --dry-run
 *
 * Deletes NOTHING. Last year's picks, lots, trades and adjustments keep their
 * `season` tag, stop matching the current-season filter, and move into the
 * archive at /board. This is the whole point of docs/BACKLOG.md §2: before it,
 * preparing for a new year meant `npm run draft:reset`, which erased the
 * previous draft outright.
 *
 * Afterwards:
 *   1. re-import the season's rankings   npm run db:seed -- <rankings.csv>
 *   2. draw the new draft order          /setup
 *   3. start the draft                   /setup, or npm run draft:start
 */
import { neon } from '@neondatabase/serverless'
import '../src/db/neon-local'

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const dryRun = args.includes('--dry-run')
  const year = Number(args.find((a) => /^\d{4}$/.test(a)))

  if (!Number.isInteger(year)) {
    console.error('Usage: npm run season:new -- <year> [--dry-run]')
    process.exit(1)
  }

  const sql = neon(process.env.DATABASE_URL!)
  const [d] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const current = Number(d.season)

  const bySeason = await sql`
    SELECT season, count(*)::int AS picks, COALESCE(sum(price), 0)::int AS spent
    FROM picks GROUP BY season ORDER BY season`
  console.log(`\nCurrent season: ${current} (status "${d.status}")`)
  console.table(bySeason)

  if (year <= current) {
    console.error(`✗ The league is already on ${current}. A new season must be a later year.`)
    process.exit(1)
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${year}`
  if (Number(n) > 0) {
    console.error(`✗ ${year} already has ${n} picks — that is not a new season.`)
    process.exit(1)
  }

  // Warn, don't block. A season can legitimately be rolled forward from an
  // abandoned or rehearsal year with no picks; the operator knows which.
  const [{ n: currentPicks }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${current}`
  if (Number(currentPicks) === 0) {
    console.log(`\n⚠ ${current} has no picks — nothing to archive from it.`)
  }

  if (dryRun) {
    console.log(`\n--dry-run: would roll ${current} -> ${year}, deleting nothing.`)
    return
  }

  // Freeze the outgoing season's seating BEFORE managers.draft_slot is re-drawn
  // for the new year. This is the last moment that order is recoverable.
  await sql`
    INSERT INTO season_orders (season, manager_id, draft_slot, display_name, color)
    SELECT ${current}, m.id, m.draft_slot, m.display_name, m.color FROM managers m
    ON CONFLICT (season, manager_id)
    DO UPDATE SET draft_slot   = EXCLUDED.draft_slot,
                  display_name = EXCLUDED.display_name,
                  color        = EXCLUDED.color`

  await sql`
    UPDATE draft SET season = ${year}, status = 'setup', nomination_index = 0, rev = rev + 1
    WHERE id = 1`

  await sql`
    INSERT INTO season_orders (season, manager_id, draft_slot, display_name, color)
    SELECT ${year}, m.id, m.draft_slot, m.display_name, m.color FROM managers m
    ON CONFLICT (season, manager_id) DO NOTHING`

  const [{ n: kept }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${current}`
  const totals = await sql`
    SELECT m.display_name AS manager, t.budget, t.rostered, t.max_bid
    FROM manager_totals t JOIN managers m ON m.id = t.id ORDER BY m.draft_slot`

  console.log(`\n✓ Season ${year} started. ${current} archived with ${kept} picks intact.\n`)
  console.table(totals)
  console.log(
    'Next:\n' +
      `  1. npm run db:seed -- <${year}-rankings.csv>   re-import the pool\n` +
      '  2. /setup                                     draw the draft order\n' +
      `  3. the ${current} board is at /board?season=${current}\n`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
