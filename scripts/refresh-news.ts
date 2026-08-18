/**
 * Refresh player availability from Sleeper (docs/BACKLOG.md §1).
 *
 *   npm run news:refresh              # against DATABASE_URL
 *   npm run news:refresh -- --test    # against TEST_DATABASE_URL
 *
 * Adds the columns if they are missing, then updates **only** the injury
 * picture on players that already exist. Idempotent and safe to run as often as
 * you like — the sensible cadence is once the week of the draft and again the
 * morning of.
 *
 * ## Why this is a script and not a request path
 *
 * Sleeper's dump is ~14MB and their docs ask that it be fetched at most once a
 * day. `PROJECT_PLAN.md` §9 already bans it from any request path, and §1
 * repeats the rule for news. Pulling it here means that on draft night the
 * answer to "is he hurt" is already sitting in Postgres and **no third party
 * can be down**.
 *
 * ## What it deliberately does NOT touch
 *
 * Ranks, names, teams, byes, `sleeper_id`, `active`. Those come from the
 * rankings CSV, which is the league's chosen source of truth for the board —
 * this must never quietly reorder the draft board on the morning of the draft
 * because Sleeper disagrees about who is better. It writes five columns and
 * nothing else.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { fetchPool, injurySeverity } from '../src/lib/sleeper'

const useTest = process.argv.includes('--test')
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!url) throw new Error(`${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set.`)

const sql: NeonQueryFunction<false, false> = neon(url)

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nRefreshing player availability in "${dbName}"\n`)

  for (const [col, type] of [
    ['injury_status', 'text'],
    ['injury_body_part', 'text'],
    ['injury_notes', 'text'],
    ['practice_participation', 'text'],
    ['injury_updated_at', 'timestamptz'],
  ] as const) {
    await sql.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS ${col} ${type}`)
  }
  console.log('  columns ready')

  console.log('  fetching the Sleeper pool (~14MB) …')
  const sleeper = await fetchPool()

  // Match on sleeper_id where §2 resolved one, and fall back to the row id for
  // a Sleeper-seeded pool where players.id already IS the Sleeper id. Nothing
  // matches by name here — that guesswork belongs in resolveSleeperIds, which
  // has the tiers and the tests.
  const byId = new Map(sleeper.map((p) => [p.id, p]))

  const rows = await sql`SELECT id, sleeper_id FROM players`
  let updated = 0
  let cleared = 0
  let unmatched = 0

  for (const r of rows) {
    const key = (r.sleeper_id as string | null) ?? (r.id as string)
    const p = byId.get(key)
    if (!p) {
      unmatched++
      continue
    }
    const inj = p.injury ?? null

    // Clearing matters as much as setting. A player who was Questionable on
    // Tuesday and is fine on Sunday must lose the badge, or the board slowly
    // fills with injuries that resolved weeks ago and nobody trusts it.
    await sql`
      UPDATE players
      SET injury_status          = ${inj?.status ?? null},
          injury_body_part       = ${inj?.bodyPart ?? null},
          injury_notes           = ${inj?.notes ?? null},
          practice_participation = ${inj?.practice ?? null},
          injury_updated_at      = now()
      WHERE id = ${r.id}`
    if (inj) updated++
    else cleared++
  }

  console.log(
    `\n  ${rows.length} players · ${updated} carrying an injury status · ` +
      `${cleared} clear · ${unmatched} with no Sleeper counterpart`,
  )

  // A CSV-seeded pool with no `sleeper_id` matches nothing, and the failure is
  // silent otherwise: every player simply reads as healthy, which is the exact
  // confident-wrong-answer this feature exists to avoid. Say so loudly.
  if (rows.length > 0 && unmatched === rows.length) {
    console.error(
      `\n  ✗ NOTHING matched. This pool has no cross-season ids, so there is\n` +
        `    nothing to join Sleeper on. Run:  npm run db:migrate-identity\n` +
        `    then re-run this. Every player currently reads as healthy, which\n` +
        `    is worse than showing nothing.\n`,
    )
    process.exit(1)
  }

  const worst = await sql`
    SELECT name, position, team, injury_status, injury_body_part
    FROM players
    WHERE injury_status IS NOT NULL AND search_rank IS NOT NULL
    ORDER BY search_rank LIMIT 12`
  if (worst.length > 0) {
    console.log('\n  Highest-ranked players carrying something:')
    console.table(
      worst.map((w) => ({
        player: w.name,
        pos: w.position,
        team: w.team,
        status: w.injury_status,
        detail: w.injury_body_part,
        sev: injurySeverity(String(w.injury_status)),
      })),
    )
  }
  console.log('')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
