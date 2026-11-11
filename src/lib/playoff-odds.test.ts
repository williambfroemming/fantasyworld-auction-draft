import { describe, expect, it } from 'vitest'
import baseline from './__fixtures__/playoff-odds-baseline.json'
import {
  bracketOrder,
  byesFor,
  formatOdds,
  playoffOdds,
  type ScheduledGame,
} from './playoff-odds'
import type { HistoryMatchup } from './history'

/**
 * A ten-team round robin: week w pairs i with the circle-method opponent, so
 * every team meets every other once across nine weeks.
 */
function roundRobin(weeks: number[]): ScheduledGame[] {
  const out: ScheduledGame[] = []
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  for (const w of weeks) {
    const r = (w - 1) % 9
    const rot = [ids[0], ...ids.slice(1).map((_, k) => ids[1 + ((k + r) % 9)])]
    for (let k = 0; k < 5; k++) {
      const a = rot[k]
      const b = rot[9 - k]
      out.push({ week: w, managerId: a, opponentManagerId: b })
      out.push({ week: w, managerId: b, opponentManagerId: a })
    }
  }
  return out
}

/** Played weeks from a schedule and a per-team score function. */
function play(schedule: ScheduledGame[], score: (id: number, week: number) => number): HistoryMatchup[] {
  return schedule.map((g) => {
    const mine = score(g.managerId, g.week)
    const theirs = score(g.opponentManagerId, g.week)
    return {
      season: 2026,
      week: g.week,
      managerId: g.managerId,
      points: mine,
      opponentManagerId: g.opponentManagerId,
      opponentPoints: theirs,
      isPlayoff: false,
      playoffRound: null,
      playoffPlacement: null,
      result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T',
    }
  })
}

// Team id is quality: 10 is the best, 1 the worst. A little week-to-week noise
// so the pooled spread is not zero.
const level = (id: number, w: number) => 100 + id * 6 + ((id * 7 + w * 13) % 11) - 5
const full = roundRobin([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])

function odds(through: number, over: Partial<Parameters<typeof playoffOdds>[0]> = {}) {
  return playoffOdds({
    season: 2026,
    played: play(full.filter((g) => g.week <= through), level),
    schedule: full,
    regularSeasonWeeks: 14,
    playoffTeams: 6,
    simulations: 4000,
    ...over,
  })!
}

describe('byesFor', () => {
  it('gives the gap to the next power of two', () => {
    expect(byesFor(6)).toBe(2)
    expect(byesFor(4)).toBe(0)
    expect(byesFor(8)).toBe(0)
    expect(byesFor(5)).toBe(3)
  })
})

