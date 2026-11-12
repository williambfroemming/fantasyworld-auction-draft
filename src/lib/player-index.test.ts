import { describe, expect, it } from 'vitest'
import { playerIndexView, type IndexFilters, type IndexPlayer } from './player-index'

const player = (
  id: string,
  position: string,
  points: number,
  seasons: Array<[number, number, number | null]>,
): IndexPlayer => ({
  playerId: id,
  playerName: `Player ${id}`,
  position,
  firstSeason: 2023,
  lastSeason: 2024,
  points,
  topPrice: null,
  seasons: seasons.map(([season, pts, headline]) => ({
    season,
    points: pts,
    games: headline === null ? 0 : 10,
    headline,
  })),
})
const f = (o: Partial<IndexFilters> = {}): IndexFilters => ({
  query: '',
  position: null,
  season: null,
  sort: 'points',
  ...o,
})

const players = [
  player('qb1', 'QB', 300, [[2023, 300, 4100]]),
  player('qb2', 'QB', 250, [[2023, 250, 4500]]),
  player('wr1', 'WR', 280, [[2023, 280, 1300]]),
  player('wr2', 'WR', 200, [
    [2023, 150, 900],
    [2024, 50, 400],
  ]),
  player('wr3', 'WR', 100, [[2024, 100, null]]),
]
const ids = (v: ReturnType<typeof playerIndexView>) => v.rows.map((r) => r.player.playerId)

describe('a stat is only ranked inside one position', () => {
  it('offers no stat column or stat sort with All selected', () => {
    const v = playerIndexView(players, f())
    expect(v.canSortByStat).toBe(false)
    expect(v.statLabel).toBeNull()
    expect(v.rows.every((r) => r.stat === null)).toBe(true)
  })

  it('a requested stat sort with All selected falls back to points', () => {
    const v = playerIndexView(players, f({ sort: 'stat' }))
    expect(v.sort).toBe('points')
    expect(ids(v)).toEqual(['qb1', 'wr1', 'qb2', 'wr2', 'wr3'])
  })

  it('never orders a mixed-position list by a stat (QB yards would beat every receiver)', () => {
    const v = playerIndexView(players, f({ sort: 'stat' }))
    // By passing yards qb2 (4500) would lead; by points qb1 does. The list is by points.
    expect(ids(v)[0]).toBe('qb1')
  })

  it('with one position selected, the stat sort is offered and orders within it', () => {
    const v = playerIndexView(players, f({ position: 'QB', sort: 'stat' }))
    expect(v.canSortByStat).toBe(true)
    expect(v.statLabel).toBe('Pass yd')
    expect(ids(v)).toEqual(['qb2', 'qb1'])
  })

  it('contains only the selected position', () => {
    const v = playerIndexView(players, f({ position: 'WR' }))
    expect(v.rows.every((r) => r.player.position === 'WR')).toBe(true)
  })

  it('offers no stat for a position that has no headline stat', () => {
    expect(playerIndexView(players, f({ position: 'K' })).canSortByStat).toBe(false)
  })
})

describe('seasons and unknowns', () => {
  it("a season picked keeps only players rostered that season, with that season's points", () => {
    const v = playerIndexView(players, f({ season: 2024 }))
    expect(ids(v).sort()).toEqual(['wr2', 'wr3'])
    expect(v.rows.find((r) => r.player.playerId === 'wr2')!.points).toBe(50)
  })

  it('the stat is over the season picked, or all seasons when none is', () => {
    const one = playerIndexView(players, f({ position: 'WR', season: 2023 }))
    expect(one.rows.find((r) => r.player.playerId === 'wr2')!.stat).toBe(900)
    const all = playerIndexView(players, f({ position: 'WR' }))
    expect(all.rows.find((r) => r.player.playerId === 'wr2')!.stat).toBe(1300)
  })

  it('a player with no stat is unknown, shown as null and sorted last, never as 0', () => {
    const v = playerIndexView(players, f({ position: 'WR', sort: 'stat' }))
    expect(ids(v)).toEqual(['wr1', 'wr2', 'wr3'])
    expect(v.rows[2].stat).toBeNull()
  })

  it('searches by name and combines with the filters', () => {
    expect(ids(playerIndexView(players, f({ query: 'wr2' })))).toEqual(['wr2'])
    expect(ids(playerIndexView(players, f({ query: 'player', position: 'QB' })))).toEqual([
      'qb1',
      'qb2',
    ])
  })

  it('keeps the all-time points when no season is picked', () => {
    expect(
      playerIndexView(players, f()).rows.find((r) => r.player.playerId === 'wr2')!.points,
    ).toBe(200)
  })

  it('breaks a tie on points then name, so the order is stable', () => {
    const t = [player('b', 'WR', 10, [[2023, 10, 5]]), player('a', 'WR', 10, [[2023, 10, 5]])]
    expect(ids(playerIndexView(t, f({ position: 'WR', sort: 'stat' })))).toEqual(['a', 'b'])
  })
})
