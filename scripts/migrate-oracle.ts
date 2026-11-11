/**
 * Migration: the database boundary for "Ask the Oracle" (docs/ANALYTICS_ROADMAP.md §A,
 * step 38).
 *
 *   npm run db:migrate-oracle              # against DATABASE_URL
 *   npm run db:migrate-oracle -- --test    # against TEST_DATABASE_URL
 *
 * A language model writes SQL against this database, so what it can reach is decided
 * by Postgres and not by a prompt. This script builds the three things that decide it:
 *
 *   1. a NOLOGIN role, `oracle_reader`, with no rights on `public` at all;
 *   2. a schema, `oracle`, containing ONLY views, each listing its columns explicitly;
 *   3. an `oracle_log` table in `public` (the role cannot see it).
 *
 * Views run with their OWNER's privileges, which is why the role needs no grant on the
 * tables underneath — and why it can read `oracle.managers` while being refused
 * `public.managers.pin_hash`.
 *
 * Hand-written and idempotent (AGENTS.md: `drizzle-kit push` cannot tell a new table
 * from a rename). Safe to run twice.
 *
 * ⚠️ NEVER expose, by any view: player_queue, managers.pin_hash, page_visits, week_issues,
 * draft, lots, budget_adjustments, oracle_log. The first three are private by
 * non-negotiable (page_visits is commissioner-only activity tracking); the rest are
 * draft-room state or the Oracle's own log. To let the Oracle answer
 * something new, add a view HERE — never widen the role's grants, never hand it `public`.
 *
 * ⚠️ `npm run db:local:setup` drops and recreates `public`, which cascades away every
 * view below. Re-run this script after any local setup.
 *
 * ⚠️ No backticks inside the SQL strings. Every statement is a plain string rather than
 * a tagged template so a stray `${` cannot interpolate either.
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

interface OracleView {
  name: string
  /** The explicit column list, as written in the SELECT. Never `*`. */
  select: string
  from: string
  /** Becomes COMMENT ON VIEW. The model reads this; single quotes are escaped below. */
  comment: string
}

/**
 * Every view the Oracle can see. Column names were checked against src/db/schema.ts.
 * `src/lib/oracle-schema.ts` (step 40) carries a matching note for each, and a test
 * will keep the two in step.
 */
