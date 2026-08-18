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
  /** Overall board rank. FantasyPros RK, or Sleeper search_rank as a weak fallback. */
  searchRank: number | null
  /** Positional rank ("WR12" -> 12), when the source provides it. */
  posRank?: number | null
  byeWeek?: number | null
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
 * Normalize the many spellings of a team defense into `DEF`.
 * FantasyPros uses DST, ESPN uses D/ST, the league's old sheet used DS.
 */
export function normalizePosition(raw: string): { position: string; posRank: number | null } {
  const trimmed = raw.trim().toUpperCase()
  // FantasyPros embeds the positional rank in the column: "WR12", "DST1".
  const m = trimmed.match(/^([A-Z/]+)\s*(\d+)?$/)
  const base = (m?.[1] ?? trimmed).replace(/[^A-Z/]/g, '')
  const posRank = m?.[2] ? Number(m[2]) : null
  const position = base === 'DST' || base === 'D/ST' || base === 'DS' || base === 'DEFENSE' ? 'DEF' : base
  return { position, posRank }
}

/** Case/space-insensitive header lookup, tolerating the trailing spaces FantasyPros emits. */
function findColumn(header: string[], ...candidates: string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
  for (const c of candidates) {
    const i = norm.indexOf(c.toLowerCase())
    if (i !== -1) return i
  }
  // fall back to a prefix match, so "BYE WEEK" matches "bye"
  for (const c of candidates) {
    const i = norm.findIndex((h) => h.startsWith(c.toLowerCase()))
    if (i !== -1) return i
  }
  return -1
}

/**
 * Parse a rankings CSV.
 *
 * Header-driven rather than positional, so it handles a FantasyPros export
 * (`RK, TIERS, PLAYER NAME, TEAM, POS, BYE WEEK, ...`), a minimal
 * `Name, Team, Position, Rank`, and column reorderings without code changes.
 * Rank falls back to file order so an unranked paste keeps its order.
 */
