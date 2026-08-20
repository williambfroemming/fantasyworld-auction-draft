/**
 * Migration: one draft -> a season per year (docs/BACKLOG.md §2).
 *
 *   npm run db:migrate-seasons              # against DATABASE_URL
 *   npm run db:migrate-seasons -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written rather than left to `drizzle-kit push` for the reasons in
 * AGENTS.md: push cannot tell a new table from a rename and blocks on an
 * interactive prompt, which is fatal in a non-TTY. Every statement here is
 * additive-then-backfill and guarded by IF EXISTS / IF NOT EXISTS, so it is
 * idempotent and re-runnable.
 *
 * What it does:
 *   1. adds `season` to draft, picks, lots, trades, budget_adjustments
 *   2. backfills every existing row to BACKFILL_SEASON (2026)
 *   3. denormalizes name/team/position onto picks, so an archived season no
 *      longer renders through today's re-imported player pool
 *   4. replaces the global unique on picks.player_id with a per-season one —
 *      without this, every player drafted in 2026 is undraftable forever
 *   5. snapshots the current draft order into season_orders
 *   6. rebuilds manager_totals with the season filter
 *
 * It refuses to finish if the pick count changed or the reserve invariant
 * broke. Run `npm run db:verify` afterwards.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'

/**
 * The year every pre-migration row belongs to. This is the ONE place a literal
 * season is correct — the draft these rows came from is the 2026 draft, which
 * is a historical fact, not a setting. App code reads `draft.season`.
 */
const BACKFILL_SEASON = 2026

