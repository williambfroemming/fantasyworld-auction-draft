import { LineChart } from '@/components/charts/LineChart'
import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import { HeaderControls } from '@/components/HeaderControls'
import { SiteNav } from '@/components/SiteNav'
import { managerColor } from '@/lib/colors'
import { coverageFor } from '@/lib/history'
import { peakAndLow, ratingHistory } from '@/lib/rating'
import { ratingChart } from '@/lib/rating-series'
import { getHistoryInput } from '@/server/history-service'

/**
 * Strength rating over time (src/lib/rating.ts): a model of how strong each team has looked,
 * game by game, 2020 on. A Server Component; the chart receives plain data.
 */
export const revalidate = 3600

export const metadata = { title: 'Ratings — FantasyWorld' }

export default async function RatingsPage() {
  const input = await getHistoryInput()
  const history = ratingHistory(input.matchups)
  const member = new Map(input.members.map((m) => [m.managerId, m]))
  const who = (id: number) => {
    const m = member.get(id)
    return { name: m?.displayName ?? `#${id}`, color: m ? managerColor(m.color) : 'var(--s-400)' }
  }
  const chart = ratingChart(history, who)
  const coverage = coverageFor(input.seasons, ['weekly'], 'Weekly', new Set(input.matchups.map((m) => m.season)))

  const rows = history
    .map((m) => {
      const pl = peakAndLow(m.points)
      return pl ? { managerId: m.managerId, now: m.points[m.points.length - 1].rating, ...pl } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.now - a.now)

  const when = (e: { season: number; week: number }) => `wk ${e.week} · ${e.season}`

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/ratings" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Ratings</h1>
        <div className="ml-auto">
          <HeaderControls />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-10 px-4 py-6">
        <section className="min-w-0">
          <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
            <span className="flex items-baseline gap-2">
              Strength rating, game by game
              <GlossaryLink anchor="strength-rating" label="strength rating" />
            </span>
            <EraBadge coverage={coverage} />
          </h2>
          <p className="mb-3 text-xs text-slate-400">
            A model, not a record. Everyone starts at 1500; beating a stronger team, and winning
            big, moves a rating more. Each rating drifts a third of the way back to 1500 between
            seasons. Dashed lines mark the start of each season. Regular season and the playoff
            games that count.
          </p>
          {chart.series.length === 0 ? (
            <p className="text-sm text-slate-500">No games on record yet.</p>
          ) : (
            <LineChart
              series={chart.series}
              xLabels={chart.labels}
              xMarks={chart.marks}
              yDomain={chart.yDomain}
              yFormat={{ decimals: 0, thousands: false }}
              height={380}
              ariaLabel="Strength rating of each manager after every game, 2020 on"
            />
          )}
        </section>

        {rows.length > 0 && (
          <section className="min-w-0">
            <h2 className="mb-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
              Peak and low
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Each manager&apos;s current, highest and lowest rating and when they happened.
                </caption>
                <thead>
                  <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
                    <th scope="col" className="px-2 py-2 text-left font-display">Manager</th>
                    <th scope="col" className="px-2 py-2 text-right font-display">Now</th>
                    <th scope="col" className="px-2 py-2 text-right font-display">Peak</th>
                    <th scope="col" className="px-2 py-2 text-right font-display">When</th>
                    <th scope="col" className="px-2 py-2 text-right font-display">Low</th>
                    <th scope="col" className="px-2 py-2 text-right font-display">When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const w = who(r.managerId)
                    return (
                      <tr key={r.managerId} className="border-b border-rule/60">
                        <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                          <span className="flex items-baseline gap-1.5">
                            <span aria-hidden className="h-2.5 w-1 self-center" style={{ backgroundColor: w.color }} />
                            {w.name}
                          </span>
                        </th>
                        <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums">
                          {Math.round(r.now)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-emerald-400">
                          {Math.round(r.peak.rating)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[0.7rem] tabular-nums text-slate-500">
                          {when(r.peak)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-rose-400">
                          {Math.round(r.low.rating)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[0.7rem] tabular-nums text-slate-500">
                          {when(r.low)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
