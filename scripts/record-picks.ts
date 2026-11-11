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
 * The admin panel's Picks → Record a sale does the same thing from a browser;
 * both go through `recordSale()` in src/server/commish-service.ts.
 *
 * It bypasses **whose turn it is** and nothing else. Each entry writes a real lot
 * and pick with the same checks and snapshot as `awardLot()`, so the max-bid
 * check still runs inside the database against `manager_totals`. A price that
 * would strand a manager below $1 per empty slot is refused here exactly as it
 * would be in the app.
 *
 * Manager is matched on `name` or `display_name`; player on exact name, then on
 * a unique case-insensitive partial. An ambiguous match is an error, never a
 * guess — picking the wrong Johnson is worse than failing.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { recordSale } from '../src/server/commish-service'

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

  // One copy of the statement, shared with the admin panel's Record a sale.
  // recordSale() writes the lot and the pick together, with awardLot()'s
  // max-bid check and player snapshot (sleeper id included, which this script's
  // own copy used to drop), and refuses rather than half-applying. It works on
  // a 'live', 'paused' or 'done' draft, so there is no status to flip first.
  console.log()
  for (const r of resolved) {
    const res = await recordSale(r.player.id, r.manager.id, r.price)
    if (!res.ok) {
      throw new Error(`Refused: ${r.manager.display_name} at $${r.price} for ${r.player.name} — ${res.reason}`)
    }
    console.log(`  ✓ pick #${res.data.pickNo}  ${r.player.name} -> ${r.manager.display_name} $${r.price}`)
  }

  const totals = await sql`
    SELECT m.display_name AS manager, t.budget, t.rostered
    FROM manager_totals t JOIN managers m ON m.id = t.id ORDER BY m.draft_slot`
  console.log()
  console.table(totals)

  // recordSale() sets 'done' itself when the last slot fills (BACKLOG §9, P1).
  const unfilled = totals.filter((t) => Number(t.rostered) < Number(settings.roster_size))
  if (unfilled.length === 0) {
    console.log('✓ Every roster is full — the draft is done.')
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
