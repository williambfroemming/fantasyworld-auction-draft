import { describe, expect, it } from 'vitest'
import { valueVsResults, type ResultPick } from './draft-value'

let nextId = 1
const pick = (position: string, price: number, points: number | null, managerId = 1): ResultPick => ({
  pickId: nextId++,
  name: `${position}-${price}-${points ?? 'x'}-${nextId}`,
  position,
  price,
  managerId,
  points,
})

describe('valueVsResults', () => {
  it('calls a cheap pick who outproduced their price a steal', () => {
    const r = valueVsResults([
      pick('WR', 50, 100),
      pick('WR', 20, 90),
      pick('WR', 1, 200), // cheapest, best season
    ])
    const flier = r.scored.find((s) => s.price === 1)!
    expect(flier.priceRank).toBe(3)
    expect(flier.finishRank).toBe(1)
    expect(flier.delta).toBe(2)
    expect(r.steals[0].price).toBe(1)
  })

  it('calls an expensive pick who did not produce a bust', () => {
    const r = valueVsResults([
      pick('RB', 60, 10), // priciest, worst season
      pick('RB', 30, 150),
      pick('RB', 5, 120),
    ])
    expect(r.busts[0].price).toBe(60)
    expect(r.busts[0].delta).toBe(-2)
  })

  it('never compares across positions', () => {
    // A superflex league's QBs outscore every RB. Pooling them would rank the
    // cheapest QB a steal purely for being a QB.
    const r = valueVsResults([
      pick('QB', 50, 400),
      pick('QB', 10, 380),
      pick('RB', 50, 200),
      pick('RB', 10, 180),
    ])
    // Within each position the shape is identical, so the deltas must be too.
    const qb = r.scored.filter((s) => s.position === 'QB').map((s) => s.delta)
    const rb = r.scored.filter((s) => s.position === 'RB').map((s) => s.delta)
    expect(qb.sort()).toEqual(rb.sort())
    expect(r.scored.every((s) => s.delta === 0)).toBe(true)
  })

  it('treats missing points as unknown, never as zero', () => {
    // The critical case: an unmeasured player must not be ranked the worst bust
    // on the strength of having no data.
    const r = valueVsResults([pick('TE', 40, 100), pick('TE', 30, 80), pick('TE', 20, null)])
    expect(r.unscored).toBe(1)
    expect(r.scored).toHaveLength(2)
    expect(r.busts.some((b) => b.price === 20)).toBe(false)
  })

  it('still counts an unmeasured player in the price ranks', () => {
    // They were bought, and they occupied a price slot. Dropping them from the
    // price ranks would quietly promote everyone below them.
    const r = valueVsResults([pick('QB', 50, null), pick('QB', 30, 300), pick('QB', 10, 200)])
    expect(r.scored.find((s) => s.price === 30)!.priceRank).toBe(2)
    expect(r.scored.find((s) => s.price === 10)!.priceRank).toBe(3)
  })

  it('excludes kickers and defenses', () => {
    const r = valueVsResults([pick('DEF', 5, 90), pick('DEF', 1, 120), pick('K', 1, 130)])
    expect(r.scored).toHaveLength(0)
    expect(r.unscored).toBe(0)
  })

  it('sums a manager total from their own picks only', () => {
    const r = valueVsResults([
      pick('WR', 40, 50, 7), // priciest, worst → −2
      pick('WR', 20, 100, 9),
      pick('WR', 1, 150, 9), // cheapest, best → +2
    ])
    expect(r.byManager.find((m) => m.managerId === 7)!.delta).toBe(-2)
    expect(r.byManager.find((m) => m.managerId === 9)!.delta).toBe(2)
    expect(r.byManager.find((m) => m.managerId === 9)!.scored).toBe(2)
  })

  it('has deltas that sum to zero within a position', () => {
    // priceRank and finishRank are both permutations of 1..n over the same
    // measured set, so the deltas must cancel. A non-zero sum means one of the
    // two rankings dropped or double-counted a pick.
    const r = valueVsResults([
      pick('RB', 60, 120),
      pick('RB', 40, 200),
      pick('RB', 25, 60),
      pick('RB', 3, 180),
      pick('RB', 1, 90),
    ])
    expect(r.scored.reduce((s, x) => s + x.delta, 0)).toBe(0)
  })
})
