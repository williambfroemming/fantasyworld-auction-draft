/**
 * Full JSON snapshot of the draft database.
 *
 *   npm run db:backup            # -> backups/<db>-<timestamp>.json
 *
 * This is insurance, not the archive. The archive is the `season` column and
 * lives in the database (docs/BACKLOG.md §2); this file is what you restore from
 * when the database itself is gone or somebody runs the wrong script against it.
 *
 * It dumps whole tables verbatim rather than a report, because a snapshot you
 * cannot reload is a report. `players` is included: a pick's player_id is
 * meaningless without the pool row it points at, and the pool is re-imported
 * every season.
 */
import { neon } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TABLES = [
  'managers',
  'players',
  'draft',
  'lots',
  'picks',
  'trades',
  'budget_adjustments',
] as const

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = neon(url)

  // Label the file with the database it came from, so a test-DB dump can never
  // be mistaken for the real draft.
  const [{ current_database: dbName }] = await sql`SELECT current_database()`

  const data: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    // `sql` is tagged-template-only in @neondatabase/serverless v1 — a plain
    // call throws. `sql.query` is the escape hatch for a dynamic identifier,
    // and the table names are a fixed literal list above, never user input.
    data[table] = await sql.query(`SELECT * FROM ${table}`)
    console.log(`  ${table.padEnd(20)} ${String(data[table].length).padStart(5)} rows`)
  }

  // The derived numbers too. They are recomputable by definition, but having
  // them in the file is how you'd notice a restore that silently came out wrong.
  const totals = await sql`
    SELECT m.name, t.budget, t.rostered, t.max_bid
    FROM manager_totals t JOIN managers m ON m.id = t.id ORDER BY m.draft_slot`

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = resolve(process.cwd(), 'backups')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `${dbName}-${stamp}.json`)

  writeFileSync(
    file,
    JSON.stringify({ takenAt: new Date().toISOString(), database: dbName, totals, ...data }, null, 2),
  )

  console.log(`\n✓ Snapshot written to backups/${dbName}-${stamp}.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
