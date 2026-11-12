import { describe, expect, it } from 'vitest'
import {
  gameLogCell,
  headlineStat,
  playerStatTotals,
  seasonStatLine,
  statColumns,
  sumStats,
  type StatWeek,
} from './player-stat-totals'

/** A played week with the given stats; unmentioned keys are 0 in the player's own group. */
const wr = (
  season: number,
  week: number,
  s: Record<string, number> = {},
  isPlayoff = false,
): StatWeek => ({
  season,
  week,
  isPlayoff,
  gp: 1,
  stats: {
    rec_tgt: 0,
    rec: 0,
    rec_yd: 0,
    rec_td: 0,
    rush_att: 0,
    rush_yd: 0,
    rush_td: 0,
    pass_att: 0,
    pass_yd: 0,
    pass_td: 0,
    fum_lost: 0,
    ...s,
  },
})
const dnp = (season: number, week: number, isPlayoff = false): StatWeek => ({
  season,
  week,
  isPlayoff,
  gp: null,
  stats: { rec: null, rec_yd: null, rec_tgt: null, rec_td: null },
})
const idx = (t: NonNullable<ReturnType<typeof playerStatTotals>>, id: string) =>
  t.columns.findIndex((c) => c.id === id)

describe('sumStats', () => {
  it('counts only played weeks, and a week with null gp is not a game', () => {
    const s = sumStats([
      wr(2024, 1, { rec: 5, rec_yd: 60 }),
      dnp(2024, 2),
      wr(2024, 3, { rec: 3, rec_yd: 30 }),
    ])
    expect(s.games).toBe(2)
    expect(s.sums.rec).toBe(8)
    expect(s.sums.rec_yd).toBe(90)
  })

  it('a played week with no catches is a game and a real 0', () => {
    const s = sumStats([wr(2024, 1, {}), wr(2024, 2, { rec: 4 })])
    expect(s.games).toBe(2)
    expect(s.sums.rec).toBe(4)
    const shutout = sumStats([wr(2024, 1, {})])
    expect(shutout.games).toBe(1)
    expect(shutout.sums.rec).toBe(0)
  })

  it('a stat no played week had a value for totals to null, not 0', () => {
    const s = sumStats([wr(2024, 1, { rec: 5 })])
    expect(s.sums.sack).toBeUndefined()
  })

  it('a did-not-play week contributes nothing even if it carried values', () => {
    const odd: StatWeek = { season: 2024, week: 1, isPlayoff: false, gp: null, stats: { rec: 99 } }
    expect(sumStats([odd]).sums.rec).toBeUndefined()
  })
})

describe('statColumns', () => {
  const none = { games: 0, sums: {} }
  const ids = (p: string | null, career = none) => statColumns(p, career).map((c) => c.id)

  it('gives a receiver receiving columns and no rushing unless he rushed', () => {
    expect(ids('WR')).toEqual(['rec_tgt', 'rec', 'rec_yd', 'rec_td'])
    expect(ids('WR', { games: 3, sums: { rush_att: 2, rush_yd: 9 } })).toEqual([
      'rec_tgt',
      'rec',
      'rec_yd',
      'rec_td',
      'rush_att',
      'rush_yd',
      'rush_td',
    ])
  })

  it('gives a defence its own group and nothing offensive', () => {
    expect(ids('DEF')).toEqual(['sack', 'def_int', 'fum_rec', 'def_td', 'pts_allow_pg'])
  })

  it('never gives a position another position’s primary columns', () => {
    expect(ids('QB')).not.toContain('rec')
    expect(ids('RB')).not.toContain('pass_yd')
    expect(ids('WR')).not.toContain('pass_yd')
    expect(ids('DEF')).not.toContain('rec_yd')
  })

  it('a quarterback has passing columns, and rushing only with activity', () => {
    expect(ids('QB')).toContain('pass_yd')
    expect(ids('QB')).not.toContain('rush_yd')
    expect(ids('QB', { games: 4, sums: { rush_att: 20 } })).toContain('rush_yd')
  })

  it('an unknown position shows only the groups with activity', () => {
    expect(ids(null)).toEqual([])
    expect(ids(null, { games: 2, sums: { rec: 5 } })).toEqual([
      'rec_tgt',
      'rec',
      'rec_yd',
      'rec_td',
    ])
  })
})

