import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFENSE_STAT_KEYS,
  OFFENSE_STAT_KEYS,
  STAT_KEYS,
  formatStatLine,
  isTeamDefenseId,
  statRows,
  trimStats,
  type PlayerStats,
  type RawStatsWeek,
} from './player-stats'

const week: RawStatsWeek = {
  // played: a running back with carries but no catches
  '4034': { gp: 1, rush_att: 18, rush_yd: 94, rush_td: 1, pts_ppr: 15.4, pos_rank_ppr: 3, off_snp: 50 },
  // on the active list, never took the field
  '6803': { gms_active: 1, pos_rank_ppr: 999 },
  // gp present but zero
  '9229': { gp: 0, rush_yd: 0 },
  // a defense that pitched a shutout
  BAL: { gp: 1, sack: 4, int: 2, pts_ppr: 18 },
  // the team's offense, published beside the defense and never rostered
  TEAM_BAL: { gp: 1, pass_yd: 209 },
  // not on any roster in this league
  '99999': { gp: 1, rec: 7 },
}

const rostered = ['4034', '6803', '9229', 'BAL', '1111']
const byId = (rows: ReturnType<typeof statRows>) => new Map(rows.map((r) => [r.playerId, r]))

describe('statRows — null is unknown, zero is a real zero', () => {
  const rows = byId(statRows(2025, 1, week, rostered))

  it('a player who played: absent keys in his group are real zeros', () => {
    const r = rows.get('4034')!
    expect(r.gp).toBe(1)
    expect(r.stats.rush_yd).toBe(94)
    expect(r.stats.rec).toBe(0)
    expect(r.stats.pass_yd).toBe(0)
    for (const k of OFFENSE_STAT_KEYS) expect(r.stats[k]).not.toBeNull()
  })

  it('a player who played: the defense group stays null, not zero', () => {
    const r = rows.get('4034')!
    for (const k of DEFENSE_STAT_KEYS) expect(r.stats[k]).toBeNull()
  })

  it('an entry with no gp is "did not play" — every stat null', () => {
    const r = rows.get('6803')!
    expect(r.gp).toBeNull()
    for (const k of STAT_KEYS) expect(r.stats[k]).toBeNull()
  })

  it('gp = 0 is "did not play" too, and gp is stored null rather than 0', () => {
    const r = rows.get('9229')!
    expect(r.gp).toBeNull()
    for (const k of STAT_KEYS) expect(r.stats[k]).toBeNull()
  })

  it('a rostered id with no entry at all gets no row', () => {
    expect(rows.has('1111')).toBe(false)
  })

  it('an id nobody rostered gets no row', () => {
    expect(rows.has('99999')).toBe(false)
    expect(rows.has('TEAM_BAL')).toBe(false)
  })

  it('a defense fills its own group, renames int to def_int, and leaves offense null', () => {
    const r = rows.get('BAL')!
    expect(r.stats.sack).toBe(4)
    expect(r.stats.def_int).toBe(2)
    expect(r.stats.pts_allow).toBe(0) // a shutout, not unknown
    for (const k of OFFENSE_STAT_KEYS) expect(r.stats[k]).toBeNull()
  })

  it('drops keys that are not whitelisted', () => {
    const r = rows.get('4034')!
    expect(Object.keys(r.stats).sort()).toEqual([...STAT_KEYS].sort())
    expect(r.stats).not.toHaveProperty('pts_ppr')
    expect(r.stats).not.toHaveProperty('off_snp')
  })

  it('empty and null weeks produce nothing', () => {
    expect(statRows(2026, 17, {}, rostered)).toEqual([])
    expect(statRows(2026, 17, null, rostered)).toEqual([])
  })
})

describe('trimStats — what gets committed', () => {
  const trimmed = trimStats(week, rostered)

  it('keeps rostered ids only', () => {
    expect(Object.keys(trimmed).sort()).toEqual(['4034', '6803', '9229', 'BAL'])
  })

  it('keeps gp and whitelisted keys, under Sleeper names', () => {
    expect(trimmed['4034']).toEqual({ gp: 1, rush_att: 18, rush_td: 1, rush_yd: 94 })
    expect(trimmed.BAL).toEqual({ gp: 1, int: 2, sack: 4 })
  })

  it('keeps an entry that trims to nothing, because it still means "did not play"', () => {
    expect(trimmed['6803']).toEqual({})
    expect(byId(statRows(2025, 1, trimmed, rostered)).get('6803')!.gp).toBeNull()
  })

  it('round-trips: statRows over the trimmed file equals statRows over the raw one', () => {
    expect(statRows(2025, 1, trimmed, rostered)).toEqual(statRows(2025, 1, week, rostered))
  })

  it('is stable — keys sorted, so an unchanged week re-hashes identically', () => {
    expect(JSON.stringify(trimStats(week, [...rostered].reverse()))).toBe(JSON.stringify(trimmed))
  })
})

