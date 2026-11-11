import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import { formatDiff, POSITIONS, type MemberPositionalSeason, type Position } from '@/lib/positional'

/**
 * One manager, season by season: the signed difference between their starters' points at
 * each position and the league average there (src/lib/positional.ts). Weekly data only, so
 * 2020 on; the badge says so.
 *
 * A column that does not exist in a season (no kickers in this league) prints a dash, not
 * a zero: the position was not played, which is not the same as scoring nothing there.
 */
export function MemberPositionalTable({ seasons }: { seasons: MemberPositionalSeason[] }) {
  const positions = POSITIONS.filter((p) => seasons.some((s) => p in s.diffs))
  const years = seasons.map((s) => s.season).sort((a, b) => a - b)

  return (
    <section className="mt-10 min-w-0">
      <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
        <span className="flex items-baseline gap-2">
          Points by position
          <GlossaryLink anchor="positional-scorecard" label="points by position" />
        </span>
        <EraBadge
          coverage={{ from: years[0], to: years[years.length - 1], seasons: years, label: 'Weekly' }}
        />
      </h2>
      <p className="mb-3 text-xs text-slate-400">
        Started points at each position against the league average there, regular season. Green
        is above it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Started points at each position compared with the league average, one row per season.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
              <th scope="col" className="px-2 py-2 text-left font-display">Season</th>
              {positions.map((p) => (
                <th key={p} scope="col" className="px-2 py-2 text-right font-display">{p}</th>
              ))}
              <th scope="col" className="px-2 py-2 text-right font-display">Started</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.season} className="border-b border-rule/60">
                <th scope="row" className="px-2 py-1.5 text-left font-mono tabular-nums">{s.season}</th>
                {positions.map((p: Position) => {
                  const d = s.diffs[p]
                  return (
                    <td
                      key={p}
                      className={`px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums ${
                        d === undefined
                          ? 'text-slate-600'
                          : d > 0.05
                            ? 'text-emerald-400'
                            : d < -0.05
                              ? 'text-rose-400'
                              : 'text-slate-400'
                      }`}
                    >
                      {d === undefined ? '—' : formatDiff(d)}
                    </td>
                  )
                })}
                <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                  {s.total.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
