/**
 * Migration: record the nomination index on each lot (docs/BACKLOG.md §9 P2).
 *
 *   npm run db:migrate-lot-index              # against DATABASE_URL
 *   npm run db:migrate-lot-index -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written and idempotent for the usual reason (AGENTS.md): structural
 * changes do not go through `drizzle-kit push`.
 *
 * Purely additive — one nullable column. It rebuilds nothing and, in
 * particular, does not touch `manager_totals`.
 *
 * ⚠️ Deliberately does NOT backfill. The index a 2026 lot was nominated at is
 * not recoverable after the fact: `draft.nomination_index` is a single moving
 * cursor with no history, and skipped seats mean pick order cannot be replayed
 * back onto it. A guessed backfill would be indistinguishable from a real one
 * and would send undo to a plausible wrong seat. NULL means "unknown", and
 * void/undo fall back to the old `- 1` behaviour for those rows.
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
  console.log(`\nAdding lots.nomination_index to "${dbName}"\n`)

  await step(
    'add lots.nomination_index',
    `ALTER TABLE lots ADD COLUMN IF NOT EXISTS nomination_index integer`,
  )

  const [{ total, known }] = await sql`
    SELECT count(*)::int AS total,
           count(nomination_index)::int AS known
    FROM lots`
  console.log(
    `\n✓ lots.nomination_index ready — ${known} of ${total} lots know their seat.` +
      `\n  The rest predate the column and fall back to the old "minus one" rewind.\n`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
