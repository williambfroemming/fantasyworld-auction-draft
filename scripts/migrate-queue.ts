/**
 * Migration: the private player queue (docs/BACKLOG.md §4).
 *
 *   npm run db:migrate-queue              # against DATABASE_URL
 *   npm run db:migrate-queue -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written and idempotent for the usual reason (AGENTS.md): `drizzle-kit
 * push` cannot tell a new table from a rename and blocks on an interactive
 * prompt.
 *
 * Purely additive — one new table and its indexes. It touches nothing that
 * exists and does not rebuild `manager_totals`.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

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
  console.log(`\nAdding the player queue to "${dbName}"\n`)

  await step(
    'create player_queue',
    `CREATE TABLE IF NOT EXISTS player_queue (
       id          serial PRIMARY KEY,
       season      integer NOT NULL,
       manager_id  integer NOT NULL REFERENCES managers(id),
       player_id   text    NOT NULL REFERENCES players(id),
       sort_order  integer NOT NULL DEFAULT 0,
       created_at  timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await step(
    'one row per player per manager per season',
    `CREATE UNIQUE INDEX IF NOT EXISTS player_queue_unique
       ON player_queue (season, manager_id, player_id)`,
  )
  await step(
    'index the read path',
    `CREATE INDEX IF NOT EXISTS player_queue_manager_idx
       ON player_queue (season, manager_id)`,
  )

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM player_queue`
  console.log(`\n✓ player_queue ready (${n} rows).\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