export function parseCsvPool(text: string): PoolPlayer[] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(splitCsvLine)

  if (rows.length === 0) return []

  const header = rows[0]
  const iName = findColumn(header, 'player name', 'player', 'name')
  const hasHeader = iName !== -1

  // Without a header, assume the documented minimal shape.
  const cols = hasHeader
    ? {
        name: iName,
        team: findColumn(header, 'team', 'tm'),
        pos: findColumn(header, 'pos', 'position'),
        rank: findColumn(header, 'rk', 'rank', 'overall'),
        bye: findColumn(header, 'bye week', 'bye'),
      }
    : { name: 0, team: 1, pos: 2, rank: 3, bye: -1 }

  const body = hasHeader ? rows.slice(1) : rows
  const at = (r: string[], i: number) => (i === -1 ? undefined : r[i])
  const num = (v: string | undefined): number | null => {
    if (v === undefined) return null
    const n = Number(String(v).replace(/[$,]/g, ''))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const out: PoolPlayer[] = []
  body.forEach((r, i) => {
    const name = at(r, cols.name)?.trim()
    if (!name) return
    const { position, posRank } = normalizePosition(at(r, cols.pos) ?? '')
    if (!DRAFTABLE_POSITIONS.includes(position as DraftablePosition)) return

    out.push({
      id: `csv-${slug(name)}-${position}`,
      name,
      team: at(r, cols.team)?.trim() || null,
      position: position as DraftablePosition,
      searchRank: num(at(r, cols.rank)) ?? i + 1,
      posRank,
      byeWeek: num(at(r, cols.bye)),
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

// ---------------------------------------------------------------------------
// Cross-import identity (docs/BACKLOG.md §2, and the hard half of §1)
// ---------------------------------------------------------------------------

/**
 * `players.id` is a Sleeper id when synced from Sleeper and a derived slug when
 * imported from a CSV — and the CSV is the *recommended* path, so in practice
 * the pool is keyed by slugs no other system has ever heard of. The pool is
 * re-imported every season, so nothing survives from one year to the next: a
 * cross-year question ("what did this player cost in 2026 vs 2027") has nothing
 * reliable to join on, and a news provider has nothing to look the player up by.
 *
 * The fix is at the seam we control: resolve every CSV row against the Sleeper
 * pool at import time and store the Sleeper id alongside the slug. `players.id`
 * keeps its current meaning — nothing that references it has to change — and
 * `sleeperId` becomes the one identifier that means the same thing across years.
 *
 * ⚠️ **Do not expect this to reach 100%, and do not build anything that needs it
 * to.** Every consumer must treat a null `sleeperId` as "unknown", not "error".
 */

/** Suffixes that appear in one source and not the other. */
const NAME_SUFFIXES = /\s+(jr|sr|ii|iii|iv|v)\.?$/i

/**
 * Team codes the two sources spell differently.
 *
 * Found the hard way: the 2026 backfill resolved 159 of 160 picks, and the one
 * miss was the Jacksonville defense — FantasyPros writes `JAC`, Sleeper writes
 * `JAX`. That is not a one-off worth an override entry, it is a systematic
 * mismatch that would recur every year for the same team, and defenses match on
 * team code *only* — so a divergence here is a guaranteed miss rather than a
 * probable one.
 *
 * The relocations are here for the archive: a pick recorded in an older season
 * carries the team as it was written that night.
 */
const TEAM_ALIASES: Record<string, string> = {
  JAC: 'JAX',
  WSH: 'WAS',
  LA: 'LAR',
  ARZ: 'ARI',
  BLT: 'BAL',
  CLV: 'CLE',
  HST: 'HOU',
  // Relocated franchises, for archived seasons.
  SD: 'LAC',
  STL: 'LAR',
  OAK: 'LV',
}

/** A team code in the spelling Sleeper uses. */
export function normalizeTeam(raw: string | null | undefined): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  if (!code) return null
  return TEAM_ALIASES[code] ?? code
}

/**
 * The key two sources have to agree on for the same player.
 *
 * Lowercased, suffix-stripped, and reduced to letters and digits — which folds
 * away the apostrophes ("Ja'Marr"), periods ("A.J."), and hyphens
 * ("Smith-Njigba") that differ between exports and are the single biggest cause
 * of a naive equality miss.
 */
export function playerMatchKey(name: string, position: string): string {
  const bare = name
    .trim()
    .replace(NAME_SUFFIXES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return `${bare}|${position}`
}

/**
 * Resolve a pool against the Sleeper pool, returning player id → Sleeper id.
 *
 * Matching runs in tiers, most specific first, and **a tier that is ambiguous is
 * skipped rather than guessed**. Two players sharing a name and position is
 * exactly the case where a wrong answer is worse than no answer: it would
 * silently attribute one player's price history to another.
 *
 *  1. **Defenses match on team, never on name.** Sleeper keys them by team
 *     abbreviation with a synthesised "PHI Defense" name, while a CSV says
 *     "Philadelphia Eagles" or "Eagles D/ST". Those never match as strings, and
 *     the team code always does.
 *  2. Name + position + team — unambiguous by construction.
 *  3. Name + position, only when exactly one Sleeper player has that key.
 *
 * `overrides` is applied first and wins outright: budget for a handful of
 * players that never match rather than for a matcher that gets everyone.
 */
export function resolveSleeperIds(
  pool: PoolPlayer[],
  sleeper: PoolPlayer[],
  overrides: Record<string, string> = {},
): Map<string, string> {
  const byTeamDef = new Map<string, string>()
  const byNamePosTeam = new Map<string, string>()
  const byNamePos = new Map<string, string | null>() // null = ambiguous

  for (const s of sleeper) {
    if (s.position === 'DEF') {
      // Sleeper's DEF rows carry the team abbreviation in `team` (and in `id`).
      const code = normalizeTeam(s.team ?? s.id)
      if (code) byTeamDef.set(code, s.id)
      continue
    }
    const key = playerMatchKey(s.name, s.position)
    const team = normalizeTeam(s.team)
    if (team) byNamePosTeam.set(`${key}|${team}`, s.id)
    // Second sighting of a name+position makes it ambiguous, and it stays that
    // way — a later unique-looking entry must not un-poison it.
    byNamePos.set(key, byNamePos.has(key) ? null : s.id)
  }

  const out = new Map<string, string>()
  for (const p of pool) {
    const override = overrides[p.id]
    if (override) {
      out.set(p.id, override)
      continue
    }

    if (p.position === 'DEF') {
      const code = normalizeTeam(p.team)
      const hit = code ? byTeamDef.get(code) : undefined
      if (hit) out.set(p.id, hit)
      continue
    }

    const key = playerMatchKey(p.name, p.position)
    const team = normalizeTeam(p.team)
    const withTeam = team ? byNamePosTeam.get(`${key}|${team}`) : undefined
    if (withTeam) {
      out.set(p.id, withTeam)
      continue
    }
    // No team on the row, or they changed team between the two sources — fall
    // back to name+position, but only if it identifies exactly one player.
    const unique = byNamePos.get(key)
    if (unique) out.set(p.id, unique)
  }
  return out
}
