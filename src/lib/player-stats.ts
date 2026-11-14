/**
 * Weekly NFL stat lines for rostered players — yards, touchdowns, targets,
 * sacks — from Sleeper's `stats/nfl/regular/{season}/{week}`.
 *
 * Pure: no database, no network. `scripts/history/pull-sleeper.ts` uses
 * {@link trimStats} to cut Sleeper's response down before it is committed, and
 * `scripts/import-sleeper-history.ts` uses {@link statRows} to turn the
 * committed file into `player_week_stats` rows. See
 * `docs/archive/PLAYER_STATS_ROADMAP.md` for the decisions behind every rule here.
 *
 * ## Null is unknown, zero is a real zero
 *
 * Sleeper omits a key when its value is 0, so an absent `rush_yd` means "no
 * rushing yards" only for a player who actually played. The rule:
 *
 *  - an entry with `gp >= 1`: every absent whitelisted key in the player's
 *    group is a real **0**;
 *  - an entry with no `gp`, or `gp = 0` (inactive, on the roster but not on the
 *    field): **every stat NULL**, `gp` NULL. "Did not play" is not "played and
 *    gained nothing";
 *  - a rostered id with **no entry at all** (bye week, injured reserve, cut by
 *    his NFL team): **no row**.
 *
 * Checked against every rostered player-week from 2020 to 2026 week 9 when this
 * was built: no player missing from the stats file, or present without `gp`,
 * scored a single fantasy point. So the three cases really are the three
 * shapes of "played" and "didn't".
 *
 * ## Two groups, decided by the id
 *
 * A team defense is keyed by its bare abbreviation (`HOU`) — the same form
 * `player_weeks.player_id` uses — and every other player by a numeric Sleeper
 * id. Sleeper also publishes a `TEAM_HOU` entry holding the team's *offense*;
 * it is never rostered and never read.
 *
 * Defensive keys never occur on a player and offensive keys never occur on a
 * defense, so each id zero-fills only its own group and leaves the other NULL.
 * Zero-filling everything would give a receiver `pts_allow = 0`, and the
 * Oracle's "fewest points allowed" would return a WR.
 */

/** Offensive stats, for a numeric player id. Same names as Sleeper. */
export const OFFENSE_STAT_KEYS = [
  'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int', 'pass_sack', 'pass_2pt',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt',
  'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum', 'fum_lost',
] as const

/**
 * Team-defense stats, for a team-abbreviation id. Sleeper's names, except
 * `int`, which is stored as `def_int`: Postgres accepts a bare `int` column but
 * a model writing `SELECT int` beside `CAST(x AS int)` is one mistake away from
 * a type, and `def_int` reads unambiguously beside `pass_int`.
 */
export const DEFENSE_STAT_KEYS = [
  'sack', 'def_int', 'fum_rec', 'def_td', 'def_st_td', 'safe', 'pts_allow', 'yds_allow', 'blk_kick',
] as const

/** Every stored stat column, in table order. `gp` is separate. */
export const STAT_KEYS = [...OFFENSE_STAT_KEYS, ...DEFENSE_STAT_KEYS] as const

export type StatKey = (typeof STAT_KEYS)[number]
export type PlayerStats = Record<StatKey, number | null>

/** Our column name → Sleeper's key. Only the renamed ones. */
const SOURCE_KEY: Partial<Record<StatKey, string>> = { def_int: 'int' }
const sourceKey = (k: StatKey) => SOURCE_KEY[k] ?? k

/** Sleeper's keys worth committing: `gp` plus every whitelisted stat. */
const KEEP = new Set<string>(['gp', ...STAT_KEYS.map(sourceKey)])

/** One player's entry in Sleeper's weekly stats object. */
export type RawStatEntry = Record<string, number>
export type RawStatsWeek = Record<string, RawStatEntry>

/** A team defense: a bare two- or three-letter abbreviation, as rostered. */
export function isTeamDefenseId(id: string): boolean {
  return /^[A-Z]{2,3}$/.test(id)
}

/**
 * Cut a week of Sleeper's stats to what is committed: rostered ids only, `gp`
 * and whitelisted keys only, keys sorted so an unchanged week re-hashes
 * identically.
 *
 * An entry left with no keys is **kept** as `{}`. It still says "Sleeper had a
 * line for him and he did not play", which is a NULL row — dropping it would
 * turn that into "no row", a different fact.
 */
export function trimStats(raw: RawStatsWeek | null | undefined, rosteredIds: Iterable<string>): RawStatsWeek {
  const out: RawStatsWeek = {}
  if (!raw) return out
  for (const id of [...new Set(rosteredIds)].sort()) {
    const entry = raw[id]
    if (!entry) continue
    const kept: RawStatEntry = {}
    for (const k of Object.keys(entry).sort()) {
      if (KEEP.has(k) && typeof entry[k] === 'number') kept[k] = entry[k]
    }
    out[id] = kept
  }
  return out
}

export interface StatRow {
  season: number
  week: number
  playerId: string
  /** Games played, 1 or null. Never 0: a 0 is stored as "did not play". */
  gp: number | null
  stats: PlayerStats
}

