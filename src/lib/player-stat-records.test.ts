import { describe, expect, it } from 'vitest'
import { playerStatRecords, type StatRecordWeek } from './player-stat-records'

const keys = new Set(Array.from({ length: 14 }, (_, i) => `2024:${i + 1}`))
let n = 0
const wk = (o: Partial<StatRecordWeek> & { stats: StatRecordWeek['stats'] }): StatRecordWeek => ({
  season: 2024,
  week: 1,
  managerId: 1,
  playerId: `p${++n}`,
  playerName: `Player ${n}`,
  position: 'WR',
  isStarter: true,
  gp: 1,
  ...o,
})
const find = (r: ReturnType<typeof playerStatRecords>, pos: string, key: string) =>
  r.find((p) => p.position === pos)!.lists.find((l) => l.key === `${pos}:${key}`)!

describe('playerStatRecords', () => {
  it('is inside one position: a list holds only that position', () => {
    const r = playerStatRecords(
      [
        wk({ position: 'QB', playerId: 'q', stats: { pass_yd: 400 } }),
        wk({ position: 'WR', playerId: 'w', stats: { rec_yd: 150 } }),
        wk({ position: 'TE', playerId: 't', stats: { rec_yd: 90 } }),
      ],
      keys,
    )
    for (const p of r)
      for (const l of p.lists) for (const e of l.entries) expect(e.position).toBe(p.position)
    // The QB's 400 yards never appears in any receiving list.
    expect(find(r, 'WR', 'rec_yd_game').entries.map((e) => e.playerId)).toEqual(['w'])
    expect(find(r, 'TE', 'rec_yd_game').entries.map((e) => e.playerId)).toEqual(['t'])
  })

  it('single-game lists count started weeks only', () => {
    const r = playerStatRecords(
      [
        wk({ playerId: 'bench', isStarter: false, stats: { rec_yd: 220 } }),
        wk({ playerId: 'start', isStarter: true, stats: { rec_yd: 120 } }),
      ],
      keys,
    )
    expect(find(r, 'WR', 'rec_yd_game').entries.map((e) => e.playerId)).toEqual(['start'])
  })

  it('season lists total over played weeks, benched or started', () => {
    const r = playerStatRecords(
      [
        wk({ playerId: 'a', week: 1, isStarter: false, stats: { rec_yd: 100 } }),
        wk({ playerId: 'a', week: 2, isStarter: true, stats: { rec_yd: 50 } }),
      ],
      keys,
    )
    const e = find(r, 'WR', 'rec_yd_season').entries[0]
    expect(e.value).toBe(150)
    expect(e.detail).toBe('2 games')
  })

  it('never counts a week he did not play', () => {
    const r = playerStatRecords(
      [
        wk({ playerId: 'a', week: 1, stats: { rec_yd: 80 } }),
        wk({ playerId: 'a', week: 2, gp: null, stats: { rec_yd: 999 } }),
      ],
      keys,
    )
    expect(find(r, 'WR', 'rec_yd_season').entries[0]).toMatchObject({ value: 80, detail: '1 game' })
    expect(find(r, 'WR', 'rec_yd_game').entries.map((e) => e.value)).toEqual([80])
  })

  it('splits a season by manager: each entry has one holder and only his weeks', () => {
    const r = playerStatRecords(
      [
        wk({ playerId: 'a', week: 1, managerId: 1, stats: { rec_yd: 60 } }),
        wk({ playerId: 'a', week: 2, managerId: 2, stats: { rec_yd: 100 } }),
      ],
      keys,
    )
    expect(find(r, 'WR', 'rec_yd_season').entries.map((e) => [e.managerId, e.value])).toEqual([
      [2, 100],
      [1, 60],
    ])
  })

  it('yards from scrimmage adds rushing and receiving for a running back', () => {
    const r = playerStatRecords(
      [wk({ position: 'RB', playerId: 'rb', stats: { rush_yd: 90, rec_yd: 40 } })],
      keys,
    )
    expect(find(r, 'RB', 'scrimmage_yd_season').entries[0].value).toBe(130)
  })

  it('fewest points allowed ranks ascending and only among starters', () => {
    const r = playerStatRecords(
      [
        wk({ position: 'DEF', playerId: 'D1', week: 1, stats: { pts_allow: 17 } }),
        wk({ position: 'DEF', playerId: 'D2', week: 2, stats: { pts_allow: 3 } }),
        wk({ position: 'DEF', playerId: 'D3', week: 3, isStarter: false, stats: { pts_allow: 0 } }),
      ],
      keys,
    )
    expect(find(r, 'DEF', 'pts_allow_game').entries.map((e) => e.value)).toEqual([3, 17])
  })

  it('a game entry carries the stat line behind it', () => {
    const r = playerStatRecords(
      [wk({ playerId: 'w', stats: { rec_tgt: 9, rec: 7, rec_yd: 150, rec_td: 2 } })],
      keys,
    )
    expect(find(r, 'WR', 'rec_yd_game').entries[0].detail).toContain('150 yds')
  })

  it('a tie keeps the earliest row', () => {
    const r = playerStatRecords(
      [
        wk({ playerId: 'first', week: 1, stats: { rec_yd: 100 } }),
        wk({ playerId: 'second', week: 2, stats: { rec_yd: 100 } }),
      ],
      keys,
    )
    expect(find(r, 'WR', 'rec_yd_game').entries[0].playerId).toBe('first')
  })

  it('only counts weeks in the key set', () => {
    const r = playerStatRecords(
      [wk({ week: 16, stats: { rec_yd: 300 } }), wk({ week: 2, stats: { rec_yd: 50 } })],
      keys,
    )
    expect(find(r, 'WR', 'rec_yd_game').entries.map((e) => e.value)).toEqual([50])
  })

  it('returns nothing for no data, and has no list for a position with no played weeks', () => {
    expect(playerStatRecords([], keys)).toEqual([])
    const r = playerStatRecords([wk({ position: 'QB', stats: { pass_yd: 100 } })], keys)
    expect(r.map((p) => p.position)).toEqual(['QB'])
  })
})
