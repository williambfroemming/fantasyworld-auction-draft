'use client'

import { useMemo, useState } from 'react'
import { ChartTable } from './ChartTable'
import { GRID, INK_FAINT } from './colors'
import { formatValue, type Fmt } from './format'
import { linearScale, niceTicks, spreadLabels } from './scale'
import { useWidth } from './useWidth'

export interface LineSeries {
  id: string
  label: string
  color: string
  /** A null `y` breaks the line. It is unknown, and is never drawn as zero. */
  points: Array<{ x: number; y: number | null }>
}

interface Props {
  series: LineSeries[]
  /** How x ticks and the data table print x. A spec, not a function: see format.ts. */
  xFormat?: Fmt
  yFormat?: Fmt
  ariaLabel: string
  height?: number
  /** Fix the y range (otherwise fitted to the data with nice ticks). */
  yDomain?: [number, number]
  /** Explicit tick values, e.g. 1..10 for a rank axis. */
  yTicks?: number[]
  /** Put the smallest y at the top, for ranks where 1 is best. */
  invertY?: boolean
}

const FONT = 11
const LABEL_GAP = 13

/**
 * Lines over a shared x axis, labelled at their right-hand end instead of in a legend.
 *
 * - A null `y` breaks the line; a point on its own is drawn as a dot.
 * - End labels are nudged apart so ten crowded finishes stay legible.
 * - Hovering or focusing a line dims the rest. Every line is keyboard-focusable.
 */
