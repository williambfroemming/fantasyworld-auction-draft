/**
 * Seed the draft: managers, settings, and the player pool.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/seed.ts <rankings.csv>
 *
 * Idempotent — safe to re-run. Re-running replaces the player pool but leaves
 * managers (and their PINs) and any picks alone, so it can be used to swap in
 * updated rankings without resetting the draft.
 */
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import { draft, managers, players } from '../src/db/schema'
import { colorForSeat } from '../src/lib/colors'
import { parseCsvPool } from '../src/lib/sleeper'
import { fetchPool } from '../src/lib/sleeper'

/**
 * The league, in the seating order drawn for 2025. Re-draw for 2026 in /setup —
 * the order is per-season data, not a constant.
 *
 * Display names come from the sheet's roster grid, which is what people actually
 * call each other (the order tab says "Grossman"; the grid says "Eric/Blakey").
 */
const LEAGUE = [
  { name: 'Gabes', displayName: 'Gabes' },
  { name: 'Grossman', displayName: 'Eric/Blakey' },
  { name: 'Bolek', displayName: 'Bolek' },
  { name: 'Bill', displayName: 'Bill' },
  { name: 'Daniel', displayName: 'Daniel' },
  { name: 'Nate', displayName: 'Nate' },
  { name: 'Mario', displayName: 'Mario' },
  { name: 'Jack', displayName: 'Jack' },
  { name: 'Bryan', displayName: 'Bryan' },
  { name: 'Justin', displayName: 'Justin' },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local`.')
  const db = drizzle(neon(url), { schema })

  // ---- draft settings (single row) ----------------------------------------
  await db
    .insert(draft)
    .values({ id: 1 })
    .onConflictDoNothing()
  console.log('✓ draft settings row')

  // ---- managers -----------------------------------------------------------
  // Insert only if missing, so re-seeding never wipes someone's PIN mid-week.
  for (const [i, m] of LEAGUE.entries()) {
    await db
      .insert(managers)
      .values({ ...m, draftSlot: i, color: colorForSeat(i), isCommish: m.name === 'Bill' })
      .onConflictDoNothing({ target: managers.name })
  }
  const mgrCount = await db.select({ n: sql<number>`count(*)::int` }).from(managers)
  console.log(`✓ managers: ${mgrCount[0].n}`)

  // ---- player pool --------------------------------------------------------
  const csvPath = process.argv[2]
  const pool = csvPath
    ? parseCsvPool(readFileSync(csvPath, 'utf8'))
    : (console.log('no CSV given, falling back to Sleeper…'), await fetchPool()).filter((p) => p.active)

  if (pool.length === 0) throw new Error('Player pool came back empty — refusing to seed.')

  // Replace the pool wholesale, but never orphan a player anything points at.
  //
  // `picks` spans EVERY season now, so this also protects players drafted years
  // ago: a 2026 pick must keep its `players` row, or a re-import would either
  // be blocked by the foreign key or strand the archive. (The archive renders
  // from the pick's own name/team/position snapshot, so it survives either way
  // — this keeps the referential side honest too.) `lots` is included for the
  // same reason: a voided lot references a player nobody ever drafted.
  await db.execute(sql`
    DELETE FROM players
    WHERE id NOT IN (SELECT player_id FROM picks)
      AND id NOT IN (SELECT player_id FROM lots)`)

  const BATCH = 200
  for (let i = 0; i < pool.length; i += BATCH) {
    await db
      .insert(players)
      .values(
        pool.slice(i, i + BATCH).map((p) => ({
          id: p.id,
          name: p.name,
          team: p.team,
          position: p.position,
          searchRank: p.searchRank,
          posRank: p.posRank ?? null,
          byeWeek: p.byeWeek ?? null,
          active: p.active,
        })),
      )
      .onConflictDoUpdate({
        target: players.id,
        set: {
          name: sql`excluded.name`,
          team: sql`excluded.team`,
          position: sql`excluded.position`,
          searchRank: sql`excluded.search_rank`,
          posRank: sql`excluded.pos_rank`,
          byeWeek: sql`excluded.bye_week`,
        },
      })
  }

  const byPos = await db.execute<{ position: string; n: number }>(
    sql`SELECT position, count(*)::int AS n FROM players GROUP BY position ORDER BY n DESC`,
  )
  console.log(`✓ players: ${pool.length}`)
  console.table(byPos.rows ?? byPos)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
