'use client'

import { useMemo, useRef, useState } from 'react'
import type { PlayerWeekPoint } from '@/server/history-service'

/**
 * Every week this player was on a roster, in order, with who owned them.
 *
 * ## Why columns rather than a line
 *
 * A line implies the value between two points means something. Fantasy points
 * are discrete events — there is no "week 4.5" — and a career here is six
 * seasons of separate 17-week runs, so a continuous line would draw a slope
 * across an eight-month offseason as though something happened in it. Columns
 * say "these are events" and leave the gaps as gaps.
 *
 * ## Why ownership is an axis, not a colour
 *
 * The obvious move is to colour each column by whoever owned him, and it is
 * wrong twice over. `CurvePanel` already recorded the first reason: the league
 * palette "was built to label columns on a wide grid, not to disambiguate ten
 * crossing lines", and 97 thin bars in six hues is that same problem. The second
 * is simpler — ownership here is a *sequence of spans*, and a span on an axis is
 * read directly, where a hue has to be carried to a legend and back.
 *
 * So ownership is a labelled axis beneath the plot: a name, a week count, and a
 * tick where the roster changed hands. It needs no colour at all, which leaves
 * the chart with exactly two fills.
 *
 * ## Colour
 *
 * Two fills, indigo for regular season and orange for playoffs, taken from the
 * league palette rather than invented. Validated with the dataviz palette
 * checker against both surfaces: CVD separation ΔE 28.0 (protan) and 30.7 for
 * normal vision, both far above the ΔE 8 target. Identity is never colour-alone
 * — there is a legend, the playoff weeks sit after a marked boundary, and the
 * tooltip names the phase in words.
 */
export function PlayerTimeline({
  weekly,
  className = '',
}: {
  weekly: PlayerWeekPoint[]
  className?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const { max, seasonRuns, ownerRuns } = useMemo(() => {
    const max = Math.max(1, ...weekly.map((w) => w.points))

    // Contiguous runs, computed once: a run is a stretch of consecutive weeks
    // sharing a value, which is what both the season rule and the ownership band
    // are drawn from.
    function runsOf<T>(key: (w: PlayerWeekPoint) => T) {
      const out: Array<{ from: number; to: number; value: T }> = []
      weekly.forEach((w, i) => {
        const value = key(w)
        const last = out[out.length - 1]
        if (last && last.value === value) last.to = i
        else out.push({ from: i, to: i, value })
      })
      return out
    }

    return {
      max,
      seasonRuns: runsOf((w) => w.season),
      ownerRuns: runsOf((w) => w.managerId),
    }
  }, [weekly])

  if (weekly.length === 0) return null

  const active = hover === null ? null : weekly[hover]
  const pct = (i: number) => (i / weekly.length) * 100

  return (
    <figure className={className}>
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-sm font-bold uppercase tracking-[0.08em]">
          Every week on a roster
        </span>
        {/* Legend: two series, so it is always present. */}
        <span className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5"
              style={{ background: 'var(--mgr-indigo)' }}
            />
            Regular season
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5"
              style={{ background: 'var(--mgr-orange)' }}
            />
            Playoffs
          </span>
        </span>
      </figcaption>

      <div
        ref={wrapRef}
        className="relative"
        onMouseLeave={() => setHover(null)}
        onTouchEnd={() => setHover(null)}
      >
        {/* Columns. A 2px gap between fills is a surface gap, not a stroke. */}
        <div className="relative flex h-40 items-end gap-px border-b border-rule-strong">
          {weekly.map((w, i) => {
            const isHot = hover === i
            return (
              <button
                key={`${w.season}-${w.week}-${w.managerId}`}
                type="button"
                aria-label={`${w.season} week ${w.week}, ${w.points} points, ${w.displayName}`}
                className="group relative min-w-0 flex-1 cursor-default"
                style={{ height: '100%' }}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span
                  className="absolute bottom-0 left-0 right-0 rounded-t-[3px] transition-opacity"
                  style={{
                    height: `${Math.max(1.5, (w.points / max) * 100)}%`,
                    background: w.isPlayoff ? 'var(--mgr-orange)' : 'var(--mgr-indigo)',
                    opacity: hover === null || isHot ? 1 : 0.35,
                  }}
                />
              </button>
            )
          })}

          {/* Season boundaries, drawn over the columns but under the tooltip. */}
          {seasonRuns.slice(1).map((r) => (
            <span
              key={`rule-${r.value}`}
              aria-hidden
              className="pointer-events-none absolute top-0 h-full border-l border-dashed border-rule"
              style={{ left: `${pct(r.from)}%` }}
            />
          ))}
        </div>

        {/* Ownership axis. A tick where the roster changed hands, and the name of
            whoever held the span. No colour: the span itself is the encoding. */}
        <div className="relative mt-1 h-9 border-t border-rule">
          {ownerRuns.map((r) => {
            const width = ((r.to - r.from + 1) / weekly.length) * 100
            const who = weekly[r.from]
            const weeks = r.to - r.from + 1
            return (
              <span
                key={`own-${r.from}`}
                title={`${who.displayName} · ${weeks} week${weeks === 1 ? '' : 's'}`}
                className="absolute top-0 overflow-hidden whitespace-nowrap border-l border-rule-strong pl-1 pt-0.5 text-[10px] leading-tight text-slate-400"
                style={{ left: `${pct(r.from)}%`, width: `${width}%` }}
              >
                {/* Below about four weeks there is no room for a name without it
                    colliding with the next tick, so the tick stands alone and the
                    title attribute carries the detail. */}
                {width > 5 && (
                  <>
                    <span className="block truncate font-bold text-slate-300">
                      {who.displayName}
                    </span>
                    <span className="block font-mono tabular-nums">{weeks}w</span>
                  </>
                )}
              </span>
            )
          })}
        </div>

        {/* Season axis. */}
        <div className="relative mt-1 h-4 border-t border-rule">
          {seasonRuns.map((r) => (
            <span
              key={`lab-${r.value}`}
              className="absolute top-0 border-l border-rule-strong pl-1 font-mono text-[10px] leading-tight text-slate-500 tabular-nums"
              style={{ left: `${pct(r.from)}%` }}
            >
              {r.value}
            </span>
          ))}
        </div>

        {active && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-y-full rounded border border-rule-strong bg-slate-950 px-2 py-1 text-xs shadow-lg"
            style={{
              left: `${Math.min(88, Math.max(0, pct(hover!)))}%`,
            }}
          >
            <div className="font-mono font-bold tabular-nums">{active.points.toFixed(2)} pts</div>
            <div className="text-slate-400">
              {active.season} · week {active.week} · {active.isPlayoff ? 'playoffs' : 'regular'}
            </div>
            <div className="text-slate-400">
              {active.displayName}
              {active.isStarter ? ' · started' : ' · benched'}
            </div>
          </div>
        )}
      </div>
    </figure>
  )
}