const VIEWS: OracleView[] = [
  {
    name: 'managers',
    from: 'public.managers',
    select: 'id AS manager_id, display_name AS name',
    comment: 'The ten league members. Nothing else from this table.',
  },
  {
    name: 'seasons',
    from: 'public.seasons',
    select: `season, data_tier, regular_season_weeks, playoff_week_start, playoff_teams,
      is_final, champion_manager_id, runner_up_manager_id, third_manager_id,
      champion_prize, runner_up_prize, third_prize, buy_in, side_bet, draft_city, draft_state`,
    comment: 'One row per league year. A null prize or side_bet is unknown, not zero.',
  },
  {
    name: 'standings',
    from: 'public.season_standings',
    select: `season, manager_id, place AS regular_season_place, wins, losses, ties,
      points_for, points_against, made_playoffs, playoff_wins, playoff_losses`,
    comment:
      'One row per manager per season, 2011 on. regular_season_place is NOT the playoff finish; the champion is in seasons.',
  },
  {
    name: 'games',
    from: 'public.season_matchups',
    select: `season, week, manager_id, opponent_manager_id, points, opponent_points,
      result, is_playoff, playoff_round, playoff_placement`,
    comment: 'Weekly results, 2020 on. Two rows per game, one from each side.',
  },
  {
    name: 'lineups',
    from: 'public.season_lineups',
    select: 'season, week, manager_id, actual_points, optimal_points',
    comment: 'Actual versus best-possible lineup points per manager per week, 2020 on.',
  },
  {
    name: 'player_weeks',
    from: 'public.player_weeks',
    select: `season, week, manager_id, player_id, player_name, position, nfl_team,
      is_starter, slot, points`,
    comment:
      'Every rostered player score per week, 2020 on. A row exists only for a week the player was on a roster in this league. player_id is the Sleeper id.',
  },
  {
    name: 'player_seasons',
    from: 'public.player_seasons',
    select: `season, player_id, player_name, position, nfl_team, weeks_played,
      total_points, avg_points`,
    comment: 'A player season totals, league-wide. player_id is the Sleeper id.',
  },
  {
    name: 'auction_picks',
    from: 'public.picks',
    select: `season, pick_no, player_name, player_team AS nfl_team,
      player_position AS position, player_sleeper_id AS player_id, price,
      manager_id AS owner_manager_id, nominator_id`,
    comment:
      'Auction results, 2021 on. owner_manager_id is the owner after draft-night trades; it differs from the buyer only for traded players. player_id may be null (unknown).',
  },
  {
    name: 'draft_trades',
    from: 'public.trades',
    select: 'season, manager_a_id, manager_b_id, picks_a_to_b, picks_b_to_a, cash_a_to_b, created_at',
    comment: 'Draft-night trades only.',
  },
  {
    name: 'transactions',
    from: 'public.season_transactions',
    select: `season, week, transaction_id, type, status, manager_id, counterparty_manager_id,
      player_id_added, player_id_dropped, added_name, added_position, dropped_name,
      dropped_position, faab_bid, faab_transferred, note, created_at`,
    comment:
      'Waiver claims (won and failed), free-agent moves, trades and FAAB inside trades, 2020 on. A failed claim bid was never spent.',
  },
  {
    name: 'legacy_champions',
    from: 'public.legacy_champions',
    select: 'season, champion_name, money_won',
    comment: 'Champions 2006 to 2010: a name and nothing else. Null money is unknown.',
  },
]

const q = (s: string) => s.replace(/'/g, "''")

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nBuilding the Oracle boundary in "${dbName}"\n`)

  await step(
    'create role oracle_reader (NOLOGIN)',
    `DO $$ BEGIN CREATE ROLE oracle_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  )
  // Needed so the connecting user can SET LOCAL ROLE oracle_reader.
  await step('grant the role to the connecting user', `GRANT oracle_reader TO CURRENT_USER`)
  await step('create schema oracle', `CREATE SCHEMA IF NOT EXISTS oracle`)

  for (const v of VIEWS) {
    if (/\*/.test(v.select)) throw new Error(`view ${v.name}: SELECT * is not allowed`)
    await step(
      `view oracle.${v.name}`,
      `CREATE OR REPLACE VIEW oracle.${v.name} AS SELECT ${v.select} FROM ${v.from}`,
    )
    await step(`comment oracle.${v.name}`, `COMMENT ON VIEW oracle.${v.name} IS '${q(v.comment)}'`)
  }

  await step('grant usage on schema oracle', `GRANT USAGE ON SCHEMA oracle TO oracle_reader`)
  await step('grant select on oracle views', `GRANT SELECT ON ALL TABLES IN SCHEMA oracle TO oracle_reader`)
  // Belt and braces: the role is never granted anything in public, and this makes a
  // stray grant from an earlier experiment disappear on the next run.
  await step('revoke everything on public', `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM oracle_reader`)

  await step(
    'create oracle_log',
    `CREATE TABLE IF NOT EXISTS oracle_log (
       id            serial PRIMARY KEY,
       manager_id    integer NOT NULL REFERENCES managers(id),
       question      text    NOT NULL,
       answer        text,
       steps         jsonb   NOT NULL DEFAULT '[]',
       ok            boolean NOT NULL,
       error         text,
       ms            integer,
       input_tokens  integer,
       output_tokens integer,
       created_at    timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await step(
    'index oracle_log by manager and time',
    `CREATE INDEX IF NOT EXISTS oracle_log_manager_idx ON oracle_log (manager_id, created_at)`,
  )

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema = 'oracle'`
  console.log(`\n✓ Oracle boundary ready (${n} views in oracle, role oracle_reader).\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
