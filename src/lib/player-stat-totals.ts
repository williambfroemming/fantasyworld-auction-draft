import { type StatKey } from '@/lib/player-stats'

/**
 * Season and career NFL stat totals for one player, from his weekly stat lines
 * (docs/STATS_WEAVE_ROADMAP.md step 67). Pure: no database, no network.
 *
 * ## Rules this file keeps
 *
 * **Only played weeks count.** A week contributes only if `gp >= 1`. A rostered week with no
 * stat row (a bye, an injured-reserve week) is absent, and so is one with a null `gp`
 * (Sleeper had an entry and he did not play). All 1,877 rostered player-weeks on record
 * with no row scored exactly 0 fantasy points, so treating them as "did not play" is safe;
 * it is also the only honest reading, because the alternative is a 0 for a game that was
 * never played.
 *
 * **Null is unknown, zero is a real zero.** A played week zero-fills the player's own group
 * (a receiver who was shut out has `rec = 0`) and leaves the other group null. A stat that no
 * played week had a value for therefore totals to **null**, not 0: a wide receiver has no
 * "sacks", and the table shows a dash.
 *
 * **Columns follow the player's own position**, never the lineup slot. A secondary group
 * (a receiver's rushing, a quarterback's receiving) appears only if the player has any
 * activity in it across the span shown, so a running back who never threw has no passing
 * columns, and a column set is the same for every row of one player's table.
 *
 * **Regular season and playoffs are split on each season's own boundary**, which the caller
 * resolves into `isPlayoff` (week 14 in 2020, 15 from 2021). A season with no recorded boundary
 * is all regular season, never guessed into the playoffs.
 *
 * **These are NFL stats, not fantasy points**, and only for the weeks the player was on a
 * roster in this league. Never present a total as an NFL season or career figure.
 */

export type StatMap = Partial<Record<StatKey, number | null>>

/** One rostered week that has a stat row. */
export interface StatWeek {
  season: number
  week: number
  isPlayoff: boolean
  /** 1 if he played, null otherwise. Never 0. */
  gp: number | null
  stats: StatMap
}

/** Sums over played weeks only. `sums[k]` is null when no played week had a value for it. */
export interface StatSums {
  games: number
  sums: Partial<Record<StatKey, number | null>>
}

export type StatGroup = 'passing' | 'rushing' | 'receiving' | 'ballSecurity' | 'defense'

export interface StatColumn {
  id: string
  /** Short header. */
  label: string
  /** Full name, for a tooltip and the screen reader. */
  title: string
  group: StatGroup
  /** Digits after the point. */
  decimals: number
}

interface ColumnDef extends StatColumn {
  value: (t: StatSums) => number | null
}

const sum = (t: StatSums, k: StatKey) => t.sums[k] ?? null
const add = (...xs: Array<number | null>) =>
  xs.every((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b ?? 0), 0)

const col = (
  group: StatGroup,
  id: string,
  label: string,
  title: string,
  value: (t: StatSums) => number | null,
  decimals = 0,
): ColumnDef => ({ group, id, label, title, value, decimals })

const FROM = (k: StatKey) => (t: StatSums) => sum(t, k)

const GROUPS: Record<StatGroup, ColumnDef[]> = {
  passing: [
    col('passing', 'pass_cmp', 'Cmp', 'Completions', FROM('pass_cmp')),
    col('passing', 'pass_att', 'Att', 'Pass attempts', FROM('pass_att')),
    col('passing', 'pass_yd', 'Pass yd', 'Passing yards', FROM('pass_yd')),
    col('passing', 'pass_td', 'Pass TD', 'Passing touchdowns', FROM('pass_td')),
    col('passing', 'pass_int', 'INT', 'Interceptions thrown', FROM('pass_int')),
    col('passing', 'pass_sack', 'Sacked', 'Times sacked', FROM('pass_sack')),
  ],
  rushing: [
    col('rushing', 'rush_att', 'Car', 'Carries', FROM('rush_att')),
    col('rushing', 'rush_yd', 'Rush yd', 'Rushing yards', FROM('rush_yd')),
    col('rushing', 'rush_td', 'Rush TD', 'Rushing touchdowns', FROM('rush_td')),
  ],
  receiving: [
    col('receiving', 'rec_tgt', 'Tgt', 'Targets', FROM('rec_tgt')),
    col('receiving', 'rec', 'Rec', 'Receptions', FROM('rec')),
    col('receiving', 'rec_yd', 'Rec yd', 'Receiving yards', FROM('rec_yd')),
    col('receiving', 'rec_td', 'Rec TD', 'Receiving touchdowns', FROM('rec_td')),
  ],
  ballSecurity: [col('ballSecurity', 'fum_lost', 'Fum lost', 'Fumbles lost', FROM('fum_lost'))],
  defense: [
    col('defense', 'sack', 'Sacks', 'Sacks', FROM('sack')),
    col('defense', 'def_int', 'INT', 'Interceptions', FROM('def_int')),
    col('defense', 'fum_rec', 'FR', 'Fumble recoveries', FROM('fum_rec')),
    col('defense', 'def_td', 'TD', 'Defensive and special-teams touchdowns', (t) =>
      add(sum(t, 'def_td'), sum(t, 'def_st_td')),
    ),
    col(
      'defense',
      'pts_allow_pg',
      'Pts allowed / g',
      'Points allowed per game',
      (t) => {
        const total = sum(t, 'pts_allow')
        return total === null || t.games === 0 ? null : total / t.games
      },
      1,
    ),
  ],
}

