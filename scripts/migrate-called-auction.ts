/**
 * Migration: timed bidding -> called auction, plus trades.
 *
 *   npm run db:migrate-auction              # against DATABASE_URL
 *   npm run db:migrate-auction -- --test    # against TEST_DATABASE_URL
 *
 * Written by hand rather than left to `drizzle-kit push`, for two reasons:
 *
 *  1. push cannot tell a new table from a rename. It stops and asks whether
 *     `trades` is a renamed `bids` — and answering wrong silently keeps a dead
 *     table's data under a live table's name. There is no version of that
 *     question worth being asked at 6pm on draft day.
 *  2. This has to be safe on a draft that has ALREADY STARTED. Every statement
 *     is additive-then-backfill-then-drop and guarded by IF EXISTS / IF NOT
 *     EXISTS, so it is idempotent and re-runnable, and any lot already sold
 *     keeps its price and winner.
 *
 * It prints a before/after summary and refuses to leave the reserve invariant
 * broken. Run `npm run db:verify` afterwards.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'

const useTest = process.argv.includes('--test')
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!url) throw new Error(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set.`)

const sql: NeonQueryFunction<false, false> = neon(url)
const dbName = (() => {
  try {
    return new URL(url).pathname.slice(1)
  } catch {
    return '?'
  }
})()

async function step(label: string, statement: string) {
  process.stdout.write(`  ${label} … `)
  await sql.query(statement)
  console.log('ok')
}

async function main() {
  console.log(`\nMigrating "${dbName}"\n`)

  // ⚠️ This migration ends by rebuilding `manager_totals` from a copy of the
  // view frozen at the time it was written — one with NO season filter. Running
  // it after scripts/migrate-seasons.ts would silently replace the season-scoped
  // view with that old copy, and every manager's budget would then carry their
  // spend from every past draft. Nothing would error; ten managers would just
  // start the next season hundreds of dollars negative.
  //
  // It is finished work against a database shape that no longer exists, so it
  // refuses to run once seasons are in place rather than trying to stay current.
  const [seasoned] = await sql`
    SELECT 1 AS yes FROM information_schema.columns
    WHERE table_name = 'draft' AND column_name = 'season'`
  if (seasoned) {
    console.error(
      `✗ "${dbName}" already has seasons — this migration is superseded and would\n` +
        `  rebuild manager_totals without its season filter.\n` +
        `  Use: npm run db:migrate-seasons\n`,
    )
    process.exit(1)
  }

  const [before] = await sql`SELECT status, nomination_index FROM draft WHERE id = 1`
  const [{ n: picksBefore }] = await sql`SELECT count(*)::int AS n FROM picks`
  console.log(`Before: status "${before.status}", ${picksBefore} picks\n`)

  // --- new tables ----------------------------------------------------------
  await step(
    'create trades',
    `CREATE TABLE IF NOT EXISTS trades (
       id            serial PRIMARY KEY,
       manager_a_id  integer NOT NULL REFERENCES managers(id),
       manager_b_id  integer NOT NULL REFERENCES managers(id),
       picks_a_to_b  integer[] NOT NULL DEFAULT '{}',
       picks_b_to_a  integer[] NOT NULL DEFAULT '{}',
       cash_a_to_b   integer NOT NULL DEFAULT 0,
       created_by    integer NOT NULL REFERENCES managers(id),
       created_at    timestamptz NOT NULL DEFAULT now()
     )`,
  )

  await step(
    'create budget_adjustments',
    `CREATE TABLE IF NOT EXISTS budget_adjustments (
       id          serial PRIMARY KEY,
       manager_id  integer NOT NULL REFERENCES managers(id),
       amount      integer NOT NULL,
       reason      text NOT NULL,
       trade_id    integer,
       created_at  timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await step(
    'index budget_adjustments',
    `CREATE INDEX IF NOT EXISTS budget_adjustments_manager_idx
       ON budget_adjustments (manager_id)`,
  )

  // --- lots: the clock comes off, the result goes on ------------------------
  await step(
    'add lots.sold_price / lots.winner_id',
    `ALTER TABLE lots
       ADD COLUMN IF NOT EXISTS sold_price integer,
       ADD COLUMN IF NOT EXISTS winner_id  integer REFERENCES managers(id)`,
  )

  // Backfill from the old bidding columns so a lot already sold under the timed
  // rules keeps its price and winner. Guarded, so re-running is harmless.
  await step(
    'backfill sold lots from the old high_bid / high_bidder_id',
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'lots' AND column_name = 'high_bid') THEN
         UPDATE lots
            SET sold_price = COALESCE(sold_price, high_bid),
                winner_id  = COALESCE(winner_id, high_bidder_id)
          WHERE status = 'sold';
       END IF;
     END $$`,
  )

  await step(
    'drop the timed-bidding columns from lots',
    `ALTER TABLE lots
       DROP COLUMN IF EXISTS high_bid,
       DROP COLUMN IF EXISTS high_bidder_id,
       DROP COLUMN IF EXISTS ends_at,
       DROP COLUMN IF EXISTS paused_remaining_ms,
       DROP COLUMN IF EXISTS version`,
  )

  await step(
    'drop the timer settings from draft',
    `ALTER TABLE draft
       DROP COLUMN IF EXISTS timer_seconds,
       DROP COLUMN IF EXISTS soft_close_seconds`,
  )

  // --- the bid audit trail has nothing left to audit ------------------------
  await step('drop bids', `DROP TABLE IF EXISTS bids`)

  // --- the view must be re-applied last, since it now reads adjustments -----
  await step(
    'rebuild manager_totals',
    `CREATE OR REPLACE VIEW manager_totals AS
     SELECT
       m.id,
       t.budget,
       t.rostered,
       CASE
         WHEN t.rostered >= d.roster_size THEN 0
         ELSE t.budget - (d.roster_size - t.rostered - 1)
       END AS max_bid
     FROM managers m
     CROSS JOIN draft d
     CROSS JOIN LATERAL (
       SELECT
         (
           d.starting_budget
           - COALESCE((SELECT SUM(p.price) FROM picks p WHERE p.manager_id = m.id), 0)
           + COALESCE((SELECT SUM(a.amount) FROM budget_adjustments a WHERE a.manager_id = m.id), 0)
         )::int                                                          AS budget,
         (SELECT COUNT(*) FROM picks p WHERE p.manager_id = m.id)::int    AS rostered
     ) t
     WHERE d.id = 1`,
  )

  // --- prove nothing was broken -------------------------------------------
  console.log('')
  const [{ n: picksAfter }] = await sql`SELECT count(*)::int AS n FROM picks`
  const totals = await sql`
    SELECT m.name, t.budget, t.rostered, t.max_bid
    FROM manager_totals t JOIN managers m ON m.id = t.id
    ORDER BY m.draft_slot`
  const [{ roster_size }] = await sql`SELECT roster_size FROM draft WHERE id = 1`

  const stranded = totals.filter(
    (m) => Number(m.budget) < Number(roster_size) - Number(m.rostered),
  )
  const overMax = totals.filter((m) => Number(m.max_bid) > Number(m.budget))

  console.log(`After:  ${picksAfter} picks (was ${picksBefore}), ${totals.length} managers`)
  console.table(totals)

  if (picksAfter !== picksBefore) {
    console.error('\n✗ The pick count changed. That must never happen here.')
    process.exit(1)
  }
  if (stranded.length || overMax.length) {
    console.error('\n✗ Reserve invariant broken after migration:')
    for (const m of [...stranded, ...overMax]) console.error(`   ${m.name}: $${m.budget}, max $${m.max_bid}`)
    process.exit(1)
  }

  console.log('\n✓ Migration complete. Run `npm run db:verify` next.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