describe('isTeamDefenseId', () => {
  it('matches a bare abbreviation and nothing else', () => {
    expect(isTeamDefenseId('HOU')).toBe(true)
    expect(isTeamDefenseId('GB')).toBe(true)
    expect(isTeamDefenseId('TEAM_HOU')).toBe(false)
    expect(isTeamDefenseId('4034')).toBe(false)
  })
})

const line = (pos: string, s: Partial<PlayerStats>) => {
  const full = Object.fromEntries(
    (pos === 'DEF' ? DEFENSE_STAT_KEYS : OFFENSE_STAT_KEYS).map((k) => [k, 0]),
  ) as Partial<PlayerStats>
  return formatStatLine(pos, { ...full, ...s })
}

describe('formatStatLine', () => {
  it('QB', () => {
    expect(line('QB', { pass_cmp: 23, pass_att: 31, pass_yd: 287, pass_td: 2, pass_int: 1 })).toBe(
      '23/31, 287 yds, 2 TD, 1 INT',
    )
  })

  it('QB who also ran', () => {
    expect(line('QB', { pass_cmp: 20, pass_att: 30, pass_yd: 250, rush_att: 6, rush_yd: 41, rush_td: 1 })).toBe(
      '20/30, 250 yds · 6 car, 41 yds, 1 TD',
    )
  })

  it('RB', () => {
    expect(line('RB', { rush_att: 18, rush_yd: 94, rush_td: 1, rec: 3, rec_yd: 21, rec_tgt: 4 })).toBe(
      '18 car, 94 yds, 1 TD · 3 rec, 21 yds',
    )
  })

  it('WR, with no "0 car"', () => {
    expect(line('WR', { rec: 7, rec_tgt: 10, rec_yd: 98, rec_td: 1 })).toBe('7 rec / 10 tgt, 98 yds, 1 TD')
  })

  it('TE', () => {
    expect(line('TE', { rec: 4, rec_tgt: 5, rec_yd: 38 })).toBe('4 rec / 5 tgt, 38 yds')
  })

  it('a receiver who played and was shut out still has a line', () => {
    expect(line('WR', {})).toBe('0 rec / 0 tgt, 0 yds')
  })

  it('DEF', () => {
    expect(line('DEF', { sack: 3, def_int: 1, pts_allow: 17 })).toBe('3 sacks, 1 INT, 17 allowed')
    expect(line('DEF', { sack: 1, pts_allow: 0 })).toBe('1 sack, 0 allowed')
  })

  it('groups on position, so an RB never prints as a receiver first', () => {
    expect(line('RB', { rec: 5, rec_yd: 40, rec_tgt: 6 })).toBe('0 car, 0 yds · 5 rec, 40 yds')
  })

  it('returns null — never zeros — for a player who did not play', () => {
    const [inactive] = statRows(2025, 1, { '1': {} }, ['1'])
    expect(formatStatLine('WR', inactive.stats)).toBeNull()
    expect(formatStatLine('QB', inactive.stats)).toBeNull()
    expect(formatStatLine('DEF', statRows(2025, 1, { HOU: {} }, ['HOU'])[0].stats)).toBeNull()
    expect(formatStatLine('RB', null)).toBeNull()
  })
})

describe('the committed stats files', () => {
  // Pins the id forms against real data: a defense is rostered as a bare
  // abbreviation and that is the key its defensive stats live under.
  it('2025 week 1: every rostered DEF has a line under its bare abbreviation', () => {
    const dir = join(process.cwd(), 'data', 'sleeper', '2025')
    const stats = JSON.parse(readFileSync(join(dir, 'stats-01.json'), 'utf8')) as RawStatsWeek
    const matchups = JSON.parse(readFileSync(join(dir, 'matchups-01.json'), 'utf8')) as Array<{ players: string[] }>
    const defs = matchups.flatMap((m) => m.players).filter(isTeamDefenseId)
    expect(defs.length).toBe(10)
    for (const d of defs) expect(stats[d]?.gp).toBe(1)
  })
})