describe('playoffOdds', () => {
  it('returns null with nothing played', () => {
    expect(playoffOdds({ season: 2026, played: [], schedule: full, regularSeasonWeeks: 14, playoffTeams: 6 })).toBeNull()
  })

  it('returns null when the remaining schedule is not on record', () => {
    // A projection over invented matchups would be the one number on the page
    // with no basis at all.
    expect(odds(5, { schedule: full.filter((g) => g.week <= 9) })).toBeNull()
  })

  it('hands out exactly six playoff seats and two byes per simulation', () => {
    const r = odds(5)
    const seats = r.rows.reduce((s, x) => s + x.playoffPct, 0)
    const byes = r.rows.reduce((s, x) => s + x.byePct, 0)
    expect(seats).toBeCloseTo(6, 6)
    expect(byes).toBeCloseTo(2, 6)
    expect(r.byes).toBe(2)
  })

  it('ranks the better teams more likely to get in', () => {
    const r = odds(5)
    const p = (id: number) => r.rows.find((x) => x.managerId === id)!.playoffPct
    expect(p(10)).toBeGreaterThan(p(5))
    expect(p(5)).toBeGreaterThan(p(1))
  })

  it('does not treat two weeks as certainty', () => {
    // The shrink and the rating uncertainty exist for exactly this: week two
    // must not print 99% and 1%.
    const r = odds(2)
    const best = r.rows[0].playoffPct
    const worst = r.rows[r.rows.length - 1].playoffPct
    expect(best).toBeLessThan(0.99)
    expect(worst).toBeGreaterThan(0.01)
  })

  it('becomes certain once the regular season is over', () => {
    const r = odds(14)
    expect(r.remainingWeeks).toBe(0)
    expect(r.rows.every((x) => x.playoffPct === 0 || x.playoffPct === 1)).toBe(true)
    expect(r.rows.filter((x) => x.playoffPct === 1)).toHaveLength(6)
  })

  it('is deterministic for a given season and week', () => {
    expect(odds(5)).toEqual(odds(5))
  })

  it('reads a harder remaining schedule as worse odds', () => {
    // Same team, same results: one future against the three best teams, one
    // against the three worst. Strength of schedule is the point of using
    // the real schedule rather than random opponents.
    const played = play(full.filter((g) => g.week <= 5), level)
    const tail = (opps: number[]): ScheduledGame[] => {
      const rest = full.filter((g) => g.week > 5 && g.managerId !== 5 && g.opponentManagerId !== 5)
      // Replace manager 5's games with a fixed list; everyone else keeps theirs.
      const mine = opps.flatMap((o, k) => [
        { week: 6 + k, managerId: 5, opponentManagerId: o },
        { week: 6 + k, managerId: o, opponentManagerId: 5 },
      ])
      return [...rest, ...mine]
    }
    const run = (opps: number[]) =>
      playoffOdds({
        season: 2026,
        played,
        schedule: tail(opps),
        regularSeasonWeeks: 14,
        playoffTeams: 6,
        simulations: 4000,
      })!.rows.find((x) => x.managerId === 5)!
    const hard = run([10, 9, 8, 10, 9, 8, 10, 9, 8])
    const easy = run([1, 2, 3, 1, 2, 3, 1, 2, 3])
    expect(hard.remainingSos!).toBeGreaterThan(easy.remainingSos!)
    expect(hard.playoffPct).toBeLessThan(easy.playoffPct)
  })
})

/**
 * Steps 48-49 added seeds, leverage and the title to the same simulation. The hard rule:
 * the numbers people already read (playoffPct, byePct, projectedWins) must not move by
 * a single bit, which means the regular-season random stream must see exactly the same
 * draws in the same order.
 *
 * `__fixtures__/playoff-odds-baseline.json` was captured from the code BEFORE any of it
 * was written. If this test fails, someone added, removed or reordered a draw on the
 * main stream, or changed the sort — do not "update the snapshot" without understanding
 * why, because every published odds figure just changed.
 */
describe('existing outputs are bit-for-bit unchanged', () => {
  const cases: Array<[keyof typeof baseline, number, number, number]> = [
    ['w4', 4, 4000, 6],
    ['w9', 9, 4000, 6],
    ['w13', 13, 4000, 6],
    ['w6_4teams', 6, 3000, 4],
  ]
  for (const [key, through, simulations, playoffTeams] of cases) {
    it(`matches the pre-change snapshot: ${key}`, () => {
      const r = odds(through, { simulations, playoffTeams })
      const want = baseline[key]
      expect(r.throughWeek).toBe(want.throughWeek)
      expect(r.remainingWeeks).toBe(want.remainingWeeks)
      expect(r.byes).toBe(want.byes)
      expect(r.rows.map((x) => x.managerId)).toEqual(want.rows.map((x) => x.managerId)) // order too
      for (const [i, row] of r.rows.entries()) {
        const w = want.rows[i]
        expect(row.playoffPct).toBe(w.playoffPct)
        expect(row.byePct).toBe(w.byePct)
        expect(row.projectedWins).toBe(w.projectedWins)
        expect(row.remainingSos).toBe(w.remainingSos)
        expect(row.rating).toBe(w.rating)
      }
    })
  }
})

describe('seed distribution', () => {
  const r = odds(9)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  it('has one entry per seed and sums to 1 for every manager', () => {
    for (const row of r.rows) {
      expect(row.seedPct).toHaveLength(10)
      expect(sum(row.seedPct)).toBeCloseTo(1, 12)
    }
  })

  it('first playoffTeams entries sum to playoffPct, and the byes to byePct', () => {
    for (const row of r.rows) {
      expect(sum(row.seedPct.slice(0, r.playoffTeams))).toBeCloseTo(row.playoffPct, 12)
      expect(sum(row.seedPct.slice(0, r.byes))).toBeCloseTo(row.byePct, 12)
    }
  })

  it('gives every seed to exactly one team per simulation, so each seed sums to 1 across the league', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(sum(r.rows.map((x) => x.seedPct[seed]))).toBeCloseTo(1, 12)
    }
  })
})

