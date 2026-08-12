/**
 * Sanity check against the live database.
 *
 * Run it after seeding, after a schema change, and once before draft night:
 *   npm run db:verify
 *
 * It asserts the things that would be catastrophic and silent if wrong —
 * chiefly that a fresh manager's max bid is exactly $185.
 */
import { neon } from '@neondatabase/serverless'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = neon(url)
  let failed = 0
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
    if (!ok) failed++
  }

  const settings = await sql`SELECT * FROM draft WHERE id = 1`
  check('draft settings row exists', settings.length === 1)
  const { starting_budget, roster_size, timer_seconds, soft_close_seconds } = settings[0] ?? {}
  check('budget is $200', starting_budget === 200, `got ${starting_budget}`)
  check('roster is 16 slots', roster_size === 16, `got ${roster_size}`)
  check('timer defaults', timer_seconds === 25 && soft_close_seconds === 10,
    `${timer_seconds}s / ${soft_close_seconds}s soft close`)

  const mgrs = await sql`
    SELECT m.name, t.budget, t.rostered, t.max_bid
    FROM manager_totals t JOIN managers m ON m.id = t.id
    ORDER BY m.draft_slot`
  check('10 managers seeded', mgrs.length === 10, `got ${mgrs.length}`)

  // The number the whole auction hangs on.
  const fresh = mgrs.filter((m) => Number(m.rostered) === 0)
  check(
    'a fresh manager has budget $200 and max bid $185',
    fresh.every((m) => Number(m.budget) === 200 && Number(m.max_bid) === 185),
    fresh.length ? `e.g. ${fresh[0].name}: $${fresh[0].budget} / max $${fresh[0].max_bid}` : 'none',
  )

  // Nobody may ever be able to bid more than they have.
  check(
    'max bid never exceeds budget',
    mgrs.every((m) => Number(m.max_bid) <= Number(m.budget)),
  )

  const [{ n: playerCount }] = await sql`SELECT count(*)::int AS n FROM players`
  check('player pool is seeded', Number(playerCount) > 100, `${playerCount} players`)

  const [{ n: defCount }] = await sql`SELECT count(*)::int AS n FROM players WHERE position = 'DEF'`
  check('team defenses present', Number(defCount) >= 28, `${defCount} defenses`)

  const [{ n: unranked }] =
    await sql`SELECT count(*)::int AS n FROM players WHERE search_rank IS NULL`
  check('every player has a board rank', Number(unranked) === 0, `${unranked} unranked`)

  console.log('\nBoard preview:')
  console.table(
    await sql`SELECT search_rank AS rk, tier, name, team, position AS pos, pos_rank, bye_week AS bye
              FROM players ORDER BY search_rank NULLS LAST LIMIT 8`,
  )
  console.log('First defenses on the board:')
  console.table(
    await sql`SELECT search_rank AS rk, name, team FROM players
              WHERE position = 'DEF' ORDER BY search_rank NULLS LAST LIMIT 3`,
  )

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