describe('playerStatTotals', () => {
  const weeks = [
    wr(2023, 1, { rec_tgt: 9, rec: 6, rec_yd: 80, rec_td: 1 }),
    dnp(2023, 2),
    wr(2023, 3, { rec_tgt: 7, rec: 5, rec_yd: 70 }),
    wr(2023, 15, { rec_tgt: 10, rec: 8, rec_yd: 110, rec_td: 2 }, true),
    wr(2024, 1, { rec_tgt: 5, rec: 2, rec_yd: 20 }),
  ]
  const t = playerStatTotals(weeks, 'WR')!

  it('totals a season, counting games and skipping the week he did not play', () => {
    const s = t.seasons.find((x) => x.season === 2023)!
    expect(s.regular.games).toBe(2)
    expect(s.regular.values[idx(t, 'rec_tgt')]).toBe(16)
    expect(s.regular.values[idx(t, 'rec_yd')]).toBe(150)
    expect(s.regular.values[idx(t, 'rec_td')]).toBe(1)
  })

  it('splits regular season from playoffs on the flag, not on a hardcoded week', () => {
    const s = t.seasons.find((x) => x.season === 2023)!
    expect(s.playoff.games).toBe(1)
    expect(s.playoff.values[idx(t, 'rec_yd')]).toBe(110)
    expect(t.hasPlayoffGames).toBe(true)
  })

  it('a career row adds the seasons up', () => {
    expect(t.career.regular.games).toBe(3)
    expect(t.career.regular.values[idx(t, 'rec_yd')]).toBe(170)
    expect(t.career.playoff.values[idx(t, 'rec_td')]).toBe(2)
  })

  it('lists seasons oldest first and returns one row per season', () => {
    expect(t.seasons.map((s) => s.season)).toEqual([2023, 2024])
  })

  it('a season with no playoff game has 0 games and null stats there, not zeros', () => {
    const s = t.seasons.find((x) => x.season === 2024)!
    expect(s.playoff.games).toBe(0)
    expect(s.playoff.values.every((v) => v === null)).toBe(true)
  })

  it('counts a repeated season:week once', () => {
    const again = playerStatTotals([wr(2023, 1, { rec: 6 }), wr(2023, 1, { rec: 6 })], 'WR')!
    expect(again.career.regular.games).toBe(1)
  })

  it('returns null for a player with no stat rows', () => {
    expect(playerStatTotals([], 'WR')).toBeNull()
  })

  it('a player who never played in the span has games 0 and no totals, not zeros', () => {
    const only = playerStatTotals([dnp(2024, 1), dnp(2024, 2)], 'WR')!
    expect(only.career.regular.games).toBe(0)
    expect(only.career.regular.values.every((v) => v === null)).toBe(true)
  })

  it('points allowed per game is the total over games, and null with no games', () => {
    const d = (week: number, allow: number): StatWeek => ({
      season: 2024,
      week,
      isPlayoff: false,
      gp: 1,
      stats: { sack: 3, def_int: 1, fum_rec: 0, def_td: 0, def_st_td: 0, pts_allow: allow },
    })
    const def = playerStatTotals([d(1, 10), d(2, 21)], 'DEF')!
    expect(def.career.regular.values[idx(def, 'pts_allow_pg')]).toBeCloseTo(15.5, 9)
    expect(def.career.regular.values[idx(def, 'sack')]).toBe(6)
  })

  it('adds a special-teams touchdown to the defensive one', () => {
    const d: StatWeek = {
      season: 2024,
      week: 1,
      isPlayoff: false,
      gp: 1,
      stats: { sack: 0, def_int: 0, fum_rec: 0, def_td: 1, def_st_td: 1, pts_allow: 7 },
    }
    const def = playerStatTotals([d], 'DEF')!
    expect(def.career.regular.values[idx(def, 'def_td')]).toBe(2)
  })
})

