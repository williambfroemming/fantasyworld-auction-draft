import Link from 'next/link'
import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import { managerColor } from '@/lib/colors'
import type { HistoryMember } from '@/lib/history'
import { formatDiff, type PositionalScorecard } from '@/lib/positional'

/**
 * Where each team's points came from, against the league, one season to date.
 *
 * One cell per manager per position: the signed difference between what their starters
 * scored there and what the average manager's starters scored there. Within a position,
 * never across: a column compares managers' receivers with other managers' receivers.
 *
 * Shade is a SECOND encoding of the same number (green above the league, red below, deeper
 * for bigger gaps, scaled to the largest gap anywhere in the grid), and the number is
 * always printed, so nothing depends on colour.
 */
export function PositionalGrid({
  scorecard,
  members,
}: {
  scorecard: PositionalScorecard
  members: HistoryMember[]
}) {
  const byId = new Map(members.map((m) => [m.managerId, m]))
  const rows = [...scorecard.rows].sort((a, b) => b.total - a.total)
  const peak = Math.max(
    1,
    ...scorecard.rows.flatMap((r) => scorecard.positions.map((p) => Math.abs(r.byPosition[p]!.diff))),
  )
  const shade = (diff: number) => {
    const a = Math.round(8 + 42 * (Math.abs(diff) / peak))
    return {
      backgroundColor: `color-mix(in srgb, ${diff >= 0 ? 'var(--e-500)' : 'var(--r-500)'} ${a}%, transparent)`,
    }
  }

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
        <h2 className="flex items-baseline gap-2 font-display text-sm font-bold uppercase tracking-[0.1em]">
          Points by position
          <GlossaryLink anchor="positional-scorecard" label="points by position" />
        </h2>
        <EraBadge
          coverage={{
            from: scorecard.season,
            to: scorecard.season,
            seasons: [scorecard.season],
            label: `Through week ${Math.max(...[0, scorecard.weeks])}`,
          }}
        />
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Started points at each position against the league average there. Green is above it.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Started points at each position compared with the league average, season{' '}
            {scorecard.season}, one row per manager.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
              <th scope="col" className="px-2 py-2 text-left font-display">Manager</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Started</th>
              {scorecard.positions.map((p) => (
                <th key={p} scope="col" className="px-2 py-2 text-right font-display">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = byId.get(r.managerId)
              return (
                <tr key={r.managerId} className="border-t border-rule">
                  <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                    <Link
                      href={`/history/members/${r.managerId}`}
                      className="flex items-baseline gap-2 hover:text-amber-300"
                    >
                      <span
                        aria-hidden
                        className="h-3 w-1 shrink-0"
                        style={{ backgroundColor: managerColor(m?.color ?? '#888') }}
                      />
                      {m?.displayName ?? `#${r.managerId}`}
                    </Link>
                  </th>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.total.toFixed(1)}
                  </td>
                  {scorecard.positions.map((p) => {
                    const d = r.byPosition[p]!.diff
                    return (
                      <td
                        key={p}
                        className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums"
                        style={shade(d)}
                      >
                        {formatDiff(d)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {scorecard.unknownRows > 0 && (
        <p className="mt-2 text-xs text-amber-300">
          {scorecard.unknownRows} started row(s) had no recognised position and are left out of
          the position columns, though they count in Started.
        </p>
      )}
    </section>
  )
}