const useTest = process.argv.includes('--test')
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!url) throw new Error(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set.`)

const sql: NeonQueryFunction<false, false> = neon(url)

async function step(label: string, statement: string) {
  process.stdout.write(`  ${label} … `)
  await sql.query(statement)
  console.log('ok')
}

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nMigrating "${dbName}" to seasons\n`)

  const [{ n: picksBefore }] = await sql`SELECT count(*)::int AS n FROM picks`
  const [before] = await sql`SELECT status FROM draft WHERE id = 1`
  console.log(`Before: status "${before.status}", ${picksBefore} picks\n`)

  // --- 1 + 2. the season column, everywhere it belongs ----------------------
  // DEFAULT on the ALTER backfills existing rows in one pass, and NOT NULL is
  // safe immediately because of it.
  for (const table of ['draft', 'picks', 'lots', 'trades', 'budget_adjustments']) {
    await step(
      `add ${table}.season`,
      `ALTER TABLE ${table}
         ADD COLUMN IF NOT EXISTS season integer NOT NULL DEFAULT ${BACKFILL_SEASON}`,
    )
  }

  // --- 3. denormalize the player onto the pick ------------------------------
  await step(
    'add picks.player_name / player_team / player_position',
    `ALTER TABLE picks
       ADD COLUMN IF NOT EXISTS player_name     text,
       ADD COLUMN IF NOT EXISTS player_team     text,
       ADD COLUMN IF NOT EXISTS player_position text`,
  )
  await step(
    'backfill the player snapshot from the current pool',
    `UPDATE picks pk
        SET player_name     = COALESCE(pk.player_name, p.name),
            player_team     = COALESCE(pk.player_team, p.team),
            player_position = COALESCE(pk.player_position, p.position)
       FROM players p
      WHERE p.id = pk.player_id
        AND (pk.player_name IS NULL OR pk.player_position IS NULL)`,
  )

  // A pick whose player vanished from the pool cannot be backfilled by join.
  // Fail loudly rather than write a NOT NULL that can't hold: a nameless pick
  // in the archive is exactly the data loss this migration exists to prevent.
  const [{ n: unnamed }] = await sql`
    SELECT count(*)::int AS n FROM picks WHERE player_name IS NULL OR player_position IS NULL`
  if (Number(unnamed) > 0) {
    const orphans = await sql`
      SELECT id, pick_no, player_id FROM picks
      WHERE player_name IS NULL OR player_position IS NULL ORDER BY pick_no LIMIT 20`
    console.error(`\n✗ ${unnamed} pick(s) have no matching player row and cannot be backfilled:`)
    console.table(orphans)
    process.exit(1)
  }

  await step(
    'make the player snapshot NOT NULL',
    `ALTER TABLE picks
       ALTER COLUMN player_name     SET NOT NULL,
       ALTER COLUMN player_position SET NOT NULL`,
  )

  // --- 4. the unique index that would otherwise freeze the pool forever -----
  await step(
    'unique picks per (season, player), not per player',
    `CREATE UNIQUE INDEX IF NOT EXISTS picks_season_player_idx ON picks (season, player_id)`,
  )
  await step('drop the global unique on picks.player_id', `DROP INDEX IF EXISTS picks_player_idx`)

  // --- indexes for the season filters --------------------------------------
  await step('index picks.season', `CREATE INDEX IF NOT EXISTS picks_season_idx ON picks (season)`)
  await step('index lots.season', `CREATE INDEX IF NOT EXISTS lots_season_idx ON lots (season)`)
  await step(
    'index budget_adjustments.season',
    `CREATE INDEX IF NOT EXISTS budget_adjustments_season_idx ON budget_adjustments (season)`,
  )

  // --- 5. the draft order, preserved per season ----------------------------
  await step(
    'create season_orders',
    `CREATE TABLE IF NOT EXISTS season_orders (
       season       integer NOT NULL,
       manager_id   integer NOT NULL REFERENCES managers(id),
       draft_slot   integer NOT NULL,
       display_name text NOT NULL,
       color        text NOT NULL
     )`,
  )
  await step(
    'unique season_orders (season, manager)',
    `CREATE UNIQUE INDEX IF NOT EXISTS season_orders_pk ON season_orders (season, manager_id)`,
  )
  // Snapshot the seating as it stands. managers.draft_slot is overwritten at
  // every setup, so this is the last moment the 2026 order is recoverable.
  await step(
    'snapshot the current draft order',
    `INSERT INTO season_orders (season, manager_id, draft_slot, display_name, color)
     SELECT d.season, m.id, m.draft_slot, m.display_name, m.color
       FROM managers m CROSS JOIN draft d WHERE d.id = 1
     ON CONFLICT (season, manager_id) DO NOTHING`,
  )

  // --- 6. the view, now season-scoped --------------------------------------
  await step(
    'rebuild manager_totals with the season filter',
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
           - COALESCE((SELECT SUM(p.price) FROM picks p
                        WHERE p.manager_id = m.id AND p.season = d.season), 0)
           + COALESCE((SELECT SUM(a.amount) FROM budget_adjustments a
                        WHERE a.manager_id = m.id AND a.season = d.season), 0)
         )::int                                                          AS budget,
         (SELECT COUNT(*) FROM picks p
           WHERE p.manager_id = m.id AND p.season = d.season)::int        AS rostered
     ) t
     WHERE d.id = 1`,
  )

  // --- prove nothing was broken --------------------------------------------
  console.log('')
  const [{ n: picksAfter }] = await sql`SELECT count(*)::int AS n FROM picks`
  const [{ season }] = await sql`SELECT season FROM draft WHERE id = 1`
  const [{ roster_size }] = await sql`SELECT roster_size FROM draft WHERE id = 1`
  const totals = await sql`
    SELECT m.name, t.budget, t.rostered, t.max_bid
    FROM manager_totals t JOIN managers m ON m.id = t.id ORDER BY m.draft_slot`
  const bySeason = await sql`
    SELECT season, count(*)::int AS picks, sum(price)::int AS spent
    FROM picks GROUP BY season ORDER BY season`
  const order = await sql`
    SELECT season, count(*)::int AS seats FROM season_orders GROUP BY season ORDER BY season`

  console.log(`After:  season ${season}, ${picksAfter} picks (was ${picksBefore})`)
  console.table(bySeason)
  console.table(order)
  console.table(totals)

  if (picksAfter !== picksBefore) {
    console.error('\n✗ The pick count changed. That must never happen here.')
    process.exit(1)
  }
  const stranded = totals.filter((m) => Number(m.budget) < Number(roster_size) - Number(m.rostered))
  const overMax = totals.filter((m) => Number(m.max_bid) > Number(m.budget))
  if (stranded.length || overMax.length) {
    console.error('\n✗ Reserve invariant broken after migration:')
    for (const m of [...stranded, ...overMax]) {
      console.error(`   ${m.name}: $${m.budget}, max $${m.max_bid}`)
    }
    process.exit(1)
  }

  console.log('\n✓ Migration complete. Run `npm run db:verify` next.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
