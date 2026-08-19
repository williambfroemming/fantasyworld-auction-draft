/**
 * Import the 2021–2024 auction drafts into `picks`.
 *
 *   npm run history:picks
 *   npm run history:picks -- --dry-run
 *
 * The payoff step: once these land, `/board`'s year picker, all five `/stats`
 * panels and `/api/export` work on those seasons with no new view code, because
 * they were already season-agnostic.
 *
 * It is also the riskiest step in Phase 2 — the only one that writes to a table
 * the draft itself uses — so it is the most heavily asserted. **Everything is
 * resolved in memory before a single row is written**, and the run ends by
 * proving `manager_totals` did not move.
 *
 * ## Prices come from the workbook and nowhere else
 *
 * Sleeper has these drafts, and its auction amounts are a formality: 2022, 2023
 * and 2025 each record 160 picks totalling exactly $160 — every pick $1 — because
 * the room drafted on a Google Sheet and results were entered afterwards purely
 * to set rosters. What Sleeper *is* authoritative about is **which players** each
 * manager took, and that cross-check is what found the two corrections below.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { managerIdForName } from '../src/lib/history-identity'
import { normalizePosition, normalizeTeam, playerMatchKey } from '../src/lib/sleeper'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set.')
const sql: NeonQueryFunction<false, false> = neon(url)

const ROOT = process.cwd()
const SEASONS = [2021, 2022, 2023, 2024] as const

/**
 * Every departure from the source, in one reviewable list.
 *
 * Both entries were found by diffing the workbook against Sleeper's record of
 * which players each manager actually drafted. Nothing here is a guess about a
 * price except Boyd's, and that one is arithmetic rather than judgement.
 */
const CORRECTIONS = [
  {
    season: 2022,
    action: 'drop' as const,
    pickNo: 160,
    player: 'george pickens',
    reason:
      'Duplicate of pick 138 ("George Pickens", $1, same manager) under a lower-cased spelling. ' +
      "Sleeper's 2022 draft contains Pickens exactly once. Dropping it puts Nate at 16 players / $200.",
    dated: '2026-08-18',
  },
  {
    season: 2022,
    action: 'add' as const,
    pickNo: 160,
    player: 'Tyler Boyd',
    manager: 'Bill',
    price: 1,
    reason:
      "Bill's 16th pick is missing from the workbook. Sleeper has 16 picks for every 2022 roster, " +
      'and diffing them leaves exactly one player unaccounted for. The price is not recorded: $199 ' +
      'across the other 15, a $200 budget and a $1 minimum leave no other value. The pick NUMBER is ' +
      'a placeholder — the slot freed by the duplicate above — not a recorded draft position.',
    dated: '2026-08-18',
  },
]

// ---------------------------------------------------------------------------

function csv(path: string): Array<Record<string, string>> {
  const full = join(ROOT, path)
  if (!existsSync(full)) throw new Error(`missing ${full}`)
  const lines = readFileSync(full, 'utf8').trim().split('\n')
  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]))
  })
}

interface SourcePick {
  season: number
  pickNo: number
  nominatorId: number
  managerId: number
  price: number
  name: string
  position: string
  /** Sleeper id, resolved before any write. */
  playerId: string
  team: string | null
}

/** Sleeper id lookup, keyed by season and normalised name+position. */
function playerIndex() {
  const byKey = new Map<string, { id: string; team: string | null; position: string }>()
  const byName = new Map<string, Array<{ id: string; team: string | null; position: string }>>()
  const latest = new Map<string, { name: string; team: string | null; position: string; season: number }>()

  for (const r of csv('data/history/player_total_points.csv')) {
    const season = Number(r.year)
    const position = normalizePosition(r.position || 'UNKNOWN').position
    const team = normalizeTeam(r.nfl_team)
    const entry = { id: r.player_id, team, position }
    byKey.set(`${season}:${playerMatchKey(r.player_name, position)}`, entry)
    const nameKey = `${season}:${r.player_name.toLowerCase()}`
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), entry])

    const seen = latest.get(r.player_id)
    if (!seen || season > seen.season) {
      latest.set(r.player_id, { name: r.player_name, team, position, season })
    }
  }
  return { byKey, byName, latest }
}

