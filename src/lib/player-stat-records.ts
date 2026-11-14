import { formatStatLine } from '@/lib/player-stats'
import type { PlayerRecordEntry, PlayerRecordList } from '@/lib/player-records'
import type { StatMap } from '@/lib/player-stat-totals'

/**
 * NFL stat records for rostered players (docs/archive/STATS_WEAVE_ROADMAP.md step 70): the best seasons
 * and single games by a position's own stats. Pure.
 *
 * ## Rules this file keeps
 *
 * **Every list is inside one position.** "Most receiving yards in a season" is a list of
 * receivers; there is no list of yards across positions, because a quarterback's passing yards
 * and a receiver's receiving yards are not the same size of thing. Positions come from the
 * player's own `position`, never the lineup slot.
 *
 * **Single-game lists count STARTED weeks only** (a decision of the commissioner, 2026-11-11):
 * a stat line on a bench won nothing. Every such list is labelled "by a starter".
 *
 * **Season lists are one manager's stint.** A player who changed hands appears once per holder,
 * with only the weeks that manager held him, exactly like "Best season, by position" in
 * player-records.ts. So every entry names exactly one manager.
 *
 * **Only played weeks count** (`gp >= 1`). A week with no stat row, or a null `gp`, is absent:
 * never a 0. A season's total is a sum over played weeks; a stat no played week had is unknown.
 *
 * **Regular season, complete weeks** (the caller passes the week keys), like every other record
 * on the page. Rostered players, 2020 on, and NFL stats, not fantasy points.
 */

export interface StatRecordWeek {
  season: number
  week: number
  managerId: number
  playerId: string
  playerName: string | null
  position: string | null
  isStarter: boolean
  /** 1 if he played, null otherwise. */
  gp: number | null
  stats: StatMap
}

export interface PositionStatRecords {
  position: string
  lists: PlayerRecordList[]
}

interface Def {
  key: string
  label: string
  kind: 'season' | 'game'
  /** One week's value, null when the stats do not carry it. */
  value: (s: StatMap) => number | null
  order: 'max' | 'min'
  unit: string
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? null : v)
const add = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0)

const season = (key: string, label: string, unit: string, value: Def['value']): Def => ({
  key,
  label: `${label} in a season`,
  kind: 'season',
  value,
  order: 'max',
  unit,
})
const game = (
  key: string,
  label: string,
  unit: string,
  value: Def['value'],
  order: 'max' | 'min' = 'max',
): Def => ({
  key,
  label: `${label} in a game, by a starter`,
  kind: 'game',
  value,
  order,
  unit,
})

const DEFS: Record<string, Def[]> = {
  QB: [
    season('pass_yd_season', 'Most passing yards', 'yd', (s) => n(s.pass_yd)),
    season('pass_td_season', 'Most passing touchdowns', 'TD', (s) => n(s.pass_td)),
    game('pass_yd_game', 'Most passing yards', 'yd', (s) => n(s.pass_yd)),
  ],
  RB: [
    season('rush_yd_season', 'Most rushing yards', 'yd', (s) => n(s.rush_yd)),
    season('scrimmage_yd_season', 'Most yards from scrimmage', 'yd', (s) =>
      add(n(s.rush_yd), n(s.rec_yd)),
    ),
    game('rush_yd_game', 'Most rushing yards', 'yd', (s) => n(s.rush_yd)),
  ],
  WR: [
    season('rec_yd_season', 'Most receiving yards', 'yd', (s) => n(s.rec_yd)),
    season('rec_season', 'Most receptions', 'rec', (s) => n(s.rec)),
    game('rec_yd_game', 'Most receiving yards', 'yd', (s) => n(s.rec_yd)),
  ],
  TE: [
    season('rec_yd_season', 'Most receiving yards', 'yd', (s) => n(s.rec_yd)),
    season('rec_season', 'Most receptions', 'rec', (s) => n(s.rec)),
    game('rec_yd_game', 'Most receiving yards', 'yd', (s) => n(s.rec_yd)),
  ],
  DEF: [
    season('sack_season', 'Most sacks', 'sacks', (s) => n(s.sack)),
    {
      key: 'pts_allow_game',
      label: 'Fewest points allowed in a game, by a starter',
      kind: 'game',
      value: (s) => n(s.pts_allow),
      order: 'min',
      unit: 'pts',
    },
  ],
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'DEF']

const nameOf = (r: { playerName: string | null; playerId: string }) => r.playerName ?? r.playerId
const played = (w: StatRecordWeek) => typeof w.gp === 'number' && w.gp >= 1

/** Stable best-first sort: a tie keeps the earliest row, so a record has one holder. */
function ranked<T>(rows: T[], by: (r: T) => number, order: 'max' | 'min', n_: number): T[] {
  return rows
    .map((r) => ({ v: by(r), r }))
    .sort((a, b) => (order === 'max' ? b.v - a.v : a.v - b.v))
    .slice(0, n_)
    .map((x) => x.r)
}

export function playerStatRecords(
  weeks: StatRecordWeek[],
  weekKeys: Set<string>,
  topN = 5,
): PositionStatRecords[] {
  const inScope = weeks.filter((w) => weekKeys.has(`${w.season}:${w.week}`) && played(w))
  const out: PositionStatRecords[] = []

  for (const position of POSITION_ORDER) {
    const mine = inScope.filter((w) => w.position === position)
    if (mine.length === 0) continue
    const lists: PlayerRecordList[] = []

    for (const def of DEFS[position]) {
      let entries: PlayerRecordEntry[]
      if (def.kind === 'game') {
        const candidates = mine
          .filter((w) => w.isStarter)
          .map((w) => ({ w, v: def.value(w.stats) }))
          .filter((x): x is { w: StatRecordWeek; v: number } => x.v !== null)
        entries = ranked(candidates, (x) => x.v, def.order, topN).map(({ w, v }) => ({
          managerId: w.managerId,
          season: w.season,
          week: w.week,
          value: v,
          playerId: w.playerId,
          playerName: nameOf(w),
          position,
          detail: formatStatLine(position, w.stats),
        }))
      } else {
        // One manager's stint: the weeks one manager held one player in one season.
        const stints = new Map<
          string,
          { first: StatRecordWeek; total: number | null; games: number }
        >()
        for (const w of mine) {
          const key = `${w.season}:${w.managerId}:${w.playerId}`
          const s = stints.get(key) ?? { first: w, total: null, games: 0 }
          const v = def.value(w.stats)
          s.total = v === null ? s.total : (s.total ?? 0) + v
          s.games += 1
          stints.set(key, s)
        }
        const candidates = [...stints.values()].filter(
          (s): s is { first: StatRecordWeek; total: number; games: number } => s.total !== null,
        )
        entries = ranked(candidates, (s) => s.total, def.order, topN).map((s) => ({
          managerId: s.first.managerId,
          season: s.first.season,
          week: null,
          value: s.total,
          playerId: s.first.playerId,
          playerName: nameOf(s.first),
          position,
          detail: `${s.games} game${s.games === 1 ? '' : 's'}`,
        }))
      }
      lists.push({ key: `${position}:${def.key}`, label: def.label, entries })
    }
    out.push({ position, lists })
  }
  return out
}

export const STAT_RECORD_UNITS: Record<string, string> = Object.fromEntries(
  Object.entries(DEFS).flatMap(([p, defs]) => defs.map((d) => [`${p}:${d.key}`, d.unit])),
)