describe('values stay under the right headers', () => {
  // A receiver who also rushed: the layout puts receiving first and rushing second, which is
  // NOT the order the column groups are declared in. Each value must sit under its own header.
  const weeks = [
    wr(2023, 1, {
      rec_tgt: 9,
      rec: 6,
      rec_yd: 80,
      rec_td: 1,
      rush_att: 2,
      rush_yd: 11,
      rush_td: 0,
    }),
    wr(2023, 2, { rec_tgt: 7, rec: 5, rec_yd: 70, rec_td: 0, rush_att: 1, rush_yd: 4, rush_td: 1 }),
  ]
  const t = playerStatTotals(weeks, 'WR')!
  const at = (id: string) => t.career.regular.values[t.columns.findIndex((c) => c.id === id)]

  it('a receiver who rushed has receiving columns first', () => {
    expect(t.columns.map((c) => c.id).slice(0, 4)).toEqual(['rec_tgt', 'rec', 'rec_yd', 'rec_td'])
  })
  it('puts every total under its own header', () => {
    expect(at('rec_tgt')).toBe(16)
    expect(at('rec')).toBe(11)
    expect(at('rec_yd')).toBe(150)
    expect(at('rec_td')).toBe(1)
    expect(at('rush_att')).toBe(3)
    expect(at('rush_yd')).toBe(15)
    expect(at('rush_td')).toBe(1)
  })
  it('has exactly one value per column, for every row', () => {
    for (const s of t.seasons) {
      expect(s.regular.values).toHaveLength(t.columns.length)
      expect(s.playoff.values).toHaveLength(t.columns.length)
    }
  })
})

describe('headlineStat', () => {
  it('is one position-appropriate number', () => {
    expect(headlineStat('QB')!.value({ pass_yd: 287 })).toBe(287)
    expect(headlineStat('RB')!.value({ rush_yd: 80, rec_yd: 25 })).toBe(105)
    expect(headlineStat('WR')!.value({ rec_yd: 143 })).toBe(143)
    expect(headlineStat('TE')!.value({ rec_yd: 61 })).toBe(61)
    expect(headlineStat('DEF')!.value({ sack: 4 })).toBe(4)
  })

  it('is null for a week he did not play, never 0', () => {
    expect(headlineStat('QB')!.value({ pass_yd: null })).toBeNull()
    expect(headlineStat('RB')!.value({ rush_yd: null, rec_yd: null })).toBeNull()
    expect(headlineStat('WR')!.value({})).toBeNull()
    expect(headlineStat('WR')!.value(null)).toBeNull()
  })

  it('a played week with no yards is a real 0', () => {
    expect(headlineStat('WR')!.value({ rec_yd: 0 })).toBe(0)
    expect(headlineStat('RB')!.value({ rush_yd: 0, rec_yd: 0 })).toBe(0)
  })

  it('has none for a position it does not know, and never mixes positions', () => {
    expect(headlineStat('K')).toBeNull()
    expect(headlineStat(null)).toBeNull()
    // A receiver's headline never reads a passing or rushing figure.
    expect(headlineStat('WR')!.value({ pass_yd: 300, rush_yd: 90, rec_yd: 10 })).toBe(10)
    expect(headlineStat('QB')!.value({ rec_yd: 50, pass_yd: 200 })).toBe(200)
  })
})

describe('gameLogCell', () => {
  it('prints a stat line as it is', () => {
    expect(gameLogCell('6 rec / 9 tgt, 80 yds, 1 TD', 14.5)).toEqual({
      kind: 'line',
      text: '6 rec / 9 tgt, 80 yds, 1 TD',
    })
  })

  it('says "did not play" only for a week with no line and exactly 0 points', () => {
    expect(gameLogCell(null, 0)).toEqual({ kind: 'did-not-play' })
  })

  it('never says "did not play" for a week with points: that is unknown, a dash', () => {
    expect(gameLogCell(null, 12.4)).toEqual({ kind: 'unknown' })
    expect(gameLogCell(null, -1.2)).toEqual({ kind: 'unknown' })
  })

  it('a line wins even at 0 points (a played week that scored nothing)', () => {
    expect(gameLogCell('0 rec / 2 tgt, 0 yds', 0).kind).toBe('line')
  })
})

describe('seasonStatLine', () => {
  it("prints the position's own line with the games on the end", () => {
    expect(
      seasonStatLine(
        'WR',
        { rec_tgt: 131, rec: 96, rec_yd: 1253, rec_td: 8, rush_att: 0, rush_yd: 0, rush_td: 0 },
        13,
      ),
    ).toBe('96 rec / 131 tgt, 1253 yds, 8 TD · 13 g')
  })

  it('is null with no games, never a row of zeros', () => {
    expect(seasonStatLine('WR', { rec: 0, rec_yd: 0 }, 0)).toBeNull()
  })

  it('is null when there are no stats to print', () => {
    expect(seasonStatLine('WR', {}, 5)).toBeNull()
  })
})