/** Which players Sleeper says each manager drafted, per season. */
function sleeperRosters(season: number): Map<number, Set<string>> {
  const dir = join(ROOT, 'data', 'sleeper', String(season))
  const out = new Map<number, Set<string>>()
  if (!existsSync(join(dir, 'draft_picks.json'))) return out

  const users = new Map<string, string>(
    (JSON.parse(readFileSync(join(dir, 'users.json'), 'utf8')) as Array<{ user_id: string }>).map(
      (u) => [u.user_id, u.user_id],
    ),
  )
  const rosters = JSON.parse(readFileSync(join(dir, 'rosters.json'), 'utf8')) as Array<{
    roster_id: number
    owner_id: string
  }>
  const ownerOf = new Map(rosters.map((r) => [r.roster_id, r.owner_id]))
  const picks = JSON.parse(readFileSync(join(dir, 'draft_picks.json'), 'utf8')) as Array<{
    roster_id: number
    player_id: string
  }>
  for (const p of picks) {
    const owner = ownerOf.get(p.roster_id)
    if (!owner || !users.has(owner)) continue
    // Resolved lazily by the caller, which owns the identity map.
    const set = out.get(p.roster_id) ?? new Set<string>()
    set.add(p.player_id)
    out.set(p.roster_id, set)
  }
  return out
}

// ---------------------------------------------------------------------------

