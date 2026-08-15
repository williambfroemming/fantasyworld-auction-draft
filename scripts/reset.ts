/**
 * Clear THIS SEASON'S draft back to a fresh, unstarted state.
 *
 *   npm run draft:reset
 *
 * Deletes every pick, lot, trade, and budget adjustment **belonging to the
 * current season**, and returns the draft to `setup`. Leaves managers, PINs, and
 * the player pool alone — use `npm run pins -- --clear` for PINs.
 *
 * ⚠️ This is NOT how you start a new year. Use `npm run season:new -- 2027`,
 * which keeps the finished draft and rolls the season forward. Until seasons
 * existed, this script *was* the documented way to prepare for a new draft, and
 * running it in July would have destroyed the previous season outright — the
 * risk docs/BACKLOG.md §2 was written about.
 *
 * Every statement below is scoped to `draft.season`, so a past season is
 * unreachable from here no matter what is typed.
 *
 * Guarded by a confirmation of the pick count so this can't be run absent-mindedly
 * against a real draft.
 */
import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  const [{ season, status }] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const [{ n: picks }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  const [{ n: lots }] = await sql`SELECT count(*)::int AS n FROM lots WHERE season = ${season}`
  const [{ n: trades }] = await sql`SELECT count(*)::int AS n FROM trades WHERE season = ${season}`
  const [{ n: archived }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season <> ${season}`

  console.log(
    `Season ${season}: ${picks} picks, ${lots} lots, ${trades} trades, status "${status}"\n` +
      `Other seasons: ${archived} picks — these are NOT touched.`,
  )

  if (Number(picks) > 30 && !process.argv.includes('--force')) {
    console.error(
      `\n✗ ${picks} picks looks like a real draft, not a rehearsal.\n` +
        `  To start a NEW season without losing this one: npm run season:new -- ${Number(season) + 1}\n` +
        `  Re-run with --force only if you are certain you want ${season} erased.\n`,
    )
    process.exit(1)
  }

  // Adjustments first: leaving them behind would carry rehearsal trade cash
  // into the real draft, and because budgets are derived nobody would see a
  // stale number to be suspicious of.
  await sql`DELETE FROM budget_adjustments WHERE season = ${season}`
  await sql`DELETE FROM trades WHERE season = ${season}`
  await sql`DELETE FROM picks WHERE season = ${season}`
  await sql`DELETE FROM lots WHERE season = ${season}`
  await sql`UPDATE draft SET status = 'setup', nomination_index = 0, rev = rev + 1 WHERE id = 1`

  const [after] = await sql`SELECT status, nomination_index FROM draft WHERE id = 1`
  const [{ n: remaining }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  const [{ n: stillArchived }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season <> ${season}`
  const [{ n: pool }] = await sql`SELECT count(*)::int AS n FROM players`
  const [{ n: managers }] = await sql`SELECT count(*)::int AS n FROM managers`

  console.log(
    `\n✓ Reset complete for season ${season}.\n` +
      `  picks: ${remaining}   status: ${after.status}   next nomination: #${Number(after.nomination_index) + 1}\n` +
      `  kept: ${managers} managers, ${pool} players, ${stillArchived} archived picks from other seasons\n`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
