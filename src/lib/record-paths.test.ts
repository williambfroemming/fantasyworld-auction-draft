import { describe, expect, it } from 'vitest'
import { recordCell, recordPaths } from './record-paths'
import type { HistoryMatchup, HistorySeason, HistoryStanding } from './history'

const season = (s: number, champion: number | null): HistorySeason => ({
  season: s,
  dataTier: 'weekly',
  regularSeasonWeeks: 14,
  championManagerId: champion,
  runnerUpManagerId: null,
  thirdManagerId: null,
  championPrize: null,
  runnerUpPrize: null,
  thirdPrize: null,
  buyIn: null,
  draftCity: null,
  draftState: null,
})

/** Four managers, 1v2 and 3v4, scores in manager-id order. */
function week(s: number, w: number, points: number[]): HistoryMatchup[] {
  const out: HistoryMatchup[] = []
  for (const [a, b] of [[1, 2], [3, 4]] as const) {
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const mine = points[self - 1]
      const theirs = points[other - 1]
      out.push({
        season: s, week: w, managerId: self, points: mine,
        opponentManagerId: other, opponentPoints: theirs,
        isPlayoff: false, playoffRound: null, playoffPlacement: null,
        result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
      })
    }
  }
  return out
}

const standing = (s: number, managerId: number, madePlayoffs: boolean): HistoryStanding => ({
  season: s, managerId, place: null, wins: 0, losses: 0, ties: 0,
  pointsFor: null, pointsAgainst: null, madePlayoffs, playoffWins: null, playoffLosses: null,
})

// 2024: M1 and M3 start 2-0 and make it; M2 and M4 start 0-2 and miss.
// 2025: M2 goes 2-0 and makes it, M1 goes 0-2 and misses, M3 and M4 split
// 1-1 and only M4 gets in.
const matchups = [
  ...week(2024, 1, [100, 90, 100, 90]),
  ...week(2024, 2, [100, 90, 100, 90]),
  ...week(2025, 1, [80, 100, 90, 80]),
  ...week(2025, 2, [100, 110, 80, 90]),
  // The season in progress: one week, M1 and M4 win.
  ...week(2026, 1, [120, 100, 90, 95]),
]
const standings = [
  standing(2024, 1, true), standing(2024, 2, false), standing(2024, 3, true), standing(2024, 4, false),
  standing(2025, 1, false), standing(2025, 2, true), standing(2025, 3, false), standing(2025, 4, true),
]
const seasons = [season(2024, 1), season(2025, 2), season(2026, null)]

describe('recordPaths', () => {
  const r = recordPaths({ matchups, standings, seasons, currentSeason: 2026 })

  it('counts finished seasons only', () => {
    expect(r.seasons).toEqual([2024, 2025])
  })

  it('counts every team that held a record, and how many got in', () => {
    // 2-0 after week 2: M1 and M3 in 2024 (both in), M2 in 2025 (in).
    expect(recordCell(r, 2, 2, 0)).toMatchObject({ teams: 3, made: 3 })
    // 0-2 after week 2: M2 and M4 in 2024, M1 in 2025 -- none got in.
    expect(recordCell(r, 2, 0, 2)).toMatchObject({ teams: 3, made: 0 })
    // 1-1: M3 and M4 in 2025; M4 got in.
    expect(recordCell(r, 2, 1, 1)).toMatchObject({ teams: 2, made: 1 })
  })

  it('never counts the season in progress as history', () => {
    // 2026's week-one teams have made nothing yet; counting them as misses
    // would drag every cell they touch toward zero.
    const oneZero = recordCell(r, 1, 1, 0)!
    expect(oneZero.teams).toBe(4) // two per finished season
  })

  it('places this season\'s managers on their current record', () => {
    expect(r.currentSeason).toBe(2026)
    expect(r.currentWeek).toBe(1)
    expect(recordCell(r, 1, 1, 0)!.current.sort()).toEqual([1, 4])
    expect(recordCell(r, 1, 0, 1)!.current.sort()).toEqual([2, 3])
  })

  it('places nobody out of season', () => {
    const off = recordPaths({ matchups, standings, seasons, currentSeason: null })
    expect(off.currentSeason).toBeNull()
    expect(off.cells.every((c) => c.current.length === 0)).toBe(true)
  })

  it('drops a team from a tie onward rather than inventing a result', () => {
    const tied = recordPaths({
      matchups: [...week(2023, 1, [100, 100, 100, 90]), ...week(2023, 2, [100, 90, 100, 90])],
      standings: [],
      seasons: [season(2023, 1)],
      currentSeason: null,
    })
    // M1 and M2 tied in week 1: two team-weeks each, all excluded.
    expect(tied.tiesExcluded).toBe(4)
    expect(recordCell(tied, 2, 2, 0)).toMatchObject({ teams: 1 })
  })
})
