/**
 * Record sales straight into the draft, bypassing the nomination order.
 *
 *   npm run draft:record -- "Mario|Aaron Rodgers|1" "Nate|Tyler Allgeier|1"
 *   npm run draft:record -- --dry-run "Mario|Aaron Rodgers|1"
 *
 * Why this exists: the 2026 draft stalled with 8 picks left because
 * `nominatorAt` runs out of index budget (docs/BACKLOG.md §9, P0), so the last
 * players were bought in the room but could not be entered through the UI. This
 * is the repair path — and it stays useful until that bug is fixed.
 *
 * It bypasses **whose turn it is** and nothing else. Each entry opens a real lot
 * and awards it with the same single statement as `awardLot()`, so the max-bid
 * check still runs inside the database against `manager_totals`. A price that
 * would strand a manager below $1 per empty slot is refused here exactly as it
 * would be in the app.
 *
 * Manager is matched on `name` or `display_name`; player on exact name, then on
 * a unique case-insensitive partial. An ambiguous match is an error, never a
 * guess — picking the wrong Johnson is worse than failing.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

interface Entry {
  manager: string
  player: string
  price: number
}

function parseArgs(argv: string[]): { entries: Entry[]; dryRun: boolean } {
  const dryRun = argv.includes('--dry-run')
  const entries = argv
    .filter((a) => a !== '--dry-run' && a !== '--')
    .map((arg) => {
      const parts = arg.split('|').map((s) => s.trim())
      if (parts.length !== 3) {
        throw new Error(`Expected "Manager|Player|Price", got: ${arg}`)
      }
      const price = Number(parts[2])
      if (!Number.isInteger(price) || price < 1) {
        throw new Error(`Price must be a whole dollar >= 1, got: ${parts[2]}`)
      }
      return { manager: parts[0], player: parts[1], price }
    })
  return { entries, dryRun }
}

async function resolveManager(sql: NeonQueryFunction<false, false>, needle: string) {
  const rows = await sql`
    SELECT id, display_name FROM managers
    WHERE name = ${needle} OR display_name = ${needle}`
  if (rows.length === 0) throw new Error(`No manager named "${needle}"`)
  if (rows.length > 1) throw new Error(`"${needle}" matches ${rows.length} managers`)
  return rows[0] as { id: number; display_name: string }
}

async function resolvePlayer(sql: NeonQueryFunction<false, false>, needle: string) {
  const exact = await sql`
    SELECT id, name, team, position FROM players WHERE lower(name) = lower(${needle})`
  const rows =
    exact.length === 1
      ? exact
      : await sql`SELECT id, name, team, position FROM players
                  WHERE name ILIKE ${'%' + needle + '%'}`
  if (rows.length === 0) throw new Error(`No player matching "${needle}"`)
  if (rows.length > 1) {
    throw new Error(
      `"${needle}" is ambiguous — ${rows.map((r) => `${r.name} (${r.position})`).join(', ')}`,
    )
  }
  return rows[0] as { id: string; name: string; team: string | null; position: string }
}

async function main() {
  const { entries, dryRun } = parseArgs(process.argv.slice(2))
  if (entries.length === 0) {
    console.error('Nothing to record. Usage: npm run draft:record -- "Manager|Player|Price" ...')
    process.exit(1)
  }

  const sql = neon(process.env.DATABASE_URL!)
  const [settings] = await sql`SELECT season, status, roster_size FROM draft WHERE id = 1`
  const season = Number(settings.season)

  // Resolve everything before writing anything, so a typo in the last entry
  // does not leave the first four recorded.
  const resolved = []
  for (const e of entries) {
    const manager = await resolveManager(sql, e.manager)
    const player = await resolvePlayer(sql, e.player)
    const [drafted] = await sql`
      SELECT m.display_name FROM picks pk JOIN managers m ON m.id = pk.manager_id
      WHERE pk.player_id = ${player.id} AND pk.season = ${season}`
    if (drafted) {
      throw new Error(`${player.name} is already on ${drafted.display_name}'s roster`)
    }
    resolved.push({ ...e, manager, player })
  }

  console.log(`Recording ${resolved.length} pick(s) — draft status "${settings.status}"\n`)
  for (const r of resolved) {
    console.log(
      `  ${r.manager.display_name.padEnd(12)} ${r.player.name} ` +
        `(${r.player.position}${r.player.team ? ' ' + r.player.team : ''})  $${r.price}`,
    )
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  // The award statement needs a live draft to reference; a completed draft sits
  // at 'done' and would otherwise have to be reopened by hand.
  if (settings.status !== 'live') {
    await sql`UPDATE draft SET status = 'live', rev = rev + 1 WHERE id = 1`
    console.log(`\n(status "${settings.status}" -> "live" for the duration of this run)`)
  }

  console.log()
  for (const r of resolved) {
    // A real lot, so the archive and the pick log read the same as any other
    // sale. The buyer is recorded as their own nominator: these were the
    // end-of-draft fills, and inventing someone else's name would be a lie in
    // the permanent record.
    const [lot] = await sql`
      INSERT INTO lots (season, player_id, nominator_id)
      SELECT ${season}, ${r.player.id}, ${r.manager.id}
      WHERE NOT EXISTS (
        SELECT 1 FROM picks WHERE player_id = ${r.player.id} AND season = ${season})
      RETURNING id`
    if (!lot) throw new Error(`${r.player.name} was drafted by someone else mid-run`)

    // Byte-for-byte the statement in awardLot(), including the player snapshot
    // copied onto the pick: the max-bid rule is enforced by the database, not
    // by this script.
    const rows = await sql`
      WITH sold AS (
        UPDATE lots
        SET status = 'sold', sold_price = ${r.price}, winner_id = ${r.manager.id}
        WHERE id = ${lot.id}
          AND status = 'open'
          AND ${r.price} <= (SELECT max_bid FROM manager_totals WHERE id = ${r.manager.id})
          AND NOT EXISTS (
            SELECT 1 FROM picks pk
            WHERE pk.player_id = lots.player_id AND pk.season = ${season})
        RETURNING player_id, nominator_id
      )
      INSERT INTO picks (season, pick_no, player_id, player_name, player_team,
                         player_position, manager_id, nominator_id, price)
      SELECT ${season},
             (SELECT COALESCE(MAX(pick_no), 0) FROM picks WHERE season = ${season}) + 1,
             sold.player_id, p.name, p.team, p.position,
             ${r.manager.id}, sold.nominator_id, ${r.price}
      FROM sold JOIN players p ON p.id = sold.player_id
      ON CONFLICT (season, player_id) DO NOTHING
      RETURNING pick_no`

    if (rows.length === 0) {
      const [t] = await sql`SELECT budget, rostered, max_bid FROM manager_totals WHERE id = ${r.manager.id}`
      await sql`UPDATE lots SET status = 'void' WHERE id = ${lot.id}`
      throw new Error(
        `Refused: ${r.manager.display_name} at $${r.price} for ${r.player.name} — ` +
          `budget $${t.budget}, ${t.rostered}/${settings.roster_size} rostered, max bid $${t.max_bid}`,
      )
    }
    console.log(`  ✓ pick #${rows[0].pick_no}  ${r.player.name} -> ${r.manager.display_name} $${r.price}`)
  }

  const totals = await sql`
    SELECT m.display_name AS manager, t.budget, t.rostered
    FROM manager_totals t JOIN managers m ON m.id = t.id ORDER BY m.draft_slot`
  console.log()
  console.table(totals)

  // Every roster full means the draft is over. Saying so is what stops the
  // board rendering an empty clock that reads as a freeze (BACKLOG §9, P1).
  const unfilled = totals.filter((t) => Number(t.rostered) < Number(settings.roster_size))
  if (unfilled.length === 0) {
    await sql`UPDATE draft SET status = 'done', rev = rev + 1 WHERE id = 1`
    console.log('✓ Every roster is full — draft status set to "done".')
  } else {
    console.log(
      `${unfilled.length} manager(s) still unfilled: ` +
        unfilled.map((t) => `${t.manager} ${t.rostered}/${settings.roster_size}`).join(', '),
    )
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
