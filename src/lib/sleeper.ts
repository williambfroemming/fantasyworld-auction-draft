/**
 * Sleeper player-pool sync.
 *
 * Public API, no auth. The full pool is ~5MB, and Sleeper's docs explicitly ask
 * that it be stored locally and fetched at most once a day — so this runs at
 * setup and writes into the `players` table. It must NEVER be called from a
 * request path, and never on draft night.
 */

/** Positions the league actually drafts. Sleeper also returns IDP, which bloats the pool. */
export const DRAFTABLE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
export type DraftablePosition = (typeof DRAFTABLE_POSITIONS)[number]

export interface SleeperPlayer {
  player_id?: string
  full_name?: string
  first_name?: string
  last_name?: string
  team?: string | null
  position?: string | null
  fantasy_positions?: string[] | null
  active?: boolean
  status?: string | null
  search_rank?: number | null
}

export interface PoolPlayer {
  id: string
  name: string
  team: string | null
  position: DraftablePosition
  searchRank: number | null
  active: boolean
}

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl'

/**
 * Sleeper marks unranked players with this sentinel rather than null. Verified
 * against the live API: `max(search_rank)` for both QB and RB is exactly this.
 * Treated as "no rank" so it never renders as "#9999999" or skews a sort.
 */
export const UNRANKED_SENTINEL = 9_999_999

function cleanRank(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  if (v >= UNRANKED_SENTINEL) return null
  return v
}

/**
 * Normalize Sleeper's player dictionary into our pool.
 *
 * Team defenses come back with `player_id` set to the team abbreviation ("PHI")
 * and no full_name, so their display name is built from the team code.
 */
export function normalizePool(raw: Record<string, SleeperPlayer>): PoolPlayer[] {
  const out: PoolPlayer[] = []

  for (const [id, p] of Object.entries(raw)) {
    const position = (p.position ?? p.fantasy_positions?.[0]) as DraftablePosition | undefined
    if (!position || !DRAFTABLE_POSITIONS.includes(position)) continue

    // Defenses have no personal name; Sleeper keys them by team abbreviation.
    const name =
      p.full_name ??
      [p.first_name, p.last_name].filter(Boolean).join(' ') ??
      ''
    const resolved = position === 'DEF' ? (name || `${p.team ?? id} Defense`) : name
    if (!resolved.trim()) continue

    // A team defense is always "active" as a draftable asset even though Sleeper
    // may not mark it so; for humans we trust the flag.
    const active = position === 'DEF' ? true : p.active === true

    out.push({
      id,
      name: resolved,
      team: p.team ?? (position === 'DEF' ? id : null),
      position,
      searchRank: cleanRank(p.search_rank),
      active,
    })
  }

  return out
}

/**
 * Sort for the draft board.
 *
 * ⚠️ `search_rank` is a WEAK ordering, measured against the live API:
 *   - only 660 distinct values across 3,149 ranked players — 318 ranks are
 *     shared by two or more players (Josh Allen and Bijan Robinson are both #1)
 *   - **every team defense is unranked**, so a naive sort buries all 32 of them
 *     at the bottom of a 3,200-row list, and this league drafts defenses
 *
 * So it is treated as a rough hint, not a ranking: ties break by position group
 * and then name, keeping the order stable and predictable instead of arbitrary.
 * Real 2026 rankings should come in via `parseCsvPool`. The UI leans on position
 * filters + search rather than on this order.
 */
const POSITION_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, DEF: 4, K: 5 }

export function sortForBoard(players: PoolPlayer[]): PoolPlayer[] {
  return [...players].sort((a, b) => {
    if (a.searchRank !== b.searchRank) {
      if (a.searchRank === null) return 1
      if (b.searchRank === null) return -1
      return a.searchRank - b.searchRank
    }
    const pa = POSITION_ORDER[a.position] ?? 9
    const pb = POSITION_ORDER[b.position] ?? 9
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name)
  })
}

export async function fetchPool(): Promise<PoolPlayer[]> {
  const res = await fetch(SLEEPER_PLAYERS_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sleeper returned ${res.status} ${res.statusText}`)
  const raw = (await res.json()) as Record<string, SleeperPlayer>
  return sortForBoard(normalizePool(raw))
}

/** Optional: pull manager names straight from the league's Sleeper roster. */
export async function fetchLeagueUsers(leagueId: string) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Sleeper returned ${res.status} for league ${leagueId}`)
  return (await res.json()) as Array<{
    user_id: string
    display_name: string
    metadata?: { team_name?: string }
  }>
}

// ---------------------------------------------------------------------------
// CSV import — the override when real 2026 rankings are available
// ---------------------------------------------------------------------------

/**
 * Parse `Name, Team, Position, Rank`. Tolerates a header row, quoted fields, and
 * extra columns. Rank falls back to file order, so an unranked list still keeps
 * whatever order the user pasted.
 */
export function parseCsvPool(text: string): PoolPlayer[] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(splitCsvLine)

  if (rows.length === 0) return []
  const hasHeader = /name/i.test(rows[0][0] ?? '')
  const body = hasHeader ? rows.slice(1) : rows

  const out: PoolPlayer[] = []
  body.forEach((cols, i) => {
    const [name, team, position, rank] = cols
    if (!name?.trim()) return
    const pos = (position ?? '').trim().toUpperCase()
    const normalized = pos === 'DST' || pos === 'D/ST' || pos === 'DS' ? 'DEF' : pos
    if (!DRAFTABLE_POSITIONS.includes(normalized as DraftablePosition)) return
    const parsedRank = Number(rank)
    out.push({
      id: `csv-${slug(name)}-${normalized}`,
      name: name.trim(),
      team: team?.trim() || null,
      position: normalized as DraftablePosition,
      searchRank: Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : i + 1,
      active: true,
    })
  })
  return sortForBoard(out)
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cols.push(cur)
      cur = ''
    } else cur += ch
  }
  cols.push(cur)
  return cols.map((c) => c.trim())
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
