/**
 * Build a minimal player id → name/position/team map for the pulled seasons.
 *
 *   npm run history:player-map
 *
 * Computing an optimal lineup needs the **position of every rostered player**,
 * not just the ones who started: the whole question is whether somebody better
 * was sitting on the bench. Sleeper's weekly matchup payload gives
 * `players_points` keyed by id and says nothing about what those players are, so
 * the positions have to come from the 5MB `/players/nfl` dump.
 *
 * That dump is far too large to commit and is banned from any request path
 * (docs/PROJECT_PLAN.md §9), so this reduces it to just the ids that actually
 * appear in the committed seasons — a few thousand rows, a few hundred KB — and
 * writes that. Run once, alongside `history:pull`.
 *
 * ⚠️ **Positions here are today's, not that season's.** A player who moved from
 * RB to WR reads as a WR in 2020. That is acceptable for exactly one reason: the
 * only consumer is the optimal-lineup calculation, which needs to know what a
 * bench player was *eligible* to fill, and position changes of that kind are
 * vanishingly rare compared to the alternative of having no position at all.
 * Anything that reports a player's position to a human should use the season's
 * own record instead — `player_seasons`, or the snapshot on `picks`.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SLEEPER_DIR = join(ROOT, 'data', 'sleeper')
const OUT = join(SLEEPER_DIR, 'players-min.json')

interface RawPlayer {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  fantasy_positions?: string[]
  team?: string
}

/** [name, position, team] — an array rather than an object, to keep the file small. */
type MinPlayer = [string, string, string | null]

async function collectIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  const seasons = (await readdir(SLEEPER_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)

  for (const season of seasons) {
    const dir = join(SLEEPER_DIR, season)
    for (const file of await readdir(dir)) {
      if (!file.startsWith('matchups-')) continue
      const weeks = JSON.parse(await readFile(join(dir, file), 'utf8')) as Array<{
        players?: string[] | null
        starters?: string[] | null
      }>
      for (const entry of weeks) {
        for (const id of entry.players ?? []) ids.add(id)
        for (const id of entry.starters ?? []) if (id && id !== '0') ids.add(id)
      }
    }
  }
  return ids
}

async function main() {
  console.log('\nBuilding the player map\n')
  const ids = await collectIds()
  console.log(`  ${ids.size} distinct players across the committed seasons`)

  process.stdout.write('  fetching /players/nfl (~5MB) … ')
  const res = await fetch('https://api.sleeper.app/v1/players/nfl', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sleeper returned ${res.status} ${res.statusText}`)
  const dump = (await res.json()) as Record<string, RawPlayer>
  console.log(`ok (${Object.keys(dump).length} players)`)

  const map: Record<string, MinPlayer> = {}
  const missing: string[] = []
  for (const id of [...ids].sort()) {
    const p = dump[id]
    if (!p) {
      // A team defense is keyed by its team code and is not in the dictionary.
      if (/^[A-Z]{2,3}$/.test(id)) {
        map[id] = [id, 'DEF', id]
        continue
      }
      missing.push(id)
      continue
    }
    const name = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? id
    const position = p.position ?? p.fantasy_positions?.[0] ?? 'UNKNOWN'
    map[id] = [name, position, p.team ?? null]
  }

  const body = `${JSON.stringify(map, null, 0)}\n`
  await writeFile(OUT, body, 'utf8')

  console.log(`  mapped ${Object.keys(map).length}, unmapped ${missing.length}`)
  if (missing.length) {
    // Not fatal: an unmapped id simply cannot be considered for an optimal
    // lineup. Loud, though, because a lot of them would quietly depress every
    // efficiency number.
    console.log(`  ⚠️  unmapped ids: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`)
  }
  console.log(`\n  sha256 ${createHash('sha256').update(body).digest('hex').slice(0, 16)}…`)
  console.log(`  wrote ${OUT}\n`)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
