/**
 * Migration: `season_transactions`, every Sleeper waiver claim, free-agent move, trade and
 * commissioner move, one row per player movement (step 59).
 *
 *   npm run db:migrate-transactions              # against DATABASE_URL
 *   npm run db:migrate-transactions -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written rather than left to `drizzle-kit push`, for the reason in AGENTS.md: push cannot
 * tell a new table from a rename and silently drops `manager_totals` on its way past.
 * `IF NOT EXISTS` throughout, so it is re-runnable. Purely additive: it never alters an
 * existing table, and it checks `manager_totals` is unchanged afterwards.
 *
 * Declared in `src/db/schema.ts` as well, because the local Docker database is built from
 * there. Both, or neither, in the same commit.
 *
 * ⚠️ RUN THIS ON NEON BEFORE DEPLOYING the code that reads the table. The importer skips the
 * table with a warning when it is missing; the pages (step 61) will not.
 *
 * The table starts empty. `npm run history:import-sleeper` fills it from the committed
 * `data/sleeper/*\/transactions-NN.json` files.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'

const useTest = process.argv.includes('--test')
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!url) throw new Error(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set.`)

const sql: NeonQueryFunction<false, false> = neon(url)

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nAdding season_transactions to "${dbName}"\n`)

  const totalsBefore = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`

  process.stdout.write('  create season_transactions … ')
  await sql.query(
    `CREATE TABLE IF NOT EXISTS season_transactions (
       season                  integer NOT NULL REFERENCES seasons(season),
       week                    integer NOT NULL,
       transaction_id          text NOT NULL,
       line                    integer NOT NULL,
       type                    text NOT NULL,
       status                  text NOT NULL,
       manager_id              integer NOT NULL REFERENCES managers(id),
       counterparty_manager_id integer REFERENCES managers(id),
       player_id_added         text,
       player_id_dropped       text,
       added_name              text,
       added_position          text,
       dropped_name            text,
       dropped_position        text,
       faab_bid                integer,
       faab_transferred        integer,
       note                    text,
       created_at              timestamptz NOT NULL,
       PRIMARY KEY (season, transaction_id, line)
     )`,
  )
  await sql.query(
    'CREATE INDEX IF NOT EXISTS season_transactions_manager_idx ON season_transactions (season, manager_id)',
  )
  await sql.query(
    'CREATE INDEX IF NOT EXISTS season_transactions_added_idx ON season_transactions (player_id_added)',
  )
  console.log('ok')

  const totalsAfter = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`
  if (JSON.stringify(totalsBefore) !== JSON.stringify(totalsAfter)) {
    console.error('\n✗ manager_totals changed. A transactions table must never touch a live budget.')
    process.exit(1)
  }

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM season_transactions`
  console.log(`\n✓ season_transactions ready — ${n} row${n === 1 ? '' : 's'}.`)
  console.log('  manager_totals unchanged.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
