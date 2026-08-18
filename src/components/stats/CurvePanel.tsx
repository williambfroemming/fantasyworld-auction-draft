'use client'

import { useMemo, useRef, useState } from 'react'
import { spendCurve, type CurvePoint, type StatsInput } from '@/lib/stats'

/**
 * When the money actually left the room.
 *
 * Every other view on /stats is a table or a bar, because every other question
 * here is "how much". This one is "when", and a shape answers that in a way a
 * column of numbers does not: a steep line that flattens is someone who spent
 * their budget in the first three rounds, and a flat line that kicks up at the
 * end is someone who sat on their money and bought the last good running back
 * unopposed. Backlog §7 deferred this precisely because it needed drawing.
 *
 * Two decisions worth keeping:
 *
 * **Small multiples, not ten lines on one chart.** Ten overlapping series is
 * spaghetti at any size, and the league palette — while it passes every
 * colour-separation check — was built to label *columns on a wide grid*, not to
 * disambiguate ten crossing lines. One panel per manager, all sharing the same
 * axes, compares better and never relies on colour alone: every panel is named.
 *
 * **The league curve gets a straight reference line.** A cumulative curve alone
 * is uninformative — it only ever goes up. Against a line from origin to final
 * total, the gap *is* the finding: above it the room front-loaded, below it the
 * room was saving.
 */
