'use client'

import { useMemo } from 'react'
import { SPEND_COLUMNS, teamSpend, type StatsInput } from '@/lib/stats'
import { textOn } from '@/lib/colors'

/**
 * Where each manager's $200 went, by position.
 *
 * Backlog §7. §6's market view is the league-wide question ("what have RBs been
 * going for"); this is the same money cut by team ("who went RB-heavy").
 */
export function TeamSpendPanel({ input, className = '' }: { input: StatsInput; className?: string }) {
  const { rows, totals, peak } = useMemo(() => teamSpend(input), [input])
  const byId = useMemo(() => new Map(input.managers.map((m) => [m.id, m])), [input.managers])
  const traded = input.trades.length > 0
  const anyDrift = rows.some((r) => r.drift !== 0)

  return (
    <div className={`flex min-h-0 flex-col rounded-xl border border-rule bg-slate-900/60 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-baseline gap-2 border-b border-rule px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Spend by team
        </h2>
        <span className="text-[11px] text-slate-600">
          ${totals.spent} committed · ${totals.unspent} still on the table
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-2 text-left">Team</th>
              {SPEND_COLUMNS.map((c) => (
                <th key={c} className="px-2 py-2 text-right">
                  {c}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-bold text-slate-400">Spent</th>
              <th className="px-2 py-2 text-right">Left</th>
              <th className="py-2 pl-2 text-right">Plyrs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
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
                  {SPEND_COLUMNS.map((c) => (
                    <td key={c} className="px-2 py-2 text-right">
                      <span className="flex items-center justify-end gap-2">
                        {/* One league-wide scale, so a $110 cell and a $39 cell
                            are comparable across rows as well as within one. */}
                        <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-slate-800 sm:block">
                          <span
                            className="block h-full rounded-full bg-emerald-500/70"
                            style={{ width: `${(r.byPosition[c] / peak) * 100}%` }}
                          />
                        </span>
                        <span
                          className={`w-8 text-right tabular-nums ${
                            r.byPosition[c] === 0 ? 'text-slate-700' : 'text-slate-200'
                          }`}
                        >
                          ${r.byPosition[c]}
                        </span>
                      </span>
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums font-bold">${r.spent}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-400">
                    ${r.unspent}
                    {/* Money that moved without a pick behind it — trade cash or
                        a commissioner correction. Shown so a row that doesn't
                        add up says why instead of just looking wrong. */}
                    {r.drift !== 0 && (
                      <span className="ml-1 text-[10px] text-amber-400">
                        {r.drift > 0 ? '+' : ''}
                        {-r.drift} adj
                      </span>
                    )}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{r.rostered}</td>
                </tr>
              )
            })}
            <tr className="text-[11px] uppercase tracking-wider text-slate-500">
              <td className="py-2 pr-2">League</td>
              {SPEND_COLUMNS.map((c) => (
                <td key={c} className="px-2 py-2 text-right tabular-nums">
                  ${totals.byPosition[c]}
                </td>
              ))}
              <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-300">
                ${totals.spent}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">${totals.unspent}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          Grouped by the player&apos;s real position, not the roster slot they are drawn in.
          OTHER is kickers and defenses — kept here, unlike the market view, so every row adds
          up to what the manager actually spent.
          {traded && (
            <>
              {' '}
              <span className="text-amber-400/80">
                Players have changed hands: this follows the money, not the roster — a traded
                player&apos;s salary stays charged to whoever bought them at auction.
              </span>
            </>
          )}
          {anyDrift && ' “adj” marks money moved by trade cash or a commissioner correction.'}
        </p>
      </div>
    </div>
  )
}
