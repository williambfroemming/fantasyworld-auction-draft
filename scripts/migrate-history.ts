/**
 * Migration: the league-history tables (docs/PROJECT_PLAN.md §12).
 *
 *   npm run db:migrate-history              # against DATABASE_URL
 *   npm run db:migrate-history -- --test    # against TEST_DATABASE_URL
 *
 * Hand-written rather than left to `drizzle-kit push` for the reason in
 * AGENTS.md: push cannot tell a new table from a rename, so it stops to ask
 * interactively and fails outright in a non-TTY. Every statement here is
 * `IF NOT EXISTS`, so it is idempotent and re-runnable.
 *
 * DDL only. It creates seven tables and seeds exactly one row — the `seasons`
 * entry for the current draft — and imports no history at all. That split is
 * deliberate: this has to run against `neondb_test`, which has none of the
 * committed source files, so schema and data cannot share a script.
 *
 * ## What it must not touch
 *
 * `manager_totals`. That view is `CROSS JOIN draft` filtered to `d.season`, so
 * history can never reach a live budget — and a migration that re-emits a view
 * definition becomes a loaded gun the moment the view changes
 * (`scripts/migrate-called-auction.ts` is the cautionary tale). This script
 * snapshots the view before and after and refuses to finish if a single number
 * moved.
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

const TABLES: Array<[string, string]> = [
  [
    'seasons',
    `CREATE TABLE IF NOT EXISTS seasons (
       season               integer PRIMARY KEY,
       data_tier            text    NOT NULL,
       sleeper_league_id    text,
       roster_size          integer,
       starting_budget      integer,
       regular_season_weeks integer,
       playoff_week_start   integer,
       playoff_teams        integer,
       is_final             boolean NOT NULL DEFAULT false,
       draft_city           text,
       draft_state          text,
       draft_country        text,
       champion_manager_id  integer REFERENCES managers(id),
       runner_up_manager_id integer REFERENCES managers(id),
       third_manager_id     integer REFERENCES managers(id),
       champion_prize       integer,
       runner_up_prize      integer,
       third_prize          integer,
       notes                text[]  NOT NULL DEFAULT '{}',
       CONSTRAINT seasons_data_tier_check
         CHECK (data_tier IN ('legacy', 'standings', 'weekly'))
     )`,
  ],
  [
    'season_standings',
    `CREATE TABLE IF NOT EXISTS season_standings (
       season         integer NOT NULL REFERENCES seasons(season),
       manager_id     integer NOT NULL REFERENCES managers(id),
       place          integer,
       wins           integer NOT NULL,
       losses         integer NOT NULL,
       ties           integer NOT NULL DEFAULT 0,
       points_for     numeric(8,2),
       points_against numeric(8,2),
       made_playoffs  boolean NOT NULL DEFAULT false,
       playoff_wins   integer,
       playoff_losses integer,
       PRIMARY KEY (season, manager_id)
     )`,
  ],
  [
    'season_matchups',
    `CREATE TABLE IF NOT EXISTS season_matchups (
       season              integer NOT NULL REFERENCES seasons(season),
       week                integer NOT NULL,
       manager_id          integer NOT NULL REFERENCES managers(id),
       matchup_id          integer,
       points              numeric(8,2) NOT NULL,
       opponent_manager_id integer NOT NULL REFERENCES managers(id),
       opponent_points     numeric(8,2) NOT NULL,
       is_playoff          boolean NOT NULL DEFAULT false,
       playoff_round       integer,
       result              text NOT NULL,
       PRIMARY KEY (season, week, manager_id),
       CONSTRAINT season_matchups_result_check CHECK (result IN ('W', 'L', 'T'))
     )`,
  ],
  [
    'season_lineups',
    `CREATE TABLE IF NOT EXISTS season_lineups (
       season         integer NOT NULL REFERENCES seasons(season),
       week           integer NOT NULL,
       manager_id     integer NOT NULL REFERENCES managers(id),
       actual_points  numeric(8,2) NOT NULL,
       optimal_points numeric(8,2) NOT NULL,
       PRIMARY KEY (season, week, manager_id)
     )`,
  ],
  [
    'player_weeks',
    `CREATE TABLE IF NOT EXISTS player_weeks (
       season      integer NOT NULL REFERENCES seasons(season),
       week        integer NOT NULL,
       manager_id  integer NOT NULL REFERENCES managers(id),
       player_id   text    NOT NULL,
       player_name text,
       position    text,
       nfl_team    text,
       is_starter  boolean NOT NULL DEFAULT false,
       slot        text,
       points      numeric(8,2) NOT NULL,
       PRIMARY KEY (season, week, manager_id, player_id)
     )`,
  ],
  [
    'player_seasons',
    `CREATE TABLE IF NOT EXISTS player_seasons (
       season       integer NOT NULL REFERENCES seasons(season),
       player_id    text    NOT NULL,
       player_name  text    NOT NULL,
       position     text,
       nfl_team     text,
       weeks_played integer,
       total_points numeric(8,2),
       avg_points   numeric(6,2),
       PRIMARY KEY (season, player_id)
     )`,
  ],
  [
    'legacy_champions',
    `CREATE TABLE IF NOT EXISTS legacy_champions (
       season        integer PRIMARY KEY,
       champion_name text NOT NULL,
       money_won     integer
     )`,
  ],
]

const INDEXES: Array<[string, string]> = [
  [
    'season_standings_manager_idx',
    'CREATE INDEX IF NOT EXISTS season_standings_manager_idx ON season_standings (manager_id)',
  ],
  [
    'season_matchups_manager_idx',
    'CREATE INDEX IF NOT EXISTS season_matchups_manager_idx ON season_matchups (manager_id)',
  ],
  [
    'season_matchups_season_idx',
    'CREATE INDEX IF NOT EXISTS season_matchups_season_idx ON season_matchups (season)',
  ],
  [
    'player_weeks_player_idx',
    'CREATE INDEX IF NOT EXISTS player_weeks_player_idx ON player_weeks (player_id)',
  ],
  [
    'player_weeks_season_idx',
    'CREATE INDEX IF NOT EXISTS player_weeks_season_idx ON player_weeks (season)',
  ],
  [
    'player_seasons_name_idx',
    'CREATE INDEX IF NOT EXISTS player_seasons_name_idx ON player_seasons (player_name)',
  ],
]

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nAdding the league-history tables to "${dbName}"\n`)

  // The one thing that must not move. Captured before any DDL runs.
  const totalsBefore = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`

  for (const [name, ddl] of TABLES) await step(`create ${name}`, ddl)
  console.log('')
  // Additive column, added after the table shipped: which finishing place a
  // playoff game decided. Null is the championship path; 3 and 5 are the
  // placement games. See the schema comment.
  await step(
    'add season_matchups.playoff_placement',
    'ALTER TABLE season_matchups ADD COLUMN IF NOT EXISTS playoff_placement integer',
  )

  // The weekly high/low side bet was modelled as money and then cut: the count
  // of high and low weeks is the interesting number and cannot be wrong, while a
  // per-season payout rate is mostly not on record. Dropped rather than left
  // dangling, so nothing half-wired survives.
  await step(
    'drop the side-bet payout columns',
    `ALTER TABLE seasons DROP COLUMN IF EXISTS high_score_payout,
                         DROP COLUMN IF EXISTS low_score_penalty`,
  )

  console.log('')
  for (const [name, ddl] of INDEXES) await step(`index  ${name}`, ddl)

  // --- seed the current season so getArchivedSeason has a row to read -------
  // Everything else is imported from committed source files, but the season
  // being drafted is described by `draft` and by nothing else. Without this row
  // the archive has no settings for the live year the moment it starts
  // preferring `seasons` over `draft`.
  console.log('')
  await step(
    'seed the current season from draft',
    `INSERT INTO seasons (season, data_tier, roster_size, starting_budget, is_final)
     SELECT d.season, 'weekly', d.roster_size, d.starting_budget, d.status = 'done'
       FROM draft d WHERE d.id = 1
     ON CONFLICT (season) DO UPDATE
       SET roster_size     = COALESCE(seasons.roster_size, excluded.roster_size),
           starting_budget = COALESCE(seasons.starting_budget, excluded.starting_budget)`,
  )

  // --- prove nothing that matters moved ------------------------------------
  console.log('')
  const totalsAfter = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`
  if (JSON.stringify(totalsBefore) !== JSON.stringify(totalsAfter)) {
    console.error('\n✗ manager_totals changed. History must never touch a live budget.')
    console.table(totalsBefore)
    console.table(totalsAfter)
    process.exit(1)
  }

  const rows = await sql`
    SELECT c.relname AS table, COALESCE(s.n_live_tup, 0)::int AS rows
      FROM pg_class c
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE c.relname IN ('seasons','season_standings','season_matchups','season_lineups',
                         'player_weeks','player_seasons','legacy_champions')
       AND c.relkind = 'r'
     ORDER BY c.relname`
  console.table(rows)

  if (rows.length !== TABLES.length) {
    console.error(`\n✗ expected ${TABLES.length} history tables, found ${rows.length}`)
    process.exit(1)
  }

  const [{ season }] = await sql`SELECT season FROM seasons ORDER BY season DESC LIMIT 1`
  console.log(`✓ history schema in place; current season ${season} seeded.`)
  console.log('  manager_totals unchanged. Run `npm run db:verify` next.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
