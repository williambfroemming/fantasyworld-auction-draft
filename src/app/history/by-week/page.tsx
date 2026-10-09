import Link from 'next/link'
import { GlossaryLink } from '@/components/GlossaryLink'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { managerColor } from '@/lib/colors'
import { MIN_SAMPLE, recordCell, type RecordCell } from '@/lib/record-paths'
import { getRecordPaths } from '@/server/history-service'

/**
 * After week N at W-L: how many teams have been there, and how many got in.
 *
 * Rows are weeks, columns are wins, so a season is a walk down the grid — one
 * row a week, one column right for a win. This season's managers are drawn in
 * the cell they are standing in, which is what makes the page worth reopening:
 * every Tuesday each of them moves.
 *
 * ## Reading the colour
 *
 * The same diverging scale as Head to Head, centred on the league's own
 * playoff rate rather than on 50% — six of ten get in, so a cell at 60% is the
 * neutral one and is left untinted. A cell below `MIN_SAMPLE` is never tinted
 * at all: shading "0 of 2" red would make two teams look like a rule.
 */
export const revalidate = 3600

export const metadata = { title: 'Record by week — FantasyWorld' }

export default async function RecordByWeekPage() {
  const { paths, members } = await getRecordPaths()
  const byId = new Map(members.map((m) => [m.managerId, m]))

  const totals = paths.cells
    .filter((c) => c.week === 1)
    .reduce((t, c) => ({ teams: t.teams + c.teams, made: t.made + c.made }), { teams: 0, made: 0 })
  const base = totals.teams ? totals.made / totals.teams : 0.6

  const first = paths.seasons[0]
  const last = paths.seasons[paths.seasons.length - 1]
  const weeks = Array.from({ length: paths.weeks }, (_, i) => i + 1)
  const wins = Array.from({ length: paths.weeks + 1 }, (_, i) => i)

  const tint = (c: RecordCell) => {
    if (c.teams < MIN_SAMPLE) return undefined
    const rate = c.made / c.teams
    // 0 at the league's own rate, 1 at certain either way.
    const away = rate >= base ? (rate - base) / (1 - base) : (base - rate) / base
    const alpha = Math.round(Math.min(away, 1) * 30)
    if (alpha < 3) return undefined
    const hue = rate >= base ? 'emerald' : 'rose'
    return { backgroundColor: `color-mix(in oklab, var(--color-${hue}-500) ${alpha}%, transparent)` }
  }

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/by-week" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Record by Week</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[86rem] px-4 py-6">
        {paths.seasons.length === 0 ? (
          <p className="text-sm text-slate-400">No finished season with weekly results on record yet.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
              <p className="flex items-baseline gap-2 text-xs text-slate-400">
                Every team&rsquo;s record after every week, {first}
                {last !== first ? `–${last}` : ''}, and how many of them made the playoffs.
                <GlossaryLink anchor="record-by-week" label="record by week" />
              </p>
              <p className="flex items-center gap-2 text-[0.68rem] text-slate-500">
                <span
                  className="inline-block h-3 w-6"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--color-rose-500) 30%, transparent)' }}
                />
                usually missed
                <span
                  className="inline-block h-3 w-6"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--color-emerald-500) 30%, transparent)' }}
                />
                usually got in
                {paths.currentSeason !== null && (
                  <>
                    <span className="inline-block h-3 w-6 ring-1 ring-amber-400 ring-inset" />
                    {paths.currentSeason}, through week {paths.currentWeek}
                  </>
                )}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="border-collapse text-sm">
                <caption className="sr-only">
                  Records after each regular-season week, {first} to {last}. Each row is a week and
                  each column a number of wins; a cell gives how many teams held that record after
                  that week and how many of them made the playoffs.
                  {paths.currentSeason !== null &&
                    ` Managers named in a cell are on that record in ${paths.currentSeason}.`}
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-slate-950 px-2 py-2 text-left font-display text-[0.62rem] uppercase tracking-[0.08em] text-slate-400"
                    >
                      <span aria-hidden>Wins →</span>
                      <span className="sr-only">Week</span>
                    </th>
                    {wins.map((w) => (
                      <th
                        key={w}
                        scope="col"
                        className="min-w-[4.25rem] px-1 py-2 text-center font-display text-[0.62rem] uppercase tracking-[0.06em] text-slate-400"
                      >
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => {
                    const now = week === paths.currentWeek
                    return (
                      <tr key={week} className="border-t border-rule">
                        <th
                          scope="row"
                          className={`sticky left-0 z-10 bg-slate-950 px-2 py-1.5 text-left font-display text-xs uppercase tracking-[0.06em] whitespace-nowrap ${
                            now ? 'font-bold text-amber-300' : 'font-semibold text-slate-400'
                          }`}
                        >
                          Week {week}
                        </th>
                        {wins.map((w) => {
                          if (w > week) return <td key={w} />
                          const losses = week - w
                          const c = recordCell(paths, week, w, losses)
                          const thin = !c || c.teams < MIN_SAMPLE
                          const here = c?.current.length ? c.current : null
                          return (
                            <td
                              key={w}
                              className={`border border-rule/60 px-1 py-1 text-center align-top ${
                                here ? 'ring-1 ring-amber-400 ring-inset' : ''
                              }`}
                              style={c ? tint(c) : undefined}
                              title={
                                c && c.teams
                                  ? `${w}-${losses} after week ${week}: ${c.made} of ${c.teams} made the playoffs`
                                  : `${w}-${losses} after week ${week}: nobody on record`
                              }
                            >
                              <div className="font-mono text-[0.6rem] text-slate-500 tabular-nums">
                                {w}-{losses}
                              </div>
                              <div
                                className={`font-mono text-xs tabular-nums ${
                                  thin ? 'text-slate-500' : 'font-semibold'
                                }`}
                              >
                                {c && c.teams ? `${c.made}/${c.teams}` : '·'}
                              </div>
                              {here && (
                                <ul className="mt-0.5 space-y-0.5">
                                  {here.map((id) => {
                                    const m = byId.get(id)
                                    return (
                                      <li key={id}>
                                        <Link
                                          href={`/history/members/${id}`}
                                          className="flex items-center justify-center gap-1 text-[0.62rem] leading-tight font-semibold whitespace-nowrap hover:text-amber-300"
                                        >
                                          <span
                                            aria-hidden
                                            className="h-2 w-0.5 shrink-0"
                                            style={{ backgroundColor: managerColor(m?.color ?? '#888') }}
                                          />
                                          {m?.displayName ?? `#${id}`}
                                        </Link>
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 border-t border-rule pt-3 text-xs text-slate-400">
              Each cell is <strong className="text-slate-300">made it / teams</strong>: how many teams
              held that record after that week, and how many of them made the playoffs. Grey numbers
              are fewer than {MIN_SAMPLE} teams — an anecdote, not a pattern. Weekly results begin
              in {first}, so the grid fills in a season at a time.
              {paths.tiesExcluded > 0 &&
                ` ${paths.tiesExcluded} team-weeks after a tie are left out: a tied record has no cell here.`}
            </p>
          </>
        )}
      </div>
    </main>
  )
}