describe('leverage', () => {
  it('a win is never worth less than a loss', () => {
    for (const row of odds(9).rows) {
      expect(row.leverage).not.toBeNull()
      expect(row.leverage!.ifWin).toBeGreaterThanOrEqual(row.leverage!.ifLose)
    }
  })

  it('is worth the most to a team on the bubble, and almost nothing to one that is out of reach', () => {
    const rows = odds(9).rows
    const swing = (id: number) => {
      const l = rows.find((x) => x.managerId === id)!.leverage!
      return l.ifWin - l.ifLose
    }
    expect(swing(5)).toBeGreaterThan(swing(10)) // a lock has little to gain
    expect(swing(5)).toBeGreaterThan(swing(1)) // neither does a team already gone
  })

  it('is null once there is no game left to play', () => {
    for (const row of odds(14).rows) expect(row.leverage).toBeNull()
  })

  it('stays inside 0..1', () => {
    for (const row of odds(6).rows) {
      expect(row.leverage!.ifWin).toBeLessThanOrEqual(1)
      expect(row.leverage!.ifLose).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('title odds', () => {
  it('sum to 1 across the league', () => {
    for (const through of [4, 9, 13]) {
      expect(odds(through).rows.reduce((a, x) => a + x.titlePct, 0)).toBeCloseTo(1, 12)
    }
  })

  it('are zero for a team that cannot make the playoffs, and never exceed playoffPct', () => {
    const r = odds(13)
    const out = r.rows.find((x) => x.playoffPct === 0)!
    expect(out).toBeDefined()
    expect(out.titlePct).toBe(0)
    for (const row of r.rows) expect(row.titlePct).toBeLessThanOrEqual(row.playoffPct + 1e-12)
  })

  it('favour the best team, and a bye is worth something', () => {
    const rows = odds(9).rows
    const best = rows.find((x) => x.managerId === 10)!
    expect(rows.every((x) => x.titlePct <= best.titlePct)).toBe(true)
    // A team with a real chance at a bye wins the title more often than one that is
    // always a low seed, at the same strength.
    expect(best.titlePct).toBeGreaterThan(rows.find((x) => x.managerId === 7)!.titlePct)
  })

  it('are deterministic: a reload gives the same numbers', () => {
    expect(odds(9).rows.map((x) => x.titlePct)).toEqual(odds(9).rows.map((x) => x.titlePct))
  })

  it('work for a four-team field with no byes', () => {
    const r = odds(6, { playoffTeams: 4 })
    expect(r.byes).toBe(0)
    expect(r.rows.reduce((a, x) => a + x.titlePct, 0)).toBeCloseTo(1, 12)
  })
})

describe('bracketOrder', () => {
  it('lays seeds out as a fixed bracket', () => {
    expect(bracketOrder(1)).toEqual([1])
    expect(bracketOrder(2)).toEqual([1, 2])
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3])
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
  })

  it('is NOT re-seeded: seed 1 meets the winner of 4 v 5, seed 2 the winner of 3 v 6', () => {
    // Adjacent slots meet. With two byes (seeds 7 and 8 absent), round two is
    // [W(1 v bye), W(4 v 5)] and [W(2 v bye), W(3 v 6)] — as Sleeper played 2025, where the
    // top seed drew the 5 seed rather than the lowest seed left.
    const o = bracketOrder(8)
    expect(o.slice(0, 4)).toEqual([1, 8, 4, 5])
    expect(o.slice(4)).toEqual([2, 7, 3, 6])
  })
})

describe('formatOdds', () => {
  it('never prints certainty while games remain', () => {
    expect(formatOdds(1, 3)).toBe('>99%')
    expect(formatOdds(0, 3)).toBe('<1%')
    expect(formatOdds(0.416, 3)).toBe('42%')
  })

  it('prints facts once the season is over', () => {
    expect(formatOdds(1, 0)).toBe('100%')
    expect(formatOdds(0, 0)).toBe('0%')
  })
})