/** Which groups a position shows, in order. `true` means always (primary); false only with activity. */
const LAYOUT: Record<string, Array<[StatGroup, boolean]>> = {
  QB: [
    ['passing', true],
    ['rushing', false],
    ['ballSecurity', false],
  ],
  RB: [
    ['rushing', true],
    ['receiving', true],
    ['ballSecurity', false],
  ],
  WR: [
    ['receiving', true],
    ['rushing', false],
    ['ballSecurity', false],
  ],
  TE: [
    ['receiving', true],
    ['rushing', false],
    ['ballSecurity', false],
  ],
  DEF: [['defense', true]],
}
/** A position we do not recognise (or none): every offensive group, each only with activity. */
const UNKNOWN_LAYOUT: Array<[StatGroup, boolean]> = [
  ['passing', false],
  ['rushing', false],
  ['receiving', false],
  ['ballSecurity', false],
]

/** The stat that says whether a secondary group had any activity at all. */
const ACTIVITY: Record<StatGroup, StatKey[]> = {
  passing: ['pass_att', 'pass_yd', 'pass_td'],
  rushing: ['rush_att', 'rush_yd', 'rush_td'],
  receiving: ['rec_tgt', 'rec', 'rec_yd', 'rec_td'],
  ballSecurity: ['fum_lost'],
  defense: ['sack', 'def_int', 'fum_rec', 'def_td', 'def_st_td'],
}

const played = (w: StatWeek) => typeof w.gp === 'number' && w.gp >= 1

/** Totals over played weeks only. */
export function sumStats(weeks: StatWeek[]): StatSums {
  const out: StatSums = { games: 0, sums: {} }
  for (const w of weeks) {
    if (!played(w)) continue
    out.games += 1
    for (const [k, v] of Object.entries(w.stats) as Array<[StatKey, number | null | undefined]>) {
      if (v === null || v === undefined) continue
      out.sums[k] = (out.sums[k] ?? 0) + v
    }
  }
  return out
}

/**
 * The column definitions for a position, in display order. The ONE place order is decided:
 * both the headers (`statColumns`) and the values (`playerStatTotals`) come from this list,
 * so they cannot disagree. (They once did: values were built in group order and headers in
 * layout order, which only differs for a receiver who also rushed.)
 */
function layoutDefs(position: string | null | undefined, career: StatSums): ColumnDef[] {
  const layout = (position && LAYOUT[position]) || UNKNOWN_LAYOUT
  const cols: ColumnDef[] = []
  for (const [group, primary] of layout) {
    const active = ACTIVITY[group].some((k) => (career.sums[k] ?? 0) !== 0)
    if (primary || active) cols.push(...GROUPS[group])
  }
  return cols
}

/** The columns for a position, given everything he has done (so secondary groups can be judged). */
export function statColumns(position: string | null | undefined, career: StatSums): StatColumn[] {
  return layoutDefs(position, career).map(({ value: _value, ...c }) => c)
}

export interface StatTableRow {
  games: number
  /** Aligned with `columns`. Null is unknown (no played week had a value). */
  values: Array<number | null>
}

export interface SeasonStatRow {
  season: number
  regular: StatTableRow
  playoff: StatTableRow
}

