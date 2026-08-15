'use client'

import { useMemo } from 'react'
import { MARKET_POSITIONS, positionMarket } from '@/lib/draft'
import type { BoardCell } from './LeagueBoard'

/**
 * What the money has actually been going to, by position.
 *
 * §3 in the backlog answers "how much money is left"; this answers "what has it
 * been going to" — whether RBs are going over book, what the QBs actually cost,
 * how much is still on the board at a position.
 *
 * Lives on /board rather than in the draft-screen side panel, for the reason
 * commit 725518d already settled once: the draft screen deliberately gives its
 * space to the lot, and a positional matrix is the same shape of wide, dense view
 * that got moved out. This is a between-picks screen.
 */
export function MarketPanel({
  rosters,
  pool,
  className = '',
}: {
  rosters: BoardCell[]
  /** Undrafted players, when known. Absent for an archived season. */
  pool?: Array<{ position: string }>
  className?: string
}) {
  const rows = useMemo(() => positionMarket(rosters, pool ?? []), [rosters, pool])

  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
  const totalDrafted = rows.reduce((s, r) => s + r.drafted, 0)
  // The widest bar sets the scale; a bar chart of four values needs no axis.
  const peak = Math.max(1, ...rows.map((r) => r.spent))

  if (totalDrafted === 0) {
    return (
      <div className={`grid place-items-center rounded-xl border border-slate-800 bg-slate-900/60 text-sm text-slate-500 ${className}`}>
        Nothing drafted yet.
      </div>
    )
  }

  return (
    <div className={`flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 ${className}`}>
      <div className="flex shrink-0 items-baseline gap-2 border-b border-slate-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Market by position
        </h2>
        <span className="text-[11px] text-slate-600">
          {totalDrafted} players · ${totalSpent} — QB/RB/WR/TE only
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-2 text-left">Pos</th>
              <th className="px-2 py-2 text-right">Drafted</th>
              <th className="px-2 py-2 text-right">Spent</th>
              <th className="px-2 py-2 text-right">Share</th>
              {/* Median leads: one panic buy skews a mean badly at this sample size. */}
              <th className="px-2 py-2 text-right font-bold text-slate-400">Median</th>
              <th className="px-2 py-2 text-right">Avg</th>
              <th className="px-2 py-2 text-right">Range</th>
              {pool && <th className="py-2 pl-2 text-right">Left</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.position} className="border-b border-slate-800/60">
                <td className="py-2 pr-2">
                  <span className="font-bold text-slate-200">{r.position}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-400">{r.drafted}</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">${r.spent}</td>
                <td className="px-2 py-2 text-right">
                  <span className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                      <span
                        className="block h-full rounded-full bg-emerald-500/70"
                        style={{ width: `${(r.spent / peak) * 100}%` }}
                      />
                    </span>
                    <span className="w-9 text-right text-[11px] tabular-nums text-slate-500">
                      {totalSpent ? Math.round((r.spent / totalSpent) * 100) : 0}%
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-100">
                  ${r.median % 1 === 0 ? r.median : r.median.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                  ${r.mean.toFixed(1)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                  ${r.min}–${r.max}
                </td>
                {pool && (
                  <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{r.remaining}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          Grouped by the player&apos;s real position, not the roster slot they are drawn in — a WR in
          your FLEX is still a WR. Kickers and defenses are excluded: they go for a dollar or two and
          would drag every figure here toward the floor.
        </p>
      </div>
    </div>
  )
}

/**
 * The compact version for the draft-screen sidebar: your own spend split, one
 * line. The full matrix stays on /board where there is room for it.
 */
export function MySpendSplit({ picks }: { picks: BoardCell[] }) {
  const rows = positionMarket(picks).filter((r) => r.drafted > 0)
  if (rows.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
      {MARKET_POSITIONS.filter((p) => rows.some((r) => r.position === p)).map((pos) => {
        const r = rows.find((x) => x.position === pos)!
        return (
          <span key={pos} className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
            {pos} <span className="font-bold text-slate-200">${r.spent}</span>
          </span>
        )
      })}
    </div>
  )
}
