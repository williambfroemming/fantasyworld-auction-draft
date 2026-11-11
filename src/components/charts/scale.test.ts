import { describe, expect, it } from 'vitest'
import { arcPath, foldSlices, linearScale, niceTicks, spreadLabels, type Slice } from './scale'

describe('linearScale', () => {
  it('maps the domain onto the range, including an inverted range', () => {
    const s = linearScale([0, 100], [0, 200])
    expect([s(0), s(50), s(100)]).toEqual([0, 100, 200])
    const up = linearScale([0, 10], [100, 0]) // SVG y runs downwards
    expect([up(0), up(10)]).toEqual([100, 0])
  })

  it('puts a zero-width domain in the middle instead of dividing by zero', () => {
    expect(linearScale([5, 5], [0, 100])(5)).toBe(50)
  })
})

describe('niceTicks', () => {
  it('uses steps of 1, 2 or 5 times a power of ten', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 50, 100])
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.5, 1])
    expect(niceTicks(3, 47, 5)).toEqual([0, 20, 40, 60])
  })

  it('always covers the data, so the end ticks may lie outside it', () => {
    for (const [lo, hi] of [[0, 97], [3, 47], [0.12, 0.58], [-12, 31]]) {
      const t = niceTicks(lo, hi)
      expect(t[0]).toBeLessThanOrEqual(lo)
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi)
    }
  })

  it('does not accumulate float noise in decimal steps', () => {
    expect(niceTicks(0.12, 0.58)).toEqual([0, 0.2, 0.4, 0.6])
  })

  it('gives a flat series an axis rather than a single tick', () => {
    expect(niceTicks(5, 5).length).toBeGreaterThanOrEqual(2)
    expect(niceTicks(0, 0).length).toBeGreaterThanOrEqual(2)
  })

  it('can produce one tick per integer, for a rank axis', () => {
    expect(niceTicks(1, 10, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('tolerates reversed or non-finite input', () => {
    expect(niceTicks(100, 0)).toEqual([0, 50, 100])
    expect(niceTicks(NaN, 3)).toEqual([0, 1])
  })
})

describe('spreadLabels', () => {
  it('leaves labels that already fit where they are', () => {
    expect(spreadLabels([10, 50, 100], 13, 0, 200)).toEqual([10, 50, 100])
  })

  it('pushes crowded labels apart by at least the gap, keeping their order', () => {
    const out = spreadLabels([10, 12, 14, 100], 13, 0, 200)
    expect(out).toEqual([10, 23, 36, 100])
  })

  it('pushes back up from the bottom edge instead of running off it', () => {
    const out = spreadLabels([190, 195, 200], 13, 0, 200)
    expect(out).toEqual([174, 187, 200])
  })

  it('returns positions in the order of the input, whatever the sort order', () => {
    expect(spreadLabels([50, 10], 13, 0, 200)).toEqual([50, 10])
    const out = spreadLabels([20, 20, 20], 10, 0, 200)
    expect(new Set(out).size).toBe(3)
  })

  it('keeps everything inside [lo, hi]', () => {
    const out = spreadLabels([-50, 500], 13, 0, 200)
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...out)).toBeLessThanOrEqual(200)
  })
})

describe('foldSlices', () => {
  const s = (id: string, value: number): Slice => ({ id, label: id.toUpperCase(), value, color: 'c' })

  it('leaves five or fewer slices alone', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id, i) => s(id, i + 1))
    expect(foldSlices(five)).toEqual(five)
  })

  it('folds the smallest into one Other slice and preserves the total', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => s(id, (i + 1) * 10))
    const out = foldSlices(seven)
    expect(out).toHaveLength(5)
    expect(out[out.length - 1].label).toBe('Other')
    expect(out.reduce((a, x) => a + x.value, 0)).toBe(seven.reduce((a, x) => a + x.value, 0))
    // the four largest survive, in their original order
    expect(out.slice(0, 4).map((x) => x.id)).toEqual(['d', 'e', 'f', 'g'])
  })
})

describe('arcPath', () => {
  it('draws a quarter ring from 12 to 3 o\'clock', () => {
    expect(arcPath(0, 0, 10, 5, 0, Math.PI / 2)).toBe(
      'M 0.00 -10.00 A 10 10 0 0 1 10.00 -0.00 L 5.00 -0.00 A 5 5 0 0 0 0.00 -5.00 Z',
    )
  })

  it('sets the large-arc flag past half a turn', () => {
    expect(arcPath(0, 0, 10, 5, 0, Math.PI * 1.5)).toContain('A 10 10 0 1 1')
  })

  it('draws a full circle as two halves', () => {
    const d = arcPath(0, 0, 10, 5, 0, Math.PI * 2)
    expect(d.match(/M /g)).toHaveLength(2)
  })
})