async function main() {
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nImporting the 2021–2024 auctions into "${dbName}"${dryRun ? ' (dry run)' : ''}\n`)

  const [{ season: liveSeason }] = await sql`SELECT season FROM draft WHERE id = 1`
  const totalsBefore = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`

  const rows = csv('data/history/auction_drafts.csv').filter((r) =>
    (SEASONS as readonly number[]).includes(Number(r.year)),
  )
  const index = playerIndex()

  // --- 1. the duplicate gate, before anything else -------------------------
  // `ON CONFLICT (season, player_id) DO UPDATE` would swallow a duplicate
  // silently and leave the season merely short, with no indication why.
  const drops = new Set(
    CORRECTIONS.filter((c) => c.action === 'drop').map((c) => `${c.season}:${c.pickNo}`),
  )
  const seen = new Map<string, string>()
  const duplicates: string[] = []
  for (const r of rows) {
    const season = Number(r.year)
    if (drops.has(`${season}:${Number(r.pick)}`)) continue
    const position = normalizePosition(r.position || 'DEF').position
    const key = `${season}:${playerMatchKey(r.player, position)}`
    if (seen.has(key)) duplicates.push(`${season} pick ${r.pick} "${r.player}" — also ${seen.get(key)}`)
    seen.set(key, `pick ${r.pick}`)
  }
  if (duplicates.length) {
    console.error('\n✗ Duplicate players in the source, not covered by a correction:')
    for (const d of duplicates) console.error(`   ${d}`)
    process.exit(1)
  }
  console.log(`  ✓ no unhandled duplicates (${CORRECTIONS.length} corrections applied)`)

  // --- 2. resolve every pick to a Sleeper id -------------------------------
  const picks: SourcePick[] = []
  const unresolved: string[] = []

  const resolve = (season: number, name: string, position: string) => {
    const exact = index.byKey.get(`${season}:${playerMatchKey(name, position)}`)
    if (exact) return exact
    // A blank position in the source (2022's defenses) — accept a name match
    // only when it is unambiguous.
    const byName = index.byName.get(`${season}:${name.toLowerCase()}`) ?? []
    return byName.length === 1 ? byName[0] : null
  }

  for (const r of rows) {
    const season = Number(r.year)
    const pickNo = Number(r.pick)
    if (drops.has(`${season}:${pickNo}`)) continue
    const position = normalizePosition(r.position || 'DEF').position
    const found = resolve(season, r.player, position)
    if (!found) {
      unresolved.push(`${season} pick ${pickNo} "${r.player}" (${r.position || 'no position'})`)
      continue
    }
    picks.push({
      season,
      pickNo,
      nominatorId: managerIdForName(r.nominator),
      managerId: managerIdForName(r.drafted_by),
      price: Number(r.price),
      name: r.player,
      position: found.position === 'UNKNOWN' ? position : found.position,
      playerId: found.id,
      team: found.team,
    })
  }

  for (const c of CORRECTIONS) {
    if (c.action !== 'add') continue
    const found = resolve(c.season, c.player, 'WR') ?? index.byName.get(`${c.season}:${c.player.toLowerCase()}`)?.[0]
    if (!found) {
      console.error(`\n✗ Correction cannot resolve ${c.player} in ${c.season}`)
      process.exit(1)
    }
    picks.push({
      season: c.season,
      pickNo: c.pickNo,
      nominatorId: managerIdForName(c.manager),
      managerId: managerIdForName(c.manager),
      price: c.price,
      name: c.player,
      position: found.position,
      playerId: found.id,
      team: found.team,
    })
  }

  if (unresolved.length) {
    console.error(`\n✗ ${unresolved.length} picks could not be resolved to a Sleeper id:`)
    for (const u of unresolved.slice(0, 20)) console.error(`   ${u}`)
    process.exit(1)
  }
  console.log(`  ✓ ${picks.length} picks resolved to a Sleeper id, 0 unresolved`)

  // --- 3. cross-check the rosters against Sleeper --------------------------
  const mismatches: string[] = []
  for (const season of SEASONS) {
    const sleeper = sleeperRosters(season)
    if (sleeper.size === 0) {
      console.log(`  · ${season} has no Sleeper draft to check against`)
      continue
    }
    const dir = join(ROOT, 'data', 'sleeper', String(season))
    const rosters = JSON.parse(readFileSync(join(dir, 'rosters.json'), 'utf8')) as Array<{
      roster_id: number
      owner_id: string
    }>
    const { managerIdForSleeperOwner } = await import('../src/lib/history-identity')
    for (const r of rosters) {
      const managerId = managerIdForSleeperOwner(r.owner_id)
      const theirs = sleeper.get(r.roster_id) ?? new Set<string>()
      const ours = new Set(picks.filter((p) => p.season === season && p.managerId === managerId).map((p) => p.playerId))
      for (const id of theirs) {
        if (!ours.has(id)) mismatches.push(`${season} manager ${managerId}: Sleeper has ${id}, we do not`)
      }
      for (const id of ours) {
        if (!theirs.has(id)) mismatches.push(`${season} manager ${managerId}: we have ${id}, Sleeper does not`)
      }
    }
  }
  if (mismatches.length) {
    console.error(`\n✗ ${mismatches.length} roster disagreements with Sleeper:`)
    for (const m of mismatches.slice(0, 20)) console.error(`   ${m}`)
    process.exit(1)
  }
  console.log('  ✓ every roster matches Sleeper, player for player')

  // --- 4. summarise before writing -----------------------------------------
  const perSeason = SEASONS.map((season) => {
    const mine = picks.filter((p) => p.season === season)
    const spend = new Map<number, number>()
    for (const p of mine) spend.set(p.managerId, (spend.get(p.managerId) ?? 0) + p.price)
    return {
      season,
      picks: mine.length,
      managers: spend.size,
      total: [...spend.values()].reduce((a, b) => a + b, 0),
      over: [...spend.values()].filter((v) => v > 200).length,
    }
  })
  console.table(perSeason)

  if (picks.some((p) => p.season === liveSeason)) {
    console.error(`\n✗ Refusing to touch the live season ${liveSeason}.`)
    process.exit(1)
  }

  if (dryRun) {
    console.log('\n(dry run — nothing written)\n')
    return
  }

  // --- 5. seed the players these picks point at ----------------------------
  // `active = false`, because these are historical rows in the live draft pool.
  // The pool query filters on it; without that filter the 2027 draft board grows
  // several hundred retired players.
  const needed = new Map<string, { name: string; team: string | null; position: string }>()
  for (const p of picks) {
    const meta = index.latest.get(p.playerId)
    needed.set(p.playerId, {
      name: meta?.name ?? p.name,
      team: meta?.team ?? p.team,
      position: meta?.position ?? p.position,
    })
  }
  const values: unknown[] = []
  const tuples = [...needed.entries()].map(([id, m]) => {
    values.push(id, id, m.name, m.team, m.position)
    const n = values.length
    return `($${n - 4},$${n - 3},$${n - 2},$${n - 1},$${n},false)`
  })
  await sql.query(
    `INSERT INTO players (id, sleeper_id, name, team, position, active) VALUES ${tuples.join(',')}
     ON CONFLICT (id) DO UPDATE SET sleeper_id = COALESCE(players.sleeper_id, excluded.sleeper_id)`,
    values,
  )
  console.log(`  ✓ ${needed.size} players present (new ones inactive)`)

  // --- 6. the picks --------------------------------------------------------
  for (const season of SEASONS) {
    await sql.query('DELETE FROM picks WHERE season = $1', [season])
  }
  const pv: unknown[] = []
  const pt = picks.map((p) => {
    pv.push(p.season, p.pickNo, p.playerId, p.name, p.team, p.position, p.playerId, p.managerId, p.nominatorId, p.price)
    const n = pv.length
    return `($${n - 9},$${n - 8},$${n - 7},$${n - 6},$${n - 5},$${n - 4},$${n - 3},$${n - 2},$${n - 1},$${n})`
  })
  // player_rank and player_pos_rank stay NULL: rank is unrecoverable once a
  // season's pool is replaced, and NULL means "not scored" — never rank 0,
  // which would read as the best player alive.
  await sql.query(
    `INSERT INTO picks (season, pick_no, player_id, player_name, player_team, player_position,
                        player_sleeper_id, manager_id, nominator_id, price)
     VALUES ${pt.join(',')}`,
    pv,
  )
  console.log(`  ✓ ${picks.length} picks written`)

  // --- 7. seating, from the only recorded fact available -------------------
  // There is no drawn draft order in the workbook. Each manager's FIRST
  // nomination is a real recorded fact, so it stands in — and `seasons.notes`
  // says so, rather than letting a reconstruction pass as the drawn seat.
  for (const season of SEASONS) {
    const firstNomination = new Map<number, number>()
    for (const p of [...picks].filter((x) => x.season === season).sort((a, b) => a.pickNo - b.pickNo)) {
      if (!firstNomination.has(p.nominatorId)) firstNomination.set(p.nominatorId, p.pickNo)
    }
    const order = [...firstNomination.entries()].sort((a, b) => a[1] - b[1])
    await sql.query('DELETE FROM season_orders WHERE season = $1', [season])
    for (const [managerId, , ] of order.map(([m, p], i) => [m, p, i] as const)) {
      const slot = order.findIndex(([m]) => m === managerId)
      await sql.query(
        `INSERT INTO season_orders (season, manager_id, draft_slot, display_name, color)
         SELECT $1, m.id, $2, m.display_name, m.color FROM managers m WHERE m.id = $3`,
        [season, slot, managerId],
      )
    }
    await sql.query(
      `UPDATE seasons SET notes = $2 WHERE season = $1`,
      [
        season,
        [
          'Draft order shown is each manager’s first nomination, not the drawn seat — the drawn order was never recorded.',
          ...CORRECTIONS.filter((c) => c.season === season).map((c) => `${c.action === 'drop' ? 'Removed' : 'Added'} ${c.player}: ${c.reason}`),
        ],
      ],
    )
  }
  console.log('  ✓ seating and notes recorded')

  // --- 8. prove the live budget did not move -------------------------------
  const totalsAfter = await sql`SELECT id, budget, rostered, max_bid FROM manager_totals ORDER BY id`
  if (JSON.stringify(totalsBefore) !== JSON.stringify(totalsAfter)) {
    console.error('\n✗ manager_totals changed. History must never touch a live budget.')
    console.table(totalsBefore)
    console.table(totalsAfter)
    process.exit(1)
  }

  const summary = await sql`
    SELECT season, count(*)::int AS picks, count(DISTINCT manager_id)::int AS managers,
           sum(price)::int AS spent,
           count(*) FILTER (WHERE player_rank IS NOT NULL)::int AS ranked
      FROM picks GROUP BY season ORDER BY season`
  console.table(summary)
  console.log('✓ Auctions imported. manager_totals unchanged.\n')
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
