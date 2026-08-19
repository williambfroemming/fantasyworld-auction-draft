/**
 * Seed the TEST database with a deterministic, synthetic pool.
 *
 * Deliberately not the real rankings file: tests should be reproducible on any
 * machine and shouldn't depend on a CSV sitting on someone's Desktop. The shape
 * is what matters — 10 managers, a ranked pool with every position represented,
 * enough players to run several rounds.
 */
import { neon } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { colorForSeat } from '../src/lib/colors'

const MANAGERS = [
  'Gabes', 'Grossman', 'Bolek', 'Bill', 'Daniel',
  'Nate', 'Mario', 'Jack', 'Bryan', 'Justin',
]

/**
 * Ranked 1..POOL_SIZE, positions cycled so every slot type is fillable.
 *
 * ⚠️ **Sized against what the integration tests actually consume, not by feel.**
 * `commish-service.itest.ts` builds its skip-run fixtures by reaching deep into
 * the pool — `OFFSET 200 LIMIT 48` in one test and `OFFSET 300 LIMIT 48` in
 * another, so it needs 348. A short pool hands those tests an empty array and
 * they die on `undefined.id`, which reads like a bug in `nominatorAt` rather
 * than a missing fixture.
 *
 * That went unnoticed because the shared Neon test database had accumulated rows
 * from earlier runs, so the suite passed there by accident. On a database created
 * from this script alone it did not. Keep the headroom, and move this number if a
 * test ever reaches further.
 */
const POOL_SIZE = 400

function pool() {
  const positions = ['WR', 'RB', 'WR', 'QB', 'RB', 'TE', 'WR', 'RB', 'DEF', 'K']
  return Array.from({ length: POOL_SIZE }, (_, i) => ({
    id: `test-${i + 1}`,
    name: `Test Player ${String(i + 1).padStart(3, '0')}`,
    team: ['BUF', 'KC', 'SF', 'DAL', 'PHI'][i % 5],
    position: positions[i % positions.length],
    searchRank: i + 1,
    posRank: Math.floor(i / positions.length) + 1,
    byeWeek: (i % 9) + 5,
  }))
}

async function main() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set. Run `npm run db:test-setup` first.')
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL equals DATABASE_URL — refusing to seed the live database.')
  }
  const sql = neon(url)

  await sql`INSERT INTO draft (id) VALUES (1) ON CONFLICT DO NOTHING`
  for (const [i, name] of MANAGERS.entries()) {
    await sql`
      INSERT INTO managers (name, display_name, color, draft_slot, is_commish)
      VALUES (${name}, ${name}, ${colorForSeat(i)}, ${i}, ${name === 'Bill'})
      ON CONFLICT (name) DO NOTHING`
  }

  const players = pool()
  for (let i = 0; i < players.length; i += 100) {
    const batch = players.slice(i, i + 100)
    await sql`
      INSERT INTO players (id, name, team, position, search_rank, pos_rank, bye_week, active)
      SELECT * FROM UNNEST(
        ${batch.map((p) => p.id)}::text[],
        ${batch.map((p) => p.name)}::text[],
        ${batch.map((p) => p.team)}::text[],
        ${batch.map((p) => p.position)}::text[],
        ${batch.map((p) => p.searchRank)}::int[],
        ${batch.map((p) => p.posRank)}::int[],
        ${batch.map((p) => p.byeWeek)}::int[],
        ${batch.map(() => true)}::boolean[]
      )
      ON CONFLICT (id) DO NOTHING`
  }

  const [{ m }] = await sql`SELECT count(*)::int AS m FROM managers`
  const [{ p }] = await sql`SELECT count(*)::int AS p FROM players`
  console.log(`✓ test database seeded: ${m} managers, ${p} players`)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
