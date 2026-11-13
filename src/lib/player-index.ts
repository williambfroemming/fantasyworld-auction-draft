import { headlineStat } from '@/lib/player-stat-totals'

/**
 * Filtering and ranking for the players index (docs/STATS_WEAVE_ROADMAP.md step 69). Pure.
 *
 * ## The rule this file exists to keep
 *
 * **A stat is only ever ranked inside one position.** A quarterback's 4,000 passing yards and a
 * receiver's 1,200 receiving yards are not the same size of thing, so a list sorted by yards
 * across positions measures nothing. The stat column and the stat sort therefore exist ONLY while
 * exactly one position is selected. With "All" selected there is no column and no way to sort by
 * one; the list stays ordered by fantasy points, which is a plain statement about points scored.
 *
 * Null is unknown: a player with no played week in the span has no figure (a dash) and sorts last
 * when ranked by a stat, never as a 0.
 *
 * Every figure is regular season, over the weeks he was rostered here, 2020 on.
 */

/** One season of one player: what the list needs, regular season only. */
export interface IndexSeason {
  season: number
  /** Fantasy points in regular-season weeks while rostered. */
  points: number
  /** Regular-season weeks he played (`gp >= 1`). */
  games: number
  /** The position's headline stat summed over those weeks; null if he has no stat row. */
  headline: number | null
}

export interface IndexPlayer {
  playerId: string
  playerName: string
  position: string | null
  firstSeason: number
  lastSeason: number
  /** Fantasy points over every rostered week, playoffs included (the all-time figure). */
  points: number
  topPrice: number | null
  seasons: IndexSeason[]
}

export interface IndexFilters {
  query: string
  /** Null is "All". */
  position: string | null
  /** Null is "All seasons". */
  season: number | null
  sort: 'points' | 'stat'
}

export interface IndexRow {
  player: IndexPlayer
  /** Fantasy points for the span shown: the season picked, or all time. */
  points: number
  /** Present only while the stat column is shown. Null is unknown. */
  stat: number | null
}

export interface IndexView {
  rows: IndexRow[]
  /** The stat column's label ("Rec yd"), or null when no stat column is offered. */
  statLabel: string | null
  /** Whether sorting by the stat is offered. True only with exactly one position selected. */
  canSortByStat: boolean
  /** The sort actually applied (a stat sort requested where it is not offered falls back to points). */
  sort: 'points' | 'stat'
}

const sum = (xs: Array<number | null>) =>
  xs.every((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b ?? 0), 0)

export function playerIndexView(players: IndexPlayer[], f: IndexFilters): IndexView {
  const needle = f.query.trim().toLowerCase()
  const headline = f.position ? headlineStat(f.position) : null
  const canSortByStat = f.position !== null && headline !== null
  const sort = f.sort === 'stat' && canSortByStat ? 'stat' : 'points'

  const rows: IndexRow[] = []
  for (const p of players) {
    if (f.position && p.position !== f.position) continue
    if (needle && !p.playerName.toLowerCase().includes(needle)) continue
    const inSeason = f.season === null ? p.seasons : p.seasons.filter((s) => s.season === f.season)
    // A season picked means "rostered that season": anyone with no row for it is not in the list.
    if (f.season !== null && inSeason.length === 0) continue
    rows.push({
      player: p,
      points: f.season === null ? p.points : inSeason.reduce((a, s) => a + s.points, 0),
      stat: canSortByStat ? sum(inSeason.map((s) => s.headline)) : null,
    })
  }

  rows.sort((a, b) => {
    if (sort === 'stat') {
      // Unknown last, then biggest first. Ties fall back to points, then name, so order is stable.
      if (a.stat === null && b.stat !== null) return 1
      if (b.stat === null && a.stat !== null) return -1
      const d = (b.stat ?? 0) - (a.stat ?? 0)
      if (d !== 0) return d
    }
    return b.points - a.points || a.player.playerName.localeCompare(b.player.playerName)
  })

  return { rows, statLabel: canSortByStat ? headline!.label : null, canSortByStat, sort }
}
