/**
 * Migration: `season_schedule`, the games still to be played, for playoff odds.
 *
 *   npm run db:migrate-schedule              # against DATABASE_URL
 *   npm run db:migrate-schedule -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written rather than left to `drizzle-kit push`, for the reason in
 * AGENTS.md: push cannot tell a new table from a rename and silently drops
 * `manager_totals` on its way past. `IF NOT EXISTS` throughout, so re-runnable.
 *
 * Declared in `src/db/schema.ts` as well, because the local Docker database is
 * built from there. Both, or neither, in the same commit.
 *
 * The table starts empty. Run `npm run history:refresh` afterwards (or wait for
 * Tuesday's job) to fill it; until then the front page simply has no odds.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'

const useTest = process.argv.includes('--test')
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!url) throw new Error(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set.`)

const sql: NeonQueryFunction<false, false> = neon(url)

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nAdding season_schedule to "${dbName}"\n`)

  const totalsBefore = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`

  process.stdout.write('  create season_schedule … ')
  await sql.query(
    `CREATE TABLE IF NOT EXISTS season_schedule (
       season              integer NOT NULL REFERENCES seasons(season),
       week                integer NOT NULL,
       manager_id          integer NOT NULL REFERENCES managers(id),
       opponent_manager_id integer NOT NULL REFERENCES managers(id),
       PRIMARY KEY (season, week, manager_id)
     )`,
  )
  console.log('ok')

  const totalsAfter = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`
  if (JSON.stringify(totalsBefore) !== JSON.stringify(totalsAfter)) {
    console.error('\n✗ manager_totals changed. A schedule table must never touch a live budget.')
    process.exit(1)
  }

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM season_schedule`
  console.log(`\n✓ season_schedule ready — ${n} row${n === 1 ? '' : 's'}.`)
  console.log('  manager_totals unchanged.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
