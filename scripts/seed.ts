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
  { name: 'Gabes', displayName: 'Gabes', color: '#7c2d12' },
  { name: 'Grossman', displayName: 'Eric/Blakey', color: '#8b7fb8' },
  { name: 'Bolek', displayName: 'Bolek', color: '#22c55e' },
  { name: 'Bill', displayName: 'Bill', color: '#dc2626' },
  { name: 'Daniel', displayName: 'Daniel', color: '#86b880' },
  { name: 'Nate', displayName: 'Nate', color: '#c9a0b4' },
  { name: 'Mario', displayName: 'Mario', color: '#1d4ed8' },
  { name: 'Jack', displayName: 'Jack', color: '#c2703d' },
  { name: 'Bryan', displayName: 'Bryan', color: '#ea9a4e' },
  { name: 'Justin', displayName: 'Justin', color: '#e879f9' },
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
      .values({ ...m, draftSlot: i, isCommish: m.name === 'Bill' })
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

  // Replace the pool wholesale, but never orphan a player that's already been
  // drafted: picks reference players, so drop only what nothing points at.
  await db.execute(sql`DELETE FROM players WHERE id NOT IN (SELECT player_id FROM picks)`)

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
          tier: p.tier ?? null,
          byeWeek: p.byeWeek ?? null,
          auctionValue: p.auctionValue ?? null,
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
          tier: sql`excluded.tier`,
          byeWeek: sql`excluded.bye_week`,
          auctionValue: sql`excluded.auction_value`,
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