export function CurvePanel({ input, className = '' }: { input: StatsInput; className?: string }) {
  const curve = useMemo(() => spendCurve(input), [input])
  const byId = useMemo(() => new Map(input.managers.map((m) => [m.id, m])), [input.managers])

  const [hover, setHover] = useState<{ pickNo: number; spent: number; x: number } | null>(null)
  const leagueRef = useRef<SVGSVGElement>(null)

  const leagueTotal = curve.league.length ? curve.league[curve.league.length - 1].spent : 0

  // Managers ordered by how much they spent, so the panels read as a ranking as
  // well as a set of shapes.
  const ranked = useMemo(
    () => [...curve.managers].sort((a, b) => b.total - a.total),
    [curve.managers],
  )

  if (input.picks.length === 0) {
    return (
      <div
        className={`grid place-items-center rounded-xl border border-rule bg-slate-900/60 text-sm text-slate-500 ${className}`}
      >
        Nothing drafted yet — the curve starts with the first sale.
      </div>
    )
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = leagueRef.current
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const frac = (e.clientX - box.left) / box.width
    const pickNo = Math.round(frac * curve.lastPick)
    // Last point at or before the cursor — the cumulative total *as of* that
    // pick, which is the only honest reading of a step series.
    let found: CurvePoint | null = null
    for (const p of curve.league) {
      if (p.pickNo <= pickNo) found = p
      else break
    }
    setHover({ pickNo: Math.max(0, pickNo), spent: found?.spent ?? 0, x: frac * W })
  }

  return (
    <div className={`flex min-h-0 flex-col gap-3 overflow-auto ${className}`}>
      {/* ---------- the league's own curve ---------- */}
      <section className="shrink-0 rounded-xl border border-rule bg-slate-900/60">
        <div className="flex flex-wrap items-baseline gap-2 border-b border-rule px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            League spend over the draft
          </h2>
          <span className="text-[11px] text-slate-600">
            cumulative dollars by pick — the straight line is an even pace
          </span>
          <span className="ml-auto text-sm font-semibold tabular-nums text-slate-200">
            ${leagueTotal.toLocaleString()}
          </span>
        </div>

        <div className="relative p-3">
          <svg
            ref={leagueRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-40 w-full"
            preserveAspectRatio="none"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`Cumulative league spend reaching $${leagueTotal} over ${curve.lastPick} picks`}
          >
            {/* Recessive gridlines at the quarters. */}
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={0}
                x2={W}
                y1={H - f * H}
                y2={H - f * H}
                stroke="#1e293b"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Even pace: origin to final total. The gap to the curve is the point. */}
            <line
              x1={0}
              y1={H}
              x2={W}
              y2={0}
              stroke="#475569"
              strokeWidth={2}
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
            />

            <path
              d={stepPath(curve.league, curve.lastPick, leagueTotal, W, H)}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {hover && (
              <line
                x1={hover.x}
                x2={hover.x}
                y1={0}
                y2={H}
                stroke="#94a3b8"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-600">
            <span>pick 1</span>
            {hover ? (
              <span className="font-semibold text-slate-300">
                after pick {hover.pickNo}: ${hover.spent.toLocaleString()} spent (
                {Math.round((hover.spent / Math.max(1, leagueTotal)) * 100)}%)
              </span>
            ) : (
              <span>hover for a running total</span>
            )}
            <span>pick {curve.lastPick}</span>
          </div>
        </div>
      </section>

      {/* ---------- one panel per manager ---------- */}
      <section className="rounded-xl border border-rule bg-slate-900/60">
        <div className="flex flex-wrap items-baseline gap-2 border-b border-rule px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Who bought early
          </h2>
          <span className="text-[11px] text-slate-600">
            same axes on every panel, so the shapes compare directly · ½ = the pick they were
            half done spending
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2 p-3">
          {ranked.map((m) => {
            const mgr = byId.get(m.managerId)
            const color = mgr?.color ?? '#94a3b8'
            return (
              <figure
                key={m.managerId}
                className="rounded-lg border border-rule bg-slate-950/40 p-2"
              >
                <figcaption className="mb-1 flex items-baseline gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="truncate text-xs font-semibold text-slate-200">
                    {mgr?.displayName ?? `#${m.managerId}`}
                  </span>
                  <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-slate-300">
                    ${m.total}
                  </span>
                </figcaption>

                <svg
                  viewBox={`0 0 ${W} ${SMALL_H}`}
                  className="h-14 w-full"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${mgr?.displayName ?? 'Manager'} spent $${m.total}${
                    m.halfwayPick ? `, half of it by pick ${m.halfwayPick}` : ''
                  }`}
                >
                  {/* Even pace for THIS manager, to their own total — same
                      reading as the league chart above. */}
                  <line
                    x1={0}
                    y1={SMALL_H - (m.total / curve.peak) * SMALL_H}
                    x2={W}
                    y2={SMALL_H - (m.total / curve.peak) * SMALL_H}
                    stroke="#334155"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={stepPath(m.points, curve.lastPick, curve.peak, W, SMALL_H)}
                    fill="none"
                    style={{ stroke: color }}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {m.halfwayPick !== null && (
                    <line
                      x1={(m.halfwayPick / Math.max(1, curve.lastPick)) * W}
                      x2={(m.halfwayPick / Math.max(1, curve.lastPick)) * W}
                      y1={0}
                      y2={SMALL_H}
                      style={{ stroke: color }}
                      strokeWidth={1}
                      strokeOpacity={0.45}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>

                <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-slate-500">
                  <span>{m.points.length - 1} picks</span>
                  {m.halfwayPick !== null && <span>½ by pick {m.halfwayPick}</span>}
                </div>
              </figure>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// The drawing space. Fixed viewBox with non-scaling strokes: the SVG stretches
// to whatever width the grid cell has, and the 2px lines stay 2px.
const W = 300
const H = 100
const SMALL_H = 60

/**
 * A step path through cumulative points.
 *
 * Step-*after*, deliberately: the total changes AT the pick, not gradually
 * approaching it, and a smoothed line through the points would draw money
 * leaving the room during picks that belonged to somebody else.
 *
 * Extends flat from the final point to `lastPick`, so a manager who stopped
 * buying halfway shows a long flat tail rather than a line that ends early and
 * reads as missing data.
 */
function stepPath(
  points: CurvePoint[],
  lastPick: number,
  yMax: number,
  w: number,
  h: number,
): string {
  if (points.length === 0) return ''
  const xs = (pickNo: number) => (pickNo / Math.max(1, lastPick)) * w
  const ys = (spent: number) => h - (spent / Math.max(1, yMax)) * h

  const first = points[0]
  let d = `M ${xs(first.pickNo)} ${ys(first.spent)}`
  let prev = first
  for (const p of points.slice(1)) {
    d += ` L ${xs(p.pickNo)} ${ys(prev.spent)} L ${xs(p.pickNo)} ${ys(p.spent)}`
    prev = p
  }
  if (prev.pickNo < lastPick) d += ` L ${xs(lastPick)} ${ys(prev.spent)}`
  return d
}
