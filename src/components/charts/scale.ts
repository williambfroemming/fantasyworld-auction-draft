/**
 * The arithmetic behind the chart kit. Pure, so it is tested without a browser.
 */

/** A function mapping `domain` linearly onto `range`. A zero-width domain maps to the middle. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  return (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))
}

/**
 * "Nice" axis ticks covering [min, max]: a step of 1, 2 or 5 times a power of ten, so
 * 0, 50, 100 rather than 0, 37.3, 74.6. Always returns at least two ticks and always
 * covers the data, so the first and last tick may lie outside [min, max].
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min > max) [min, max] = [max, min]
  if (min === max) {
    // A flat series: widen by one unit either side so there is an axis to draw.
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1
    min -= pad
    max += pad
  }
  const raw = (max - min) / Math.max(1, count - 1)
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const frac = raw / pow
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow
  const start = Math.floor(min / step + 1e-9) * step
  const end = Math.ceil(max / step - 1e-9) * step
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  const out: number[] = []
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(decimals)))
  return out
}

/**
 * Nudge label positions apart so none overlap, keeping their order.
 *
 * `targets[i]` is where label i wants to sit (its line's end). The result is, per input
 * index, a position at least `gap` from its neighbours and inside [lo, hi]. Labels move
 * as little as the constraints allow: a forward pass pushes down, then a backward pass
 * pushes back up from the bottom edge.
 */
export function spreadLabels(targets: number[], gap: number, lo: number, hi: number): number[] {
  const order = targets.map((_, i) => i).sort((a, b) => targets[a] - targets[b] || a - b)
  const pos = order.map((i) => Math.min(hi, Math.max(lo, targets[i])))
  for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + gap)
  if (pos.length && pos[pos.length - 1] > hi) {
    pos[pos.length - 1] = hi
    for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - gap)
  }
  const out = new Array<number>(targets.length)
  order.forEach((i, k) => (out[i] = pos[k]))
  return out
}

export interface Slice {
  id: string
  label: string
  value: number
  color: string
}

/**
 * At most `max` slices. A donut with more is unreadable, so the smallest are folded into
 * one "Other" slice. The total is preserved, and the surviving slices keep their order.
 */
export function foldSlices(slices: Slice[], max = 5, otherColor = 'var(--s-500)'): Slice[] {
  if (slices.length <= max) return slices
  const byValue = [...slices].sort((a, b) => b.value - a.value)
  const keep = new Set(byValue.slice(0, max - 1).map((s) => s.id))
  const folded = slices.filter((s) => !keep.has(s.id))
  const kept = slices.filter((s) => keep.has(s.id))
  return [
    ...kept,
    {
      id: 'other',
      label: 'Other',
      value: folded.reduce((a, s) => a + s.value, 0),
      color: otherColor,
    },
  ]
}

/** SVG path for a ring segment from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const pt = (r: number, a: number) =>
    `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`
  // A full circle cannot be one arc (start === end); draw it as two halves.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI
    return `${arcPath(cx, cy, rOuter, rInner, a0, mid)} ${arcPath(cx, cy, rOuter, rInner, mid, a1)}`
  }
  const large = a1 - a0 > Math.PI ? 1 : 0
  return [
    `M ${pt(rOuter, a0)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${pt(rOuter, a1)}`,
    `L ${pt(rInner, a1)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${pt(rInner, a0)}`,
    'Z',
  ].join(' ')
}
