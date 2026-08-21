/**
 * Migration: `week_issues`, the table behind The FantasyWorld Gazette.
 *
 *   npm run db:migrate-gazette              # against DATABASE_URL
 *   npm run db:migrate-gazette -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written rather than left to `drizzle-kit push`, for the reason in
 * AGENTS.md: push cannot tell a new table from a rename, so it stops to ask
 * interactively and fails outright in a non-TTY — and it silently drops the
 * `manager_totals` view on its way past. Every statement here is
 * `IF NOT EXISTS`, so it is idempotent and re-runnable.
 *
 * The same table is also declared in `src/db/schema.ts`, because the local
 * Docker database is built from `schema.ts` by `scripts/local/bootstrap.ts`
 * while Neon is built by this script. `migrate-history.ts` records what happens
 * when only one of the two is updated: the `seasons.draft_recap` columns existed
 * locally and were missing from every real deployment for a release. Both, or
 * neither, in the same commit.
 *
 * ## What it must not touch
 *
 * `manager_totals`. The Gazette is a read-only consumer of history and can never
 * reach a live budget; this script snapshots the view before and after and
 * refuses to finish if a single number moved. Same guard as `migrate-history.ts`,
 * for the same reason.
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
  console.log(`\nAdding week_issues to "${dbName}"\n`)

  // The one thing that must not move. Captured before any DDL runs.
  const totalsBefore = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`

  await step(
    'create week_issues',
    `CREATE TABLE IF NOT EXISTS week_issues (
       season         integer     NOT NULL REFERENCES seasons(season),
       week           integer     NOT NULL,
       headline       text        NOT NULL,
       deck           text        NOT NULL,
       column_text    text        NOT NULL,
       game_notes     jsonb       NOT NULL DEFAULT '[]'::jsonb,
       threads        jsonb       NOT NULL DEFAULT '[]'::jsonb,
       facts          jsonb       NOT NULL,
       model          text        NOT NULL,
       prompt_version integer     NOT NULL,
       generated_at   timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (season, week)
     )`,
  )

  // The weekly side bet: the low scorer pays the high scorer this much.
  //
  // Nullable, and null means UNKNOWN rather than "no bet". The league has run it
  // at $10 for the last couple of seasons and did not before that, so a column
  // defaulting to 0 would quietly assert that 2020 had a side bet worth nothing.
  // Set it per season with `npm run season:info -- 2025 --side-bet 10`; The
  // Ledger prints counts always and dollars only for the years that have a rate.
  await step(
    'add seasons.side_bet',
    `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS side_bet integer`,
  )

  // The named title of the edition, shown in the masthead beside the week.
  // Separate from the headline: the headline reports the week, the title names
  // the issue, the way a magazine names a piece.
  await step(
    'add week_issues.issue_title',
    `ALTER TABLE week_issues ADD COLUMN IF NOT EXISTS issue_title text`,
  )

  // The lens Gordon actually used. The calendar suggests one; the week's events
  // may call for another, and which he chose is part of what the issue IS.
  await step(
    'add week_issues.lens',
    `ALTER TABLE week_issues ADD COLUMN IF NOT EXISTS lens text`,
  )

  // --- prove nothing that matters moved ------------------------------------
  console.log('')
  const totalsAfter = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`
  if (JSON.stringify(totalsBefore) !== JSON.stringify(totalsAfter)) {
    console.error('\n✗ manager_totals changed. The Gazette must never touch a live budget.')
    console.table(totalsBefore)
    console.table(totalsAfter)
    process.exit(1)
  }

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM week_issues`
  console.log(`✓ week_issues ready — ${n} issue${n === 1 ? '' : 's'} on record.`)
  console.log('  manager_totals unchanged.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
