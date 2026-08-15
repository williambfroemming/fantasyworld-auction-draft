/**
 * Clear the draft back to a fresh, unstarted state.
 *
 *   npm run draft:reset
 *
 * Deletes every pick, lot, trade, and budget adjustment, and returns the draft
 * to `setup`.
 * Leaves managers, PINs, and the player pool alone — use `npm run pins --
 * --clear` for PINs.
 *
 * Guarded by a confirmation of the pick count so this can't be run absent-mindedly
 * against a real draft.
 */
import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  const [{ n: picks }] = await sql`SELECT count(*)::int AS n FROM picks`
  const [{ n: lots }] = await sql`SELECT count(*)::int AS n FROM lots`
  const [{ n: trades }] = await sql`SELECT count(*)::int AS n FROM trades`
  const [{ status }] = await sql`SELECT status FROM draft WHERE id = 1`

  console.log(`Before: ${picks} picks, ${lots} lots, ${trades} trades, status "${status}"`)

  if (Number(picks) > 30 && !process.argv.includes('--force')) {
    console.error(
      `\n✗ ${picks} picks looks like a real draft, not a rehearsal.\n` +
        `  Re-run with --force if you are certain.\n`,
    )
    process.exit(1)
  }

  // Adjustments first: leaving them behind would carry rehearsal trade cash
  // into the real draft, and because budgets are derived nobody would see a
  // stale number to be suspicious of.
  await sql`DELETE FROM budget_adjustments`
  await sql`DELETE FROM trades`
  await sql`DELETE FROM picks`
  await sql`DELETE FROM lots`
  await sql`UPDATE draft SET status = 'setup', nomination_index = 0, rev = rev + 1 WHERE id = 1`

  const [after] = await sql`SELECT status, nomination_index FROM draft WHERE id = 1`
  const [{ n: remaining }] = await sql`SELECT count(*)::int AS n FROM picks`
  const [{ n: pool }] = await sql`SELECT count(*)::int AS n FROM players`
  const [{ n: managers }] = await sql`SELECT count(*)::int AS n FROM managers`

  console.log(
    `\n✓ Reset complete.\n` +
      `  picks: ${remaining}   status: ${after.status}   next nomination: #${Number(after.nomination_index) + 1}\n` +
      `  kept: ${managers} managers, ${pool} players\n`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
