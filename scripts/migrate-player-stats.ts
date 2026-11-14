/**
 * Migration: `player_week_stats`, each rostered player's weekly NFL stat line
 * (docs/archive/PLAYER_STATS_ROADMAP.md, step 64).
 *
 *   npm run db:migrate-player-stats              # against DATABASE_URL
 *   npm run db:migrate-player-stats -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written and idempotent for the usual reason (AGENTS.md): `drizzle-kit
 * push` cannot tell a new table from a rename and blocks on an interactive
 * prompt. Then `npm run history:import-sleeper` (or `history:refresh`) fills it.
 *
 * Purely additive — one new table and its indexes. It touches nothing that
 * exists and does not rebuild `manager_totals`.
 *
 * The stat columns come from `STAT_KEYS` in `src/lib/player-stats.ts`, the same
 * list `src/db/schema.ts` builds from, so the two cannot disagree. A key added
 * there later is added here as a column by re-running this script.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { STAT_KEYS } from '../src/lib/player-stats'

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
  console.log(`\nAdding player_week_stats to "${dbName}"\n`)

  const statColumns = STAT_KEYS.map((k) => `       ${k} numeric(8,2)`).join(',\n')
  await step(
    'create player_week_stats',
    `CREATE TABLE IF NOT EXISTS player_week_stats (
       season     integer NOT NULL REFERENCES seasons(season),
       week       integer NOT NULL,
       player_id  text    NOT NULL,
       gp         integer,
${statColumns},
       PRIMARY KEY (season, week, player_id)
     )`,
  )
  // A whitelist key added after the table exists becomes a column on re-run.
  for (const k of STAT_KEYS) {
    await sql.query(`ALTER TABLE player_week_stats ADD COLUMN IF NOT EXISTS ${k} numeric(8,2)`)
  }
  await step(
    'index by player',
    'CREATE INDEX IF NOT EXISTS player_week_stats_player_idx ON player_week_stats (player_id)',
  )
  await step(
    'index by season',
    'CREATE INDEX IF NOT EXISTS player_week_stats_season_idx ON player_week_stats (season)',
  )

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM player_week_stats`
  console.log(`\n✓ player_week_stats ready (${n} rows). Fill it with npm run history:import-sleeper.\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
