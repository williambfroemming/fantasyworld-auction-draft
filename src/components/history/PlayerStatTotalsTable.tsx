'use client'

import { useState } from 'react'
import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import type { PlayerStatTotals, StatColumn, StatTableRow } from '@/lib/player-stat-totals'

/**
 * Season and career NFL stat totals for one player (src/lib/player-stat-totals.ts).
 *
 * Every figure is over the weeks he played while on a roster in this league, 2020 on, and
 * the panel says so beside the badge: it is never an NFL season or career. A dash means no
 * played week had a value, which is not the same as a zero.
 */
const show = (v: number | null, c: StatColumn) =>
  v === null
    ? '—'
    : v.toLocaleString('en-US', {
        minimumFractionDigits: c.decimals,
        maximumFractionDigits: c.decimals,
      })

export function PlayerStatTotalsTable({ totals }: { totals: PlayerStatTotals }) {
  const [split, setSplit] = useState<'regular' | 'playoff'>('regular')
  const seasons = totals.seasons.map((s) => s.season)
  const rowOf = (r: { regular: StatTableRow; playoff: StatTableRow }) => r[split]
  const label = split === 'regular' ? 'Regular season' : 'Playoffs'

  return (
    <section className="mt-10 min-w-0">
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1 font-display text-sm font-bold uppercase tracking-[0.08em]">
        <span className="flex items-baseline gap-2">
          Stats by season
          <GlossaryLink anchor="stat-totals" label="stats by season" />
        </span>
        <EraBadge
          coverage={{
            from: seasons[0],
            to: seasons[seasons.length - 1],
            seasons,
            label: 'Stat lines',
          }}
        />
      </h2>
      <p className="mt-2 text-xs text-slate-500">
        NFL stats from weeks rostered in this league, 2020 on. Not career totals.
      </p>

      {totals.hasPlayoffGames && (
        <div
          role="group"
          aria-label="Season type"
          className="mt-3 inline-flex border border-rule text-xs"
        >
          {(['regular', 'playoff'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={split === s}
              onClick={() => setSplit(s)}
              className={`px-3 py-1 font-display uppercase tracking-[0.06em] ${
                split === s ? 'bg-slate-800 text-slate-50' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'regular' ? 'Regular season' : 'Playoffs'}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <caption className="sr-only">
            {label} NFL stats by season, over the weeks played while rostered in this league.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[11px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-1.5 pr-3 text-left font-normal">
                Season
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-normal" title="Games played">
                G
              </th>
              {totals.columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className="px-2 py-1.5 text-right font-normal"
                  title={c.title}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {totals.seasons.map((s) => {
              const r = rowOf(s)
              return (
                <tr key={s.season} className="border-b border-rule/60">
                  <th scope="row" className="py-1.5 pr-3 text-left font-bold">
                    {s.season}
                  </th>
                  <td className="px-2 py-1.5 text-right">{r.games}</td>
                  {totals.columns.map((c, i) => (
                    <td key={c.id} className="px-2 py-1.5 text-right">
                      {show(r.values[i], c)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          <tfoot className="font-mono tabular-nums">
            <tr className="border-t border-rule-strong font-bold">
              <th
                scope="row"
                className="py-1.5 pr-3 text-left font-display text-[11px] uppercase tracking-wide"
              >
                Total
              </th>
              <td className="px-2 py-1.5 text-right">{rowOf(totals.career).games}</td>
              {totals.columns.map((c, i) => (
                <td key={c.id} className="px-2 py-1.5 text-right">
                  {show(rowOf(totals.career).values[i], c)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
