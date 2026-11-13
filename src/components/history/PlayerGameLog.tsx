import { EraBadge } from '@/components/history/EraBadge'
import type { Coverage } from '@/lib/history'
import { gameLogCell } from '@/lib/player-stat-totals'
import type { PlayerWeekPoint } from '@/server/history-service'

/**
 * Every week this player was on a roster here, season by season, newest season first, with the
 * NFL stat line behind each. The same weeks the timeline above draws, as words and numbers.
 *
 * Gaps are never read as answers. A week with no stat line prints **"did not play"** only when
 * its fantasy points were exactly 0 (a bye or an inactive: the check on every such week on record
 * found 0 points each time); any other week with no line, such as one from before stats were
 * loaded, prints a dash. The NFL opponent is not stored, so none is shown.
 */
function Row({ w }: { w: PlayerWeekPoint }) {
  const cell = gameLogCell(w.statLine, w.points)
  return (
    <tr className="border-b border-rule/60 align-baseline">
      <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-normal">
        <span className="font-mono tabular-nums">wk {w.week}</span>
        {w.isPlayoff && (
          <span className="ml-1.5 text-[10px] uppercase text-orange-400">playoffs</span>
        )}
      </th>
      <td className="py-1.5 pr-3">{w.displayName}</td>
      <td className="py-1.5 pr-3 text-slate-400">{w.isStarter ? 'started' : 'bench'}</td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{w.points.toFixed(2)}</td>
      <td className="py-1.5 font-mono text-xs tabular-nums">
        {cell.kind === 'line' ? (
          cell.text
        ) : cell.kind === 'did-not-play' ? (
          <span className="text-slate-500">did not play</span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
    </tr>
  )
}

export function PlayerGameLog({
  weekly,
  statsCoverage = null,
}: {
  weekly: PlayerWeekPoint[]
  statsCoverage?: Coverage | null
}) {
  if (weekly.length === 0) return null
  const seasons = [...new Set(weekly.map((w) => w.season))].sort((a, b) => b - a)

  return (
    <section className="mt-10 min-w-0">
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1 font-display text-sm font-bold uppercase tracking-[0.08em]">
        Game log
        {statsCoverage && <EraBadge coverage={statsCoverage} />}
      </h2>
      <p className="mt-2 text-xs text-slate-500">
        Every week on a roster here: league points, and the NFL stat line behind them.
      </p>
      <div className="mt-2 space-y-2">
        {seasons.map((season, i) => {
          const weeks = weekly.filter((w) => w.season === season).sort((a, b) => a.week - b.week)
          return (
            <details key={season} open={i === 0} className="border border-rule">
              <summary className="cursor-pointer select-none px-3 py-2 font-mono text-sm font-bold tabular-nums">
                {season}
                <span className="ml-2 font-sans text-xs font-normal text-slate-500">
                  {weeks.length} week{weeks.length === 1 ? '' : 's'}
                </span>
              </summary>
              <div className="overflow-x-auto px-3 pb-2">
                <table className="w-full min-w-[34rem] border-collapse text-sm">
                  <caption className="sr-only">
                    {season} weeks on a roster, with fantasy points and NFL stat line.
                  </caption>
                  <thead>
                    <tr className="border-b border-rule-strong text-[11px] uppercase tracking-wide text-slate-500">
                      <th scope="col" className="py-1 pr-3 text-left font-normal">
                        Week
                      </th>
                      <th scope="col" className="py-1 pr-3 text-left font-normal">
                        Manager
                      </th>
                      <th scope="col" className="py-1 pr-3 text-left font-normal">
                        Role
                      </th>
                      <th scope="col" className="py-1 pr-3 text-right font-normal">
                        Pts
                      </th>
                      <th scope="col" className="py-1 text-left font-normal">
                        Stat line
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <Row key={`${w.season}-${w.week}-${w.managerId}`} w={w} />
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}
