'use client'

import { ChartTable } from './ChartTable'
import { INK_SOFT } from './colors'
import { formatValue, type Fmt } from './format'
import { useWidth } from './useWidth'

export interface Segment {
  key: string
  label: string
  value: number
  color: string
}

export interface StackRow {
  id: string
  label: string
  segments: Segment[]
}

const ROW_H = 28
const FONT = 11

/**
 * One bar per item, split into segments. With `normalize` (the default) every bar is full
 * width and segments show shares; without it, bar length is the row's total.
 *
 * A segment is labelled in place only if the label fits; the legend always names them all,
 * so nothing relies on colour alone.
 */
export function StackedBar({
  rows,
  ariaLabel,
  format: fmt,
  normalize = true,
}: {
  rows: StackRow[]
  ariaLabel: string
  format?: Fmt
  normalize?: boolean
}) {
  const format = (v: number) => formatValue(fmt, v)
  const [ref, width, ready] = useWidth()
  const labelW = Math.min(90, Math.round(width * 0.22))
  const barW = Math.max(40, width - labelW - 4)
  const totals = rows.map((r) => r.segments.reduce((a, s) => a + Math.max(0, s.value), 0))
  const widest = Math.max(1, ...totals)
  const height = rows.length * ROW_H + 4

  const legend: Segment[] = []
  for (const r of rows)
    for (const s of r.segments) if (!legend.some((l) => l.key === s.key)) legend.push(s)

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
          {rows.map((r, i) => {
            const total = totals[i]
            const scale = normalize ? (total > 0 ? barW / total : 0) : barW / widest
            let x = labelW
            return (
              <g key={r.id}>
                <text
                  x={labelW - 8}
                  y={i * ROW_H + ROW_H / 2 + 2}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={FONT + 1}
                  style={{ fill: INK_SOFT }}
                >
                  {r.label}
                </text>
                {r.segments.map((s) => {
                  const w = Math.max(0, s.value) * scale
                  const x0 = x
                  x += w
                  const share = total > 0 ? Math.round((s.value / total) * 100) : 0
                  return (
                    <g key={s.key}>
                      <rect
                        x={x0}
                        y={i * ROW_H + 4}
                        width={Math.max(0, w - 1)}
                        height={ROW_H - 8}
                        style={{ fill: s.color }}
                      >
                        <title>{`${r.label} — ${s.label}: ${format(s.value)} (${share}%)`}</title>
                      </rect>
                      {w >= 34 && (
                        <text
                          x={x0 + w / 2}
                          y={i * ROW_H + ROW_H / 2 + 2}
                          dy="0.32em"
                          textAnchor="middle"
                          fontSize={FONT}
                          fontWeight={700}
                          style={{ fill: 'var(--s-950)' }}
                          pointerEvents="none"
                        >
                          {share}%
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      )}

      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400" aria-hidden>
        {legend.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5" style={{ backgroundColor: l.color }} />
            {l.label}
          </li>
        ))}
      </ul>

      <ChartTable
        caption={ariaLabel}
        columns={legend.map((l) => l.label)}
        rows={rows.map((r) => ({
          label: r.label,
          cells: legend.map((l) => {
            const s = r.segments.find((q) => q.key === l.key)
            return s ? format(s.value) : null
          }),
        }))}
      />
    </div>
  )
}