const allNull = (): PlayerStats =>
  Object.fromEntries(STAT_KEYS.map((k) => [k, null])) as PlayerStats

/**
 * `player_week_stats` rows for one week. Only ids in `rosteredIds` produce a
 * row; see the header for what NULL and 0 mean.
 */
export function statRows(
  season: number,
  week: number,
  entries: RawStatsWeek | null | undefined,
  rosteredIds: Iterable<string>,
): StatRow[] {
  const rows: StatRow[] = []
  if (!entries) return rows
  for (const playerId of [...new Set(rosteredIds)].sort()) {
    const entry = entries[playerId]
    if (!entry) continue
    const stats = allNull()
    const played = typeof entry.gp === 'number' && entry.gp >= 1
    if (played) {
      const group = isTeamDefenseId(playerId) ? DEFENSE_STAT_KEYS : OFFENSE_STAT_KEYS
      for (const k of group) {
        const v = entry[sourceKey(k)]
        stats[k] = typeof v === 'number' ? v : 0
      }
    }
    rows.push({ season, week, playerId, gp: played ? entry.gp : null, stats })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const n = (v: number | null | undefined) => (v == null ? 0 : Number(v))
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/**
 * One line a person can read: `23/31, 287 yds, 2 TD, 1 INT`.
 *
 * Groups on the player's **position**, never the lineup slot — a WR in FLEX is a
 * WR. A secondary group that is all zero is left out rather than printed as
 * "0 car"; the position's own group always prints for a player who played.
 * Returns **null** when the player did not play (stats NULL), never
 * `0/0, 0 yds`, and null when there is nothing to say.
 *
 * Kickers are not handled: the league has never had a K slot and has never
 * rostered a kicker, so no kicking stats are stored.
 */
export function formatStatLine(
  position: string | null | undefined,
  stats: Partial<Record<StatKey, number | null>> | null | undefined,
): string | null {
  if (!stats) return null
  const isDef = position === 'DEF'
  const groupKeys = isDef ? DEFENSE_STAT_KEYS : OFFENSE_STAT_KEYS
  // Every value in the player's group NULL means "did not play".
  if (groupKeys.every((k) => stats[k] == null)) return null
  const s = (k: StatKey) => n(stats[k])

  const parts: string[] = []
  // `primary` is the position's own group: printed even when it is all zero,
  // because a receiver who played and was shut out is a real line, and leaving
  // it blank would read exactly like a player who did not play.
  const passing = (primary = false) => {
    if (!primary && s('pass_att') === 0) return
    const bits = [`${fmt(s('pass_cmp'))}/${fmt(s('pass_att'))}`, `${fmt(s('pass_yd'))} yds`]
    if (s('pass_td')) bits.push(`${fmt(s('pass_td'))} TD`)
    if (s('pass_int')) bits.push(`${fmt(s('pass_int'))} INT`)
    parts.push(bits.join(', '))
  }
  const rushing = (primary = false) => {
    if (!primary && s('rush_att') === 0 && s('rush_yd') === 0 && s('rush_td') === 0) return
    const bits = [`${fmt(s('rush_att'))} car`, `${fmt(s('rush_yd'))} yds`]
    if (s('rush_td')) bits.push(`${fmt(s('rush_td'))} TD`)
    parts.push(bits.join(', '))
  }
  const receiving = (withTargets: boolean, primary = false) => {
    if (!primary && s('rec') === 0 && s('rec_yd') === 0 && s('rec_td') === 0 && (!withTargets || s('rec_tgt') === 0)) return
    const head = withTargets ? `${fmt(s('rec'))} rec / ${fmt(s('rec_tgt'))} tgt` : `${fmt(s('rec'))} rec`
    const bits = [head, `${fmt(s('rec_yd'))} yds`]
    if (s('rec_td')) bits.push(`${fmt(s('rec_td'))} TD`)
    parts.push(bits.join(', '))
  }

  switch (position) {
    case 'QB':
      passing(true)
      rushing()
      break
    case 'RB':
      rushing(true)
      receiving(false)
      break
    case 'WR':
    case 'TE':
      receiving(true, true)
      rushing()
      break
    case 'DEF': {
      const bits: string[] = []
      if (s('sack')) bits.push(`${fmt(s('sack'))} ${s('sack') === 1 ? 'sack' : 'sacks'}`)
      if (s('def_int')) bits.push(`${fmt(s('def_int'))} INT`)
      if (s('fum_rec')) bits.push(`${fmt(s('fum_rec'))} FR`)
      const tds = s('def_td') + s('def_st_td')
      if (tds) bits.push(`${fmt(tds)} TD`)
      if (s('safe')) bits.push(`${fmt(s('safe'))} SAF`)
      // Points allowed is always worth saying for a defense that played: a
      // shutout is the best line a defense can have, not an empty one.
      bits.push(`${fmt(s('pts_allow'))} allowed`)
      parts.push(bits.join(', '))
      break
    }
    default:
      passing()
      rushing()
      receiving(true)
  }

  return parts.length ? parts.join(' · ') : null
}
