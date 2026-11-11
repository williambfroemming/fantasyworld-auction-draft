/**
 * Migration: PIN lockout columns and the commissioner's settings switches.
 *
 *   npm run db:migrate-access              # against DATABASE_URL
 *   npm run db:migrate-access -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written and idempotent (AGENTS.md: `drizzle-kit push` cannot tell a new table
 * from a rename). Purely additive: two defaulted columns on `managers` and one new
 * table. Existing rows and old code are unaffected, which is why this can be run on the
 * live database BEFORE the code that reads it is deployed — and must be, since the new
 * sign-in reads the columns.
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
  console.log(`\nAdding PIN lockout and app settings to "${dbName}"\n`)

  await step('managers.pin_attempts', `ALTER TABLE managers ADD COLUMN IF NOT EXISTS pin_attempts integer NOT NULL DEFAULT 0`)
  await step('managers.pin_locked_until', `ALTER TABLE managers ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz`)
  await step(
    'create app_settings',
    `CREATE TABLE IF NOT EXISTS app_settings (
       key        text PRIMARY KEY,
       value      text NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now(),
       updated_by integer REFERENCES managers(id)
     )`,
  )

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM managers WHERE pin_attempts = 0`
  console.log(`\n✓ ready (${n} managers at zero failed attempts).\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
