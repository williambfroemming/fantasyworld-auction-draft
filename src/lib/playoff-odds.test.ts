import { describe, expect, it } from 'vitest'
import { byesFor, formatOdds, playoffOdds, type ScheduledGame } from './playoff-odds'
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
