/**
 * Migration: a stable cross-season player identity (docs/BACKLOG.md §2 and §1).
 *
 *   npm run db:migrate-identity              # against DATABASE_URL
 *   npm run db:migrate-identity -- --test    # against TEST_DATABASE_URL
 *   npm run db:migrate-identity -- --offline # add the columns, skip the backfill
 *
 * Hand-written and idempotent for the usual reason (AGENTS.md): structural
 * changes do not go through `drizzle-kit push`. Additive — two nullable columns
 * — and it rebuilds nothing, `manager_totals` least of all.
 *
 * ## Why there is a backfill here when there was none for lots.nomination_index
 *
 * That one was unrecoverable: a single moving cursor with no history, so any
 * value would have been a guess dressed as a fact. This one is different.
 * `picks` already snapshots name, team and position, which is exactly what
 * `resolveSleeperIds` matches on — so the 2026 draft can be resolved against
 * today's Sleeper pool by the *same* matcher the import will use, with the same
 * refusal to guess when a name is ambiguous. It is a derivation, not an
 * invention, and anything it declines to match stays null.
 *
 * ⚠️ It resolves against the Sleeper pool as it stands *now*. A player who has
 * since retired out of Sleeper's dictionary will not resolve, and that is the
 * honest answer rather than a reason to loosen the matcher.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { fetchPool, resolveSleeperIds, type PoolPlayer } from '../src/lib/sleeper'

const useTest = process.argv.includes('--test')
const offline = process.argv.includes('--offline')
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
  console.log(`\nAdding cross-season player identity to "${dbName}"\n`)

  await step('add players.sleeper_id', `ALTER TABLE players ADD COLUMN IF NOT EXISTS sleeper_id text`)
  await step(
    'add picks.player_sleeper_id',
    `ALTER TABLE picks ADD COLUMN IF NOT EXISTS player_sleeper_id text`,
  )
  await step(
    'index the cross-year lookup',
    `CREATE INDEX IF NOT EXISTS picks_sleeper_idx ON picks (player_sleeper_id)`,
  )

  if (offline) {
    console.log('\n--offline: columns added, backfill skipped.\n')
    return
  }

  console.log('\n  fetching the Sleeper pool (~5MB) … ')
  const sleeper = await fetchPool()
  console.log(`  ${sleeper.length} Sleeper players\n`)

  // ---- 1. the live pool ----------------------------------------------------
  const poolRows = await sql`SELECT id, name, team, position FROM players`
  const pool: PoolPlayer[] = poolRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    team: (r.team as string | null) ?? null,
    position: r.position as PoolPlayer['position'],
    searchRank: null,
    active: true,
  }))
  const poolIds = resolveSleeperIds(pool, sleeper)
  for (const [id, sleeperId] of poolIds) {
    await sql`UPDATE players SET sleeper_id = ${sleeperId} WHERE id = ${id}`
  }
  console.log(`  players:  ${poolIds.size} of ${pool.length} resolved`)

  // ---- 2. every pick, every season -----------------------------------------
  //
  // Matched from the pick's OWN snapshot columns, never by joining `players` —
  // the same rule the archive follows. A 2026 pick must resolve from what was
  // true that night, not from whoever holds that slug in the pool today.
  const pickRows = await sql`
    SELECT id, player_name, player_team, player_position, season FROM picks`
  const picks: PoolPlayer[] = pickRows.map((r) => ({
    id: String(r.id),
    name: r.player_name as string,
    team: (r.player_team as string | null) ?? null,
    position: r.player_position as PoolPlayer['position'],
    searchRank: null,
    active: true,
  }))
  const pickIds = resolveSleeperIds(picks, sleeper)
  for (const [pickId, sleeperId] of pickIds) {
    await sql`UPDATE picks SET player_sleeper_id = ${sleeperId} WHERE id = ${Number(pickId)}`
  }
  console.log(`  picks:    ${pickIds.size} of ${picks.length} resolved`)

  const unresolved = picks.filter((p) => !pickIds.has(p.id))
  if (unresolved.length > 0) {
    console.log(`\n  ${unresolved.length} pick(s) left unresolved — expected, not an error:`)
    for (const p of unresolved.slice(0, 20)) {
      console.log(`    ${p.name} (${p.position}, ${p.team ?? 'FA'})`)
    }
    if (unresolved.length > 20) console.log(`    … and ${unresolved.length - 20} more`)
    console.log(
      `\n  To pin any of these, add them to PLAYER_ID_OVERRIDES in\n` +
        `  src/lib/player-overrides.ts and re-run. Leaving them null is fine.`,
    )
  }

  console.log('\n✓ identity columns ready.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
