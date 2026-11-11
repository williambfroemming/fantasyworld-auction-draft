'use client'

import { useMemo } from 'react'
import { ChartTable } from './ChartTable'
import { INK, INK_FAINT } from './colors'
import { formatShare, formatValue, type Fmt } from './format'
import { arcPath, foldSlices, spreadLabels, type Slice } from './scale'
import { useWidth } from './useWidth'

const FONT = 12

/**
 * One part-to-whole, at most five slices (more are folded into "Other" so the total still
 * adds up). Each slice is labelled outside the ring with its name and share; labels on each
 * side are nudged apart so a thin slice next to another stays readable.
 */
export function Donut({
  slices,
  ariaLabel,
  format: fmt,
  centerLabel,
}: {
  slices: Slice[]
  ariaLabel: string
  format?: Fmt
  /** Small caption in the hole, e.g. "$3,420" or "spent". */
  centerLabel?: string
}) {
  const format = (v: number) => formatValue(fmt, v)
  const [ref, width, ready] = useWidth(360)
  const shown = useMemo(() => foldSlices(slices.filter((s) => s.value > 0)), [slices])
  const total = shown.reduce((a, s) => a + s.value, 0)

  const labelW = Math.min(96, Math.round(width * 0.28))
  const size = Math.max(120, Math.min(width - 2 * labelW, 220))
  // Room above and below the ring for labels on slices that sit at 12 and 6 o'clock:
  // two lines of text beyond the ring's edge.
  const PAD = 28
  const height = size + 2 * PAD
  const cx = width / 2
  const cy = height / 2
  const rOut = size / 2
  const rIn = rOut * 0.58

  if (total <= 0) return <p className="text-sm text-slate-500">Nothing to show.</p>

  const arcs = shown.map((s, i) => {
    const before = shown.slice(0, i).reduce((sum, x) => sum + x.value, 0)
    const a0 = (before / total) * Math.PI * 2
    const a1 = a0 + (s.value / total) * Math.PI * 2
    return { s, a0, a1, mid: (a0 + a1) / 2 }
  })

  // Labels live in a column on each side of the ring, joined to their slice by a leader
  // line. Fixed columns (rather than hugging each slice) mean a label can never land on
  // the ring, and two thin neighbours just stack down the column.
  const place = (side: 'left' | 'right') => {
    const group = arcs.filter((x) => Math.sin(x.mid) >= 0 === (side === 'right'))
    const ys = spreadLabels(
      group.map((x) => cy - rOut * Math.cos(x.mid)),
      FONT * 2.4,
      FONT,
      height - FONT * 1.6,
    )
    const dir = side === 'right' ? 1 : -1
    return group.map((x, i) => ({
      ...x,
      y: ys[i],
      x: cx + dir * (rOut + 16),
      from: [cx + rOut * Math.sin(x.mid), cy - rOut * Math.cos(x.mid)] as const,
      elbow: [cx + dir * (rOut + 8), ys[i]] as const,
    }))
  }
  const labels = [...place('left'), ...place('right')]

  return (
    <div ref={ref} className="w-full" style={{ minHeight: height }}>
      {ready && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          className="block max-w-full"
        >
          {arcs.map(({ s, a0, a1 }) => (
            <path
              key={s.id}
              d={arcPath(cx, cy, rOut, rIn, a0, a1)}
              style={{ fill: s.color }}
              stroke="var(--s-950)"
              strokeWidth={1.5}
            >
              <title>{`${s.label}: ${format(s.value)} (${formatShare(s.value / total)})`}</title>
            </path>
          ))}
          {centerLabel && (
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dy="0.32em"
              fontSize={13}
              fontWeight={700}
              style={{ fill: INK }}
            >
              {centerLabel}
            </text>
          )}
          {labels.map((l) => {
            const right = Math.sin(l.mid) >= 0
            return (
              <g key={l.s.id}>
                <polyline
                  points={`${l.from[0]},${l.from[1]} ${l.elbow[0]},${l.elbow[1]} ${l.x - (right ? 4 : -4)},${l.y}`}
                  fill="none"
                  strokeWidth={1}
                  style={{ stroke: l.s.color }}
                  opacity={0.7}
                />
                <text x={l.x} y={l.y} textAnchor={right ? 'start' : 'end'} fontSize={FONT}>
                  <tspan x={l.x} dy="-0.2em" fontWeight={700} style={{ fill: l.s.color }}>
                    {l.s.label}
                  </tspan>
                  <tspan x={l.x} dy="1.2em" style={{ fill: INK_FAINT }}>
                    {formatShare(l.s.value / total)}
                  </tspan>
                </text>
              </g>
            )
          })}
        </svg>
      )}
      <ChartTable
        caption={ariaLabel}
        columns={['Value', 'Share']}
        rows={shown.map((s) => ({
          label: s.label,
          cells: [format(s.value), `${formatShare(s.value / total)}`],
        }))}
      />
    </div>
  )
}
