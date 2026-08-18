'use client'

import { useMemo } from 'react'
import { nominationStats, type StatsInput } from '@/lib/stats'
import { textOn } from '@/lib/colors'

/**
 * What each manager's nominations actually did.
 *
 * This is the view that only an auction can have, and it reads a column the app
 * has stored since the first pick and never once looked at. Nominating is a
 * genuine strategic lever — you can put up a player you want, or throw out
 * someone else's target to drain their budget — and until now there was no way
 * to see who was doing which.
 */
export function NominationsPanel({
  input,
  className = '',
}: {
  input: StatsInput
  className?: string
}) {
  const rows = useMemo(() => nominationStats(input), [input])
  const byId = useMemo(() => new Map(input.managers.map((m) => [m.id, m])), [input.managers])
  const peakDriven = Math.max(1, ...rows.map((r) => r.drivenToRivals))

  if (input.picks.length === 0) {
    return (
      <div className={`grid place-items-center rounded-xl border border-rule bg-slate-900/60 text-sm text-slate-500 ${className}`}>
        Nothing nominated yet.
      </div>
    )
  }

  return (
    <div className={`flex min-h-0 flex-col rounded-xl border border-rule bg-slate-900/60 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-baseline gap-2 border-b border-rule px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Nominations
        </h2>
        <span className="text-[11px] text-slate-600">
          who puts players up, and who ends up paying for them
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-2 text-left">Team</th>
              <th className="px-2 py-2 text-right">Put up</th>
              <th className="px-2 py-2 text-right">Won</th>
              <th className="px-2 py-2 text-right font-bold text-slate-400">Win %</th>
              <th className="px-2 py-2 text-right">Own spend</th>
              <th className="px-2 py-2 text-right">$ to rivals</th>
              <th className="w-1/4 py-2 pl-2" />
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => b.drivenToRivals - a.drivenToRivals)
              .map((r) => {
                const m = byId.get(r.managerId)
                return (
                  <tr key={r.managerId} className="border-b border-rule/60">
                    <td className="py-2 pr-2">
                      <span
                        className="inline-block max-w-[9rem] truncate rounded px-1.5 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: m?.color, color: m ? textOn(m.color) : undefined }}
                      >
                        {m?.displayName ?? r.managerId}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                      {r.nominated}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-400">{r.wonOwn}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-100">
                      {Math.round(r.winPct * 100)}%
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                      ${r.spentOnOwn}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-amber-300">
                      ${r.drivenToRivals}
                    </td>
                    <td className="py-2 pl-2">
                      <span className="block h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <span
                          className="block h-full rounded-full bg-amber-400/60"
                          style={{ width: `${(r.drivenToRivals / peakDriven) * 100}%` }}
                        />
                      </span>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          Everyone gets roughly the same number of turns, so the count is context — the
          interesting columns are the win rate and the money you sent to somebody else&apos;s
          roster. A low win rate is not automatically bad: putting up players you do not want
          is how you drain a rival&apos;s budget. Credit follows whoever bought the player at
          auction, so a later trade cannot rewrite who won their own nomination.
          {input.season === 2026 && (
            <>
              {' '}
              <span className="text-amber-400/80">
                2026 note: the final 8 picks were entered by hand after the draft stalled, with
                the buyer recorded as their own nominator — so “won” is a touch high for
                Daniel, Mario, Nate and Eric/Blakey.
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
