/**
 * Migration: first-party activity tracking (docs/ACTIVITY_ROADMAP.md, step 63).
 *
 *   npm run db:migrate-activity              # against DATABASE_URL
 *   npm run db:migrate-activity -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written and idempotent for the usual reason (AGENTS.md): `drizzle-kit
 * push` cannot tell a new table from a rename and blocks on an interactive
 * prompt.
 *
 * Purely additive. One new table and its indexes; it touches nothing that exists
 * and does not rebuild `manager_totals`.
 *
 * ⚠️ `page_visits` is commissioner-only. It must never get a view in the
 * `oracle` schema (scripts/migrate-oracle.ts), and it never reaches `/api/state`.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'

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
  console.log(`\nAdding activity tracking to "${dbName}"\n`)

  await step(
    'create page_visits',
    `CREATE TABLE IF NOT EXISTS page_visits (
       id              serial PRIMARY KEY,
       manager_id      integer NOT NULL REFERENCES managers(id),
       path            text    NOT NULL,
       started_at      timestamptz NOT NULL,
       active_seconds  integer NOT NULL CHECK (active_seconds BETWEEN 1 AND 1800),
       created_at      timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await step(
    'index per manager over time (the abuse cap and the per-manager table)',
    `CREATE INDEX IF NOT EXISTS page_visits_manager_time_idx
       ON page_visits (manager_id, created_at)`,
  )
  await step(
    'index the date window',
    `CREATE INDEX IF NOT EXISTS page_visits_time_idx ON page_visits (created_at)`,
  )

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM page_visits`
  console.log(`\n✓ page_visits ready (${n} rows).\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
