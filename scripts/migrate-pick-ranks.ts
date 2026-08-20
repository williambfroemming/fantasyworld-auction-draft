/**
 * Migration: snapshot each pick's pool rank onto the pick itself.
 *
 *   npm run db:migrate-pick-ranks              # against DATABASE_URL
 *   npm run db:migrate-pick-ranks -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written and idempotent for the usual reason (AGENTS.md): `drizzle-kit
 * push` cannot tell a new table from a rename and blocks on an interactive
 * prompt.
 *
 * ## Why this is time-critical
 *
 * `picks` already snapshots name/team/position at award time, but not rank. So
 * a finished season's ranks are recoverable *only* by joining `players` — and
 * that join is valid only until the next season's rankings CSV is imported,
 * because the pool is replaced wholesale every year and `players.id` is not a
 * stable cross-season key. Once `npm run db:seed -- <2027 CSV>` runs, 2026's
 * ranks are gone for good.
 *
 * Run this while the current season's pool still matches the current season's
 * picks. Re-run it after every future draft, for the same reason.
 *
 * ## Scope
 *
 * The backfill targets `draft.season` rather than a hardcoded year. The correct
 * scope is "picks drafted against the pool currently loaded", which is exactly
 * what that column means — and it makes the script correct forever instead of
 * correct once. (Contrast scripts/migrate-seasons.ts, which hardcodes 2026
 * because it was recording a historical fact about rows that predated seasons.)
 *
 * Purely additive: two nullable columns and one guarded UPDATE. It does not
 * touch `manager_totals` — nothing here affects a budget, and a migration that
 * rebuilds a view from a frozen copy is precisely the trap AGENTS.md documents
 * about scripts/migrate-called-auction.ts.
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
  const [{ season }] = await sql`SELECT season FROM draft WHERE id = 1`
  const [{ n: picksBefore }] = await sql`SELECT count(*)::int AS n FROM picks`

  console.log(`\nSnapshotting pick ranks in "${dbName}" — current season ${season}\n`)

  await step(
    'add picks.player_rank / player_pos_rank',
    `ALTER TABLE picks
       ADD COLUMN IF NOT EXISTS player_rank     integer,
       ADD COLUMN IF NOT EXISTS player_pos_rank integer`,
  )

  // COALESCE, so a re-run can never overwrite a snapshot that is already
  // correct with whatever today's pool happens to say.
  await step(
    `backfill season ${season} from the current pool`,
    `UPDATE picks pk
        SET player_rank     = COALESCE(pk.player_rank, p.search_rank),
            player_pos_rank = COALESCE(pk.player_pos_rank, p.pos_rank)
       FROM players p
      WHERE p.id = pk.player_id
        AND pk.season = ${Number(season)}
        AND (pk.player_rank IS NULL OR pk.player_pos_rank IS NULL)`,
  )

  // --- report, deliberately without failing ---------------------------------
  // A missing rank is a degraded feature (one pick drops out of the value
  // view), not the unrecoverable loss that makes migrate-seasons.ts exit 1 on a
  // missing name. Seasons drafted before this column existed will legitimately
  // show 0 coverage forever and that must not block anything.
  console.log('')
  const coverage = await sql`
    SELECT season,
           count(*)::int                                          AS picks,
           count(player_rank)::int                                AS with_rank,
           (count(*) - count(player_rank))::int                   AS without_rank
    FROM picks GROUP BY season ORDER BY season`
  console.table(coverage)

  const gaps = await sql`
    SELECT pick_no, player_name, player_position
    FROM picks WHERE season = ${season} AND player_rank IS NULL
    ORDER BY pick_no LIMIT 20`
  if (gaps.length > 0) {
    console.log(`⚠ ${gaps.length} pick(s) in season ${season} have no rank to copy:`)
    console.table(gaps)
    console.log('  They will show as "not scored" rather than breaking anything.')
  }

  const [{ n: picksAfter }] = await sql`SELECT count(*)::int AS n FROM picks`
  if (picksAfter !== picksBefore) {
    console.error(`\n✗ Pick count changed (${picksBefore} → ${picksAfter}). That must never happen here.`)
    process.exit(1)
  }

  const current = coverage.find((c) => Number(c.season) === Number(season))
  console.log(
    `\n✓ Done. Season ${season}: ${current?.with_rank ?? 0}/${current?.picks ?? 0} picks carry a rank.\n`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
