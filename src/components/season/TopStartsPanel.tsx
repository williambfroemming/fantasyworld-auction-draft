import Link from 'next/link'
import { EraBadge } from '@/components/history/EraBadge'
import { managerColor } from '@/lib/colors'
import type { HistoryMember } from '@/lib/history'
import type { TopStart } from '@/server/history-service'

/**
 * The week's biggest starts: the five highest-scoring players anyone started in the latest
 * COMPLETED week, with the NFL line behind each and who started him. Highest fantasy points is a
 * plain statement about points scored, so it spans positions; the stat line is the explanation
 * and nothing here is ranked by it. Drawn only while a season is underway.
 */
export function TopStartsPanel({
  season,
  week,
  starts,
  members,
}: {
  season: number
  week: number
  starts: TopStart[]
  members: HistoryMember[]
}) {
  const byId = new Map(members.map((m) => [m.managerId, m]))
  return (
    <section className="min-w-0">
      <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
        Week {week}&rsquo;s biggest starts
        <EraBadge
          coverage={{ from: season, to: season, seasons: [season], label: `Week ${week}` }}
        />
      </h2>
      <ol className="space-y-2">
        {starts.map((s, i) => {
          const m = byId.get(s.managerId)
          return (
            <li key={s.playerId} className="text-sm">
              <div className="leaders">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="w-3 shrink-0 font-mono text-xs text-slate-500 tabular-nums">
                    {i + 1}
                  </span>
                  <Link
                    href={`/history/players/${encodeURIComponent(s.playerId)}`}
                    className="font-semibold hover:underline"
                  >
                    {s.playerName}
                  </Link>
                  {s.position && (
                    <span className="font-mono text-[0.62rem] text-slate-600">{s.position}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums">
                  {s.points.toFixed(1)}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 pl-5 text-[0.7rem] text-slate-500">
                {m && (
                  <span className="flex items-baseline gap-1">
                    <span
                      aria-hidden
                      className="h-2 w-1 self-center"
                      style={{ backgroundColor: managerColor(m.color) }}
                    />
                    {m.displayName}
                  </span>
                )}
                {s.statLine && (
                  <span className="font-mono tabular-nums text-slate-400">{s.statLine}</span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-xs text-slate-500">
        Started players only. Fantasy points, with the NFL stats behind them.
      </p>
    </section>
  )
}
