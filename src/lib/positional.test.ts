import { describe, expect, it } from 'vitest'
import { memberPositional, positionalScorecard, type StarterRow } from './positional'

const keys = (...weeks: number[]) => new Set(weeks.map((w) => `2025:${w}`))
const row = (
  managerId: number,
  week: number,
  position: string | null,
  points: number,
  over: Partial<StarterRow> = {},
): StarterRow => ({ season: 2025, week, managerId, position, isStarter: true, points, ...over })

/** Three managers, two weeks. Manager 3 never starts a TE. */
const fixture: StarterRow[] = [
  row(1, 1, 'QB', 30), row(1, 1, 'WR', 20), row(1, 1, 'TE', 10), row(1, 2, 'QB', 20), row(1, 2, 'WR', 10),
  row(2, 1, 'QB', 20), row(2, 1, 'WR', 10), row(2, 1, 'TE', 5), row(2, 2, 'QB', 20), row(2, 2, 'WR', 10),
  row(3, 1, 'QB', 10), row(3, 1, 'WR', 30), row(3, 2, 'QB', 10), row(3, 2, 'WR', 20),
]
const sc = positionalScorecard(fixture, 2025, keys(1, 2))
const of = (id: number) => sc.rows.find((r) => r.managerId === id)!

describe('positionalScorecard', () => {
  it('totals started points per position and measures them against the league mean', () => {
    // QB: 50, 40, 20 -> mean 36.67. WR: 30, 20, 50 -> mean 33.33.
    expect(of(1).byPosition.QB!.points).toBe(50)
    expect(of(1).byPosition.QB!.leagueMean).toBeCloseTo(110 / 3, 10)
    expect(of(1).byPosition.QB!.diff).toBeCloseTo(50 - 110 / 3, 10)
    expect(of(3).byPosition.WR!.diff).toBeGreaterThan(0)
    expect(of(3).byPosition.QB!.diff).toBeLessThan(0)
  })

  it('counts a WR started in FLEX as a WR, and a QB in SUPER_FLEX as a QB (never groups on slot)', () => {
    const r = positionalScorecard(
      [
        row(1, 1, 'WR', 15, { slot: 'FLEX' }),
        row(1, 1, 'WR', 10, { slot: 'WR' }),
        row(1, 1, 'QB', 18, { slot: 'SUPER_FLEX' }),
        row(1, 1, 'RB', 12, { slot: 'WR' }), // the stored slot can simply be wrong
      ],
      2025,
      keys(1),
    )
    expect(r.rows[0].byPosition.WR!.points).toBe(25)
    expect(r.rows[0].byPosition.QB!.points).toBe(18)
    expect(r.rows[0].byPosition.RB!.points).toBe(12)
  })

  it('differences at each position sum to zero across the league', () => {
    for (const p of sc.positions) {
      const sum = sc.rows.reduce((a, r) => a + r.byPosition[p]!.diff, 0)
      expect(sum, p).toBeCloseTo(0, 9)
    }
  })

  it('each manager’s positions plus unknown add up to their started total', () => {
    for (const r of sc.rows) {
      const parts = sc.positions.reduce((a, p) => a + r.byPosition[p]!.points, 0) + r.unknown
      expect(parts).toBeCloseTo(r.total, 9)
    }
    expect(of(1).total).toBe(90)
  })

  it('compares within a position, never across: a great TE is not diluted by a weak QB', () => {
    // Manager 1 is the only one with a big TE week; managers have very different QB totals.
    // Their TE diff must be measured against the TE mean only.
    const te = of(1).byPosition.TE!
    expect(te.leagueMean).toBeCloseTo((10 + 5 + 0) / 3, 10)
    expect(te.diff).toBeCloseTo(10 - 5, 10)
    // And no cell was ever compared with the pooled average across positions.
    const pooled = sc.rows.reduce((a, r) => a + r.total, 0) / (sc.rows.length * sc.positions.length)
    expect(te.leagueMean).not.toBeCloseTo(pooled, 3)
  })

  it('counts a manager who started nobody at a position as 0, not as missing', () => {
    expect(of(3).byPosition.TE!.points).toBe(0)
    expect(of(3).byPosition.TE!.diff).toBeCloseTo(-5, 10)
  })

  it('reports a null or unrecognised position as unknown instead of dropping it', () => {
    const r = positionalScorecard(
      [row(1, 1, 'QB', 20), row(1, 1, null, 7), row(1, 1, 'LB', 3), row(2, 1, 'QB', 10)],
      2025,
      keys(1),
    )
    expect(r.unknownRows).toBe(2)
    expect(r.rows.find((x) => x.managerId === 1)!.unknown).toBe(10)
    expect(r.rows.find((x) => x.managerId === 1)!.total).toBe(30) // 20 + 10: nothing lost
    expect(r.positions).toEqual(['QB'])
  })

  it('ignores the bench, other seasons, and weeks that are not in the key set', () => {
    const r = positionalScorecard(
      [
        row(1, 1, 'QB', 20),
        row(1, 1, 'QB', 99, { isStarter: false }), // bench
        row(1, 2, 'QB', 99), // week not counted (a playoff week)
        { ...row(1, 1, 'QB', 99), season: 2024 }, // another season
      ],
      2025,
      keys(1),
    )
    expect(r.rows[0].byPosition.QB!.points).toBe(20)
    expect(r.weeks).toBe(1)
  })

  it('lists only positions that exist in the data, in lineup order (no empty K column)', () => {
    expect(sc.positions).toEqual(['QB', 'WR', 'TE'])
    const withK = positionalScorecard([row(1, 1, 'K', 8), row(1, 1, 'DEF', 9), row(1, 1, 'QB', 1)], 2025, keys(1))
    expect(withK.positions).toEqual(['QB', 'K', 'DEF'])
  })

  it('handles an empty season without dividing by zero', () => {
    const r = positionalScorecard([], 2025, keys(1))
    expect(r.rows).toEqual([])
    expect(r.positions).toEqual([])
    expect(r.weeks).toBe(0)
  })
})

describe('memberPositional', () => {
  const a = positionalScorecard(fixture, 2025, keys(1, 2))
  const b = positionalScorecard(
    fixture.map((r) => ({ ...r, season: 2024 })),
    2024,
    new Set(['2024:1', '2024:2']),
  )

  it('returns one line per season, newest first, with the signed diffs', () => {
    const out = memberPositional([b, a], 3)
    expect(out.map((s) => s.season)).toEqual([2025, 2024])
    expect(out[0].diffs.WR).toBeGreaterThan(0)
    expect(out[0].diffs.QB).toBeLessThan(0)
  })

  it('skips a season the manager has no row in', () => {
    expect(memberPositional([a], 99)).toEqual([])
  })
})
