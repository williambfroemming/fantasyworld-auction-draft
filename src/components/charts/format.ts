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
  const sign = body.startsWith('-') ? '-' : ''
  return `${sign}${f.prefix ?? ''}${sign ? body.slice(1) : body}${f.suffix ?? ''}`
}
