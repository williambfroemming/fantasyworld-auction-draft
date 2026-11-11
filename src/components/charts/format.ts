/**
 * How a chart prints a number, as DATA rather than a function.
 *
 * ⚠️ This exists because the chart components are client components and nearly every page
 * that uses them is a server component, and React will not serialise a function across
 * that boundary ("Functions cannot be passed directly to Client Components"). A spec like
 * `{ prefix: '$' }` crosses fine; `(v) => '$' + v` does not.
 */
export interface Fmt {
  prefix?: string
  suffix?: string
  /** Digits after the point. Default 0. */
  decimals?: number
  /** Group thousands with commas. Default true. */
  thousands?: boolean
  /** Print a year as its last two digits: 2024 -> '24. */
  shortYear?: boolean
  /** Always show the sign: +120, −45, 0. For differences from an average. */
  signed?: boolean
}

export function formatValue(spec: Fmt | undefined, v: number): string {
  const f = spec ?? {}
  if (f.shortYear) return `’${String(Math.round(v)).slice(-2)}`
  const d = f.decimals ?? 0
  const n = Number(v.toFixed(d))
  const body =
    f.thousands === false
      ? n.toFixed(d)
      : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  const negative = body.startsWith('-')
  const magnitude = negative ? body.slice(1) : body
  if (f.signed) {
    // A real minus, and a value that rounds to zero carries no sign at all.
    const zero = Number(magnitude.replace(/,/g, '')) === 0
    const sign = zero ? '' : negative ? '\u2212' : '+'
    return `${sign}${f.prefix ?? ''}${magnitude}${f.suffix ?? ''}`
  }
  const sign = negative ? '-' : ''
  return `${sign}${f.prefix ?? ''}${magnitude}${f.suffix ?? ''}`
}

/**
 * A share (0..1) as a whole percent. A real but tiny share prints "<1%", never "0%": a
 * slice that exists should not be labelled as if it were empty.
 */
export function formatShare(fraction: number): string {
  const pct = fraction * 100
  if (pct > 0 && pct < 0.5) return '<1%'
  return `${Math.round(pct)}%`
}
