import { describe, expect, it } from 'vitest'
import { playerRecords, type GameResult, type PlayerWeekRow } from './player-records'

const keys = (...w: number[]) => new Set(w.map((x) => `2024:${x}`))
let n = 0
const row = (
  o: Partial<PlayerWeekRow> & Pick<PlayerWeekRow, 'week' | 'points'>,
): PlayerWeekRow => ({
  season: 2024,
  managerId: 1,
  playerId: `p${++n}`,
  playerName: `Player ${n}`,
  position: 'WR',
  isStarter: true,
  ...o,
})
const lost = (week: number, managerId: number): GameResult => ({
  season: 2024,
  week,
  managerId,
  result: 'L',
})
const find = (b: ReturnType<typeof playerRecords>, key: string) =>
  b.records.find((r) => r.key === key)!

describe('playerRecords', () => {
  it('the best starter week is never a bench row', () => {
    const rows = [row({ week: 1, points: 50, isStarter: false }), row({ week: 1, points: 30 })]
    const b = playerRecords(rows, [], keys(1))
    expect(find(b, 'bestStarterWeek').entries[0].value).toBe(30)
  })

  it('a bench record never returns a starter', () => {
    const rows = [row({ week: 1, points: 90 }), row({ week: 1, points: 12, isStarter: false })]
    const b = playerRecords(rows, [], keys(1))
    expect(find(b, 'bestBenchWeek').entries.map((e) => e.value)).toEqual([12])
    const none = playerRecords([row({ week: 1, points: 90 })], [], keys(1))
    expect(find(none, 'bestBenchWeek').entries).toEqual([])
  })

  it('names the manager who held the player', () => {
    const rows = [row({ week: 1, points: 40, managerId: 7 })]
    expect(find(playerRecords(rows, [], keys(1)), 'bestStarterWeek').entries[0].managerId).toBe(7)
  })

  it('ranks season totals within a position and never across', () => {
    const rows = [
      // A QB with 60 over two weeks, a TE with 25: the QB would "win" a cross-position list.
      row({ week: 1, points: 30, position: 'QB', playerId: 'q' }),
      row({ week: 2, points: 30, position: 'QB', playerId: 'q' }),
      row({ week: 1, points: 12, position: 'TE', playerId: 't' }),
      row({ week: 2, points: 13, position: 'TE', playerId: 't' }),
    ]
    const b = playerRecords(rows, [], keys(1, 2))
    expect(b.bySeasonPosition.map((l) => l.key)).toEqual(['bestSeason:QB', 'bestSeason:TE'])
    const te = b.bySeasonPosition.find((l) => l.key === 'bestSeason:TE')!
    expect(te.entries.map((e) => e.playerId)).toEqual(['t'])
    expect(te.entries[0].value).toBe(25)
    for (const l of b.bySeasonPosition)
      for (const e of l.entries) expect(e.position).toBe(l.key.split(':')[1])
  })

  it('ignores the lineup slot-like grouping: a null position joins no positional list', () => {
    const b = playerRecords([row({ week: 1, points: 20, position: null })], [], keys(1))
    expect(b.bySeasonPosition).toEqual([])
    expect(find(b, 'bestStarterWeek').entries[0].position).toBeNull()
  })

  it('splits a season total by manager, so each entry has one holder', () => {
    const rows = [
      row({ week: 1, points: 10, playerId: 'x', managerId: 1 }),
      row({ week: 2, points: 20, playerId: 'x', managerId: 2 }),
    ]
    const wr = playerRecords(rows, [], keys(1, 2)).bySeasonPosition[0].entries
    expect(wr.map((e) => [e.managerId, e.value])).toEqual([
      [2, 20],
      [1, 10],
    ])
  })

  it("sums a losing team's bench, and only for a loss", () => {
    const rows = [
      row({ week: 1, points: 10, isStarter: false, managerId: 1 }),
      row({ week: 1, points: 15, isStarter: false, managerId: 1 }),
      row({ week: 1, points: 99, isStarter: false, managerId: 2 }), // manager 2 won
    ]
    const e = find(playerRecords(rows, [lost(1, 1)], keys(1)), 'benchInLoss').entries
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ managerId: 1, value: 25 })
    expect(e[0].detail).toContain('15.0')
  })

  it('counts weeks started for one manager across seasons', () => {
    const rows = [
      row({ week: 1, points: 5, playerId: 'a', managerId: 1 }),
      row({ week: 2, points: 5, playerId: 'a', managerId: 1 }),
      row({ week: 1, points: 5, playerId: 'a', managerId: 2 }),
      row({ week: 3, points: 5, playerId: 'a', managerId: 1, isStarter: false }),
    ]
    const e = find(playerRecords(rows, [], keys(1, 2, 3)), 'mostWeeksStarted').entries
    expect(e[0]).toMatchObject({ managerId: 1, value: 2 })
    expect(e[1]).toMatchObject({ managerId: 2, value: 1 })
  })

  it('only counts weeks in the key set', () => {
    const rows = [row({ week: 1, points: 80 }), row({ week: 9, points: 99 })]
    expect(find(playerRecords(rows, [], keys(1)), 'bestStarterWeek').entries[0].value).toBe(80)
  })

  it('a tie keeps the earliest row', () => {
    const rows = [
      row({ week: 1, points: 40, playerId: 'first' }),
      row({ week: 2, points: 40, playerId: 'second' }),
    ]
    expect(find(playerRecords(rows, [], keys(1, 2)), 'bestStarterWeek').entries[0].playerId).toBe(
      'first',
    )
  })

  it('returns empty lists with no data', () => {
    const b = playerRecords([], [], keys(1))
    expect(b.seasons).toEqual([])
    for (const r of b.records) expect(r.entries).toEqual([])
  })
})
