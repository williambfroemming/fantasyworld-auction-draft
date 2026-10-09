import { describe, expect, it } from 'vitest'
import { backtest } from './playoff-backtest'
import type { HistoryMatchup, HistorySeason, HistoryStanding } from './history'

/** Ten teams, circle-method round robin, team id is quality. */
function seasonOf(year: number, weeks: number): HistoryMatchup[] {
  const out: HistoryMatchup[] = []
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const score = (id: number, w: number) => 100 + id * 6 + ((id * 7 + w * 13 + year) % 23) - 11
  for (let w = 1; w <= weeks; w++) {
    const r = (w - 1) % 9
    const rot = [ids[0], ...ids.slice(1).map((_, k) => ids[1 + ((k + r) % 9)])]
    for (let k = 0; k < 5; k++) {
      for (const [a, b] of [[rot[k], rot[9 - k]], [rot[9 - k], rot[k]]]) {
        const pa = score(a, w)
        const pb = score(b, w)
        out.push({
          season: year, week: w, managerId: a, points: pa, opponentManagerId: b, opponentPoints: pb,
          isPlayoff: false, playoffRound: null, playoffPlacement: null,
          result: pa > pb ? 'W' : pa < pb ? 'L' : 'T',
        })
      }
    }
  }
  return out
}

const season = (s: number, champion: number | null): HistorySeason => ({
  season: s, dataTier: 'weekly', regularSeasonWeeks: 14, championManagerId: champion,
  runnerUpManagerId: null, thirdManagerId: null, championPrize: null, runnerUpPrize: null,
  thirdPrize: null, buyIn: null, draftCity: null, draftState: null,
})

// The six best teams make it, every year.
const standings: HistoryStanding[] = [2024, 2025].flatMap((s) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({
    season: s, managerId: id, place: null, wins: 0, losses: 0, ties: 0, pointsFor: null,
    pointsAgainst: null, madePlayoffs: id > 4, playoffWins: null, playoffLosses: null,
  })),
)

describe('backtest', () => {
  const input = {
    matchups: [...seasonOf(2024, 14), ...seasonOf(2025, 14), ...seasonOf(2026, 3)],
    standings,
    seasons: [season(2024, 10), season(2025, 10), season(2026, null)],
    playoffTeams: new Map([[2024, 6], [2025, 6], [2026, 6]]),
    simulations: 500,
  }

  it('tests finished seasons only, at every checkpoint', () => {
    const r = backtest(input)!
    expect(r.seasons).toEqual([2024, 2025])
    // Two seasons x five checkpoints x ten teams.
    expect(r.predictions).toBe(100)
    expect(r.buckets.reduce((t, b) => t + b.teams, 0)).toBe(100)
    expect(r.baseRate).toBeCloseTo(0.6, 6)
  })

  it('beats a flat guess when quality decides who gets in', () => {
    const r = backtest(input)!
    expect(r.brier.model).toBeLessThan(r.brier.baseline)
  })

  it('returns null with nothing finished', () => {
    expect(backtest({ ...input, seasons: [season(2026, null)] })).toBeNull()
  })
})
