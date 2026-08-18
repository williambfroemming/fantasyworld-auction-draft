'use client'

import { useMemo } from 'react'
import { managerPace, spendBlocks, type StatsInput } from '@/lib/stats'
import { textOn } from '@/lib/colors'

/**
 * How fast the room is burning money, and who is ahead of it.
 *
 * The most decision-useful view during a live draft: it answers "is the market
 * about to inflate or crash" and "am I rich or poor relative to the field",
 * which are the two questions the old spreadsheet could never answer at all.
 */
export function PacePanel({ input, className = '' }: { input: StatsInput; className?: string }) {
  // Two full rounds per block — derived from the league size rather than
  // hardcoded, so it stays sensible if the league ever changes size.
  const blockSize = Math.max(1, input.managers.length * 2)
  const blocks = useMemo(() => spendBlocks(input.picks, blockSize), [input.picks, blockSize])
  const pace = useMemo(() => managerPace(input), [input])
  const byId = useMemo(() => new Map(input.managers.map((m) => [m.id, m])), [input.managers])

  const peakAvg = Math.max(1, ...blocks.map((b) => b.avg))
  const spread = Math.max(1, ...pace.map((p) => Math.abs(p.vsRoom)))

  if (input.picks.length === 0) {
    return (
      <div className={`grid place-items-center rounded-xl border border-rule bg-slate-900/60 text-sm text-slate-500 ${className}`}>
        Nothing drafted yet.
      </div>
    )
  }

  return (
    <div className={`flex min-h-0 flex-col gap-3 overflow-auto ${className}`}>
      {/* ---- the market's own curve ---- */}
      <div className="shrink-0 rounded-xl border border-rule bg-slate-900/60">
        <div className="flex flex-wrap items-baseline gap-2 border-b border-rule px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Market pace
          </h2>
          <span className="text-[11px] text-slate-600">
            average price per {blockSize} picks — where the money went early
          </span>
        </div>
        <div className="p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2 text-left">Picks</th>
                <th className="px-2 py-2 text-right">Spent</th>
                <th className="px-2 py-2 text-right font-bold text-slate-400">Avg</th>
                <th className="px-2 py-2 text-right">Median</th>
                <th className="px-2 py-2 text-right">Top</th>
                <th className="w-1/3 py-2 pl-2" />
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.index} className="border-b border-rule/60">
                  <td className="py-2 pr-2 tabular-nums text-slate-400">
                    {b.fromPick}–{b.toPick}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">${b.spent}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-100">
                    ${b.avg.toFixed(1)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-400">${b.median}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">${b.max}</td>
                  <td className="py-2 pl-2">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <span
                        className="block h-full rounded-full bg-emerald-500/70"
                        style={{ width: `${(b.avg / peakAvg) * 100}%` }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- who is ahead of it ---- */}
      <div className="shrink-0 rounded-xl border border-rule bg-slate-900/60">
        <div className="flex flex-wrap items-baseline gap-2 border-b border-rule px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Who is ahead of pace
          </h2>
          {/* The word "ahead" is ambiguous between "spent more" and "has more
              left", so it appears only next to its definition, never in the data. */}
          <span className="text-[11px] text-slate-600">
            ahead = more money per remaining slot than the room&apos;s median
          </span>
        </div>
        <div className="p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2 text-left">Team</th>
                <th className="px-2 py-2 text-right">Spent</th>
                <th className="px-2 py-2 text-right">Left</th>
                <th className="px-2 py-2 text-right">Slots</th>
                <th className="px-2 py-2 text-right font-bold text-slate-400">$/slot</th>
                <th className="w-1/3 py-2 pl-2 text-right">vs room</th>
              </tr>
            </thead>
            <tbody>
              {[...pace]
                .sort((a, b) => b.vsRoom - a.vsRoom)
                .map((p) => {
                  const m = byId.get(p.managerId)
                  const full = p.slotsLeft === 0
                  const pct = (Math.abs(p.vsRoom) / spread) * 50
                  return (
                    <tr key={p.managerId} className="border-b border-rule/60">
                      <td className="py-2 pr-2">
                        <span
                          className="inline-block max-w-[9rem] truncate rounded px-1.5 py-0.5 text-xs font-semibold"
                          style={{ backgroundColor: m?.color, color: m ? textOn(m.color) : undefined }}
                        >
                          {m?.displayName ?? p.managerId}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">${p.spent}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-400">
                        ${p.unspent}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                        {p.slotsLeft}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold">
                        {full ? <span className="text-slate-600">—</span> : `$${p.perSlotLeft.toFixed(1)}`}
                      </td>
                      <td className="py-2 pl-2">
                        {full ? (
                          <span className="block text-right text-[10px] uppercase tracking-wider text-slate-600">
                            roster full
                          </span>
                        ) : (
                          // Diverging off a centre line: the one place a second
                          // bar colour earns its keep.
                          <span className="flex items-center gap-2">
                            <span className="relative block h-1.5 flex-1 rounded-full bg-slate-800">
                              <span className="absolute inset-y-0 left-1/2 w-px bg-slate-700" />
                              <span
                                className={`absolute inset-y-0 rounded-full ${
                                  p.vsRoom >= 0 ? 'left-1/2 bg-emerald-500/70' : 'right-1/2 bg-rose-500/70'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            <span
                              className={`w-12 text-right tabular-nums text-[11px] ${
                                p.vsRoom >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {p.vsRoom >= 0 ? '+' : ''}
                              ${p.vsRoom.toFixed(1)}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
            Managers with a full roster are excluded from the room&apos;s median — they cannot
            bid, so their leftover money will never chase another player.
          </p>
        </div>
      </div>
    </div>
  )
}