export interface PlayerStatTotals {
  columns: StatColumn[]
  seasons: SeasonStatRow[]
  career: { regular: StatTableRow; playoff: StatTableRow }
  /** Whether he has any playoff game at all, so a page can hide a toggle that would show nothing. */
  hasPlayoffGames: boolean
}

/**
 * Season rows plus a career row, each split into regular season and playoffs.
 *
 * Returns null when there is no stat row at all for the player, so the page says nothing
 * about stats rather than printing a table of dashes. Seasons run oldest first.
 */
export function playerStatTotals(
  weeks: StatWeek[],
  position: string | null | undefined,
): PlayerStatTotals | null {
  if (weeks.length === 0) return null
  // One week per season:week, so a stat row can never be counted twice.
  const byKey = new Map<string, StatWeek>()
  for (const w of weeks) byKey.set(`${w.season}:${w.week}`, w)
  const unique = [...byKey.values()]

  const careerAll = sumStats(unique)
  const defs = layoutDefs(position, careerAll)
  const row = (ws: StatWeek[]): StatTableRow => {
    const t = sumStats(ws)
    return { games: t.games, values: defs.map((d) => d.value(t)) }
  }

  const seasons = [...new Set(unique.map((w) => w.season))].sort((a, b) => a - b)
  return {
    columns: defs.map(({ value: _value, ...c }) => c),
    seasons: seasons.map((season) => {
      const ws = unique.filter((w) => w.season === season)
      return {
        season,
        regular: row(ws.filter((w) => !w.isPlayoff)),
        playoff: row(ws.filter((w) => w.isPlayoff)),
      }
    }),
    career: {
      regular: row(unique.filter((w) => !w.isPlayoff)),
      playoff: row(unique.filter((w) => w.isPlayoff)),
    },
    hasPlayoffGames: unique.some((w) => w.isPlayoff && played(w)),
  }
}

// ---------------------------------------------------------------------------
// The headline stat
// ---------------------------------------------------------------------------

export interface HeadlineStat {
  id: string
  /** Short label for a chart axis or a column. */
  label: string
  /** What it means, for a tooltip. */
  title: string
  /** One week's value from its stat map; null when he did not play (the stats are null). */
  value: (stats: StatMap | null | undefined) => number | null
}

const nv = (v: number | null | undefined) => (v === null || v === undefined ? null : v)

/**
 * The one number that best sums up a position's week, used where a single figure has to stand
 * for a stat line (the timeline's second metric; the players index in step 69): a quarterback's
 * passing yards, a running back's yards from scrimmage (rushing plus receiving), a receiver's or
 * tight end's receiving yards, a defense's sacks. Null for a position without one.
 *
 * It is only ever compared within a position. A quarterback's 300 and a receiver's 100 are not
 * the same size of thing, and nothing may rank them against each other.
 */
export function headlineStat(position: string | null | undefined): HeadlineStat | null {
  switch (position) {
    case 'QB':
      return {
        id: 'pass_yd',
        label: 'Pass yd',
        title: 'Passing yards',
        value: (s) => nv(s?.pass_yd),
      }
    case 'RB':
      return {
        id: 'scrimmage_yd',
        label: 'Scrimmage yd',
        title: 'Yards from scrimmage (rushing plus receiving)',
        value: (s) => add(nv(s?.rush_yd), nv(s?.rec_yd)),
      }
    case 'WR':
    case 'TE':
      return {
        id: 'rec_yd',
        label: 'Rec yd',
        title: 'Receiving yards',
        value: (s) => nv(s?.rec_yd),
      }
    case 'DEF':
      return { id: 'sack', label: 'Sacks', title: 'Sacks', value: (s) => nv(s?.sack) }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// The game log's stat cell
// ---------------------------------------------------------------------------

export type GameLogCell =
  { kind: 'line'; text: string } | { kind: 'did-not-play' } | { kind: 'unknown' }

/**
 * What a game-log row says in its stat column. A stat line prints as is. A week with no line is
 * "did not play" ONLY when its fantasy points were exactly 0: every rostered week on record with
 * no stat row scored 0, so that reading is safe there. Any other week with no line (one from
 * before stats were loaded, say) is **unknown** and prints a dash, so a gap can never read as an
 * answer about a week that was actually played.
 */
export function gameLogCell(statLine: string | null, points: number): GameLogCell {
  if (statLine) return { kind: 'line', text: statLine }
  return points === 0 ? { kind: 'did-not-play' } : { kind: 'unknown' }
}