export function LineChart({
  series,
  xFormat = { thousands: false },
  yFormat,
  ariaLabel,
  height = 320,
  yDomain,
  yTicks,
  invertY = false,
}: Props) {
  const [ref, width, ready] = useWidth()
  const [active, setActive] = useState<string | null>(null)

  const labelW = width >= 520 ? 104 : 76
  const m = { top: 12, right: labelW, bottom: 28, left: 44 }
  const plotW = Math.max(40, width - m.left - m.right)
  const plotH = Math.max(40, height - m.top - m.bottom)

  const model = useMemo(() => {
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b)
    const ys = series.flatMap((s) => s.points.flatMap((p) => (p.y === null ? [] : [p.y])))
    const ticks =
      yTicks ??
      (yDomain
        ? niceTicks(yDomain[0], yDomain[1])
        : niceTicks(Math.min(...ys, 0), Math.max(...ys, 1)))
    return { xs, ticks }
  }, [series, yDomain, yTicks])

  const { xs, ticks } = model
  const xLabel = (x: number) => formatValue(xFormat, x)
  const yLabel = (y: number) => formatValue(yFormat, y)
  if (xs.length === 0) {
    return <p className="text-sm text-slate-500">Nothing to draw yet.</p>
  }

  const y0 = yDomain ? yDomain[0] : ticks[0]
  const y1 = yDomain ? yDomain[1] : ticks[ticks.length - 1]
  const sx = linearScale([xs[0], xs[xs.length - 1]], [0, plotW])
  const sy = linearScale([y0, y1], invertY ? [0, plotH] : [plotH, 0])

  // Thin the x ticks so they never collide.
  const stride = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(plotW / 52))))
  const xTicks = xs.filter((_, i) => i % stride === 0 || i === xs.length - 1)

  // Direct labels at each line's last known point.
  const ends = series.flatMap((s) => {
    const known = s.points.filter((p): p is { x: number; y: number } => p.y !== null)
    const last = known[known.length - 1]
    return last ? [{ s, last }] : []
  })
  const labelY = spreadLabels(
    ends.map((e) => sy(e.last.y)),
    LABEL_GAP,
    0,
    plotH,
  )
  const maxChars = Math.floor((labelW - 12) / (FONT * 0.56))
  const clip = (t: string) =>
    t.length > maxChars ? t.slice(0, Math.max(1, maxChars - 1)) + '…' : t

  const dim = (id: string) => (active && active !== id ? 0.2 : 1)

  return (
    <div ref={ref} className="w-full" style={{ minHeight: height }}>
      {ready && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          className="block max-w-full overflow-visible"
        >
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={0}
                  x2={plotW}
                  y1={sy(t)}
                  y2={sy(t)}
                  // Zero is the reference line on a chart that goes below it (a difference from
                  // an average), so it is drawn heavier than the other gridlines.
                  style={{ stroke: t === 0 && ticks[0] < 0 ? INK_FAINT : GRID }}
                  strokeWidth={t === 0 && ticks[0] < 0 ? 1.5 : 1}
                  opacity={t === 0 && ticks[0] < 0 ? 0.9 : 0.6}
                />
                <text
                  x={-8}
                  y={sy(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={FONT}
                  style={{ fill: INK_FAINT }}
                >
                  {yLabel(t)}
                </text>
              </g>
            ))}
            {xTicks.map((x) => (
              <text
                key={x}
                x={sx(x)}
                y={plotH + 18}
                textAnchor="middle"
                fontSize={FONT}
                style={{ fill: INK_FAINT }}
              >
                {xLabel(x)}
              </text>
            ))}

            {series.map((s) => {
              const segments: Array<Array<{ x: number; y: number }>> = []
              let cur: Array<{ x: number; y: number }> = []
              for (const p of [...s.points].sort((a, b) => a.x - b.x)) {
                if (p.y === null) {
                  if (cur.length) segments.push(cur)
                  cur = []
                } else cur.push({ x: p.x, y: p.y })
              }
              if (cur.length) segments.push(cur)
              const showDots = xs.length <= 24
              return (
                <g
                  key={s.id}
                  tabIndex={0}
                  opacity={dim(s.id)}
                  onMouseEnter={() => setActive(s.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(s.id)}
                  onBlur={() => setActive(null)}
                  style={{ outline: 'none', cursor: 'default' }}
                >
                  {segments.map((seg, i) =>
                    seg.length === 1 ? (
                      <circle
                        key={i}
                        cx={sx(seg[0].x)}
                        cy={sy(seg[0].y)}
                        r={3}
                        style={{ fill: s.color }}
                      />
                    ) : (
                      <path
                        key={i}
                        d={seg
                          .map(
                            (p, k) => `${k ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`,
                          )
                          .join(' ')}
                        fill="none"
                        strokeWidth={active === s.id ? 3 : 2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        style={{ stroke: s.color }}
                      />
                    ),
                  )}
                  {showDots &&
                    segments.flatMap((seg) =>
                      seg.length > 1
                        ? seg.map((p) => (
                            <circle
                              key={p.x}
                              cx={sx(p.x)}
                              cy={sy(p.y)}
                              r={2.25}
                              style={{ fill: s.color }}
                            />
                          ))
                        : [],
                    )}
                  {/* A wide invisible stroke makes the line easy to hover. */}
                  {segments.map((seg, i) =>
                    seg.length > 1 ? (
                      <path
                        key={`hit${i}`}
                        d={seg
                          .map(
                            (p, k) => `${k ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`,
                          )
                          .join(' ')}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                      />
                    ) : null,
                  )}
                </g>
              )
            })}

            {ends.map((e, i) => (
              <text
                key={e.s.id}
                x={sx(e.last.x) + 8}
                y={labelY[i]}
                dy="0.32em"
                fontSize={FONT}
                fontWeight={active === e.s.id ? 700 : 600}
                opacity={dim(e.s.id)}
                style={{ fill: e.s.color }}
              >
                {clip(e.s.label)}
              </text>
            ))}
          </g>
          <title>{ariaLabel}</title>
        </svg>
      )}

      <ChartTable
        caption={ariaLabel}
        columns={xs.map(xLabel)}
        rows={series.map((s) => ({
          label: s.label,
          cells: xs.map((x) => {
            const p = s.points.find((q) => q.x === x)
            return p && p.y !== null ? yLabel(p.y) : null
          }),
        }))}
      />
    </div>
  )
}
