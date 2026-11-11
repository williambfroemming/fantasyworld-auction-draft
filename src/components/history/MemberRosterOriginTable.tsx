import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import { ORIGIN_COLORS } from '@/components/history/RosterOriginChart'
import { ORIGIN_LABELS, ORIGIN_PARTS, type MemberOriginSeason } from '@/lib/roster-origin'

/**
 * One manager, season by season: what share of their started points came from players they
 * bought at the auction, and what share from players they added afterwards. Needs both an
 * auction and weekly data, so 2021 on; the badge says so. Shares are printed as text; the
 * small bar is a second encoding, not the only one.
 */
export function MemberRosterOriginTable({ seasons }: { seasons: MemberOriginSeason[] }) {
  const years = seasons.map((s) => s.season).sort((a, b) => a - b)
  const parts = seasons[0] ? [...new Set(seasons.flatMap((s) => s.parts))] : []
  const order = ORIGIN_PARTS.filter((p) => parts.includes(p))
  const pct = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '—')

  return (
    <section className="mt-10 min-w-0">
      <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
        <span className="flex items-baseline gap-2">
          How the roster was built
          <GlossaryLink anchor="roster-origin" label="how the roster was built" />
        </span>
        <EraBadge
          coverage={{
            from: years[0],
            to: years[years.length - 1],
            seasons: years,
            label: 'Auction + weekly',
          }}
        />
      </h2>
      <p className="mb-3 text-xs text-slate-400">
        Share of started points, regular season, by where the player came from.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Share of started points from drafted players and from players added later, one row per
            season.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
              <th scope="col" className="px-2 py-2 text-left font-display">
                Season
              </th>
              {order.map((p) => (
                <th key={p} scope="col" className="px-2 py-2 text-right font-display">
                  <span
                    aria-hidden
                    className="mr-1 inline-block h-2 w-2"
                    style={{ backgroundColor: ORIGIN_COLORS[p] }}
                  />
                  {ORIGIN_LABELS[p]}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right font-display">
                Started
              </th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.season} className="border-b border-rule/60">
                <th scope="row" className="px-2 py-1.5 text-left font-mono tabular-nums">
                  {s.season}
                </th>
                {order.map((p) => (
                  <td key={p} className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {s.parts.includes(p) ? pct(s.row[p], s.row.total) : '—'}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                  {s.row.total.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
