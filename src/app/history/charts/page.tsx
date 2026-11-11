import { BarChart } from '@/components/charts/BarChart'
import { ChartFilter, type FilterPreset } from '@/components/charts/ChartFilter'
import { LineChart, type LineSeries } from '@/components/charts/LineChart'
import { EraBadge } from '@/components/history/EraBadge'
import { HeaderControls } from '@/components/HeaderControls'
import { SiteNav } from '@/components/SiteNav'
import {
  cumulativePointsVsAverage,
  cumulativeWins,
  finishBySeason,
  restrictToSeasons,
  titlesAndMoney,
  type MemberSeries,
} from '@/lib/chart-series'
import { managerColor } from '@/lib/colors'
import { leagueSummary } from '@/lib/history'
import { getHistoryInput } from '@/server/history-service'

/**
 * The league, drawn. A Server Component: it computes every series for the chosen years and
 * hands the chart kit plain data (src/components/charts: formatting is a serialisable spec,
 * never a function, because a function cannot cross into a client component).
 *
 * The year window is in the URL (`?from=&to=`), so it reads `searchParams` and the page is
 * rendered per request rather than cached. Running totals restart at the first year shown:
 * a window is its own accounting period, not a slice of an all-time total.
 */
export const metadata = { title: 'Charts — FantasyWorld' }

const parseYear = (v: string | undefined) => (v && /^\d{4}$/.test(v) ? Number(v) : null)

export default async function ChartsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const query = await searchParams
  const full = await getHistoryInput()

  // The years that can be chosen: the ones with standings, which every line chart needs.
  const seasons = [...new Set(full.standings.map((s) => s.season))].sort((a, b) => a - b)
  const first = seasons[0]
  const last = seasons[seasons.length - 1]

  // An unparseable or out-of-range value falls back to the edge rather than erroring.
  const clamp = (n: number) => Math.min(last, Math.max(first, n))
  const askedFrom = parseYear(query.from)
  const askedTo = parseYear(query.to)
  const a = askedFrom === null ? first : clamp(askedFrom)
  const b = askedTo === null ? last : clamp(askedTo)
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  const filtered = from !== first || to !== last

  const input = filtered ? restrictToSeasons(full, from, to) : full
  const summary = leagueSummary(input)
  const wins = cumulativeWins(input)
  const points = cumulativePointsVsAverage(input)
  const finish = finishBySeason(input)
  const { rows: money, coverage: titlesCoverage, moneyUnknownSeasons } = titlesAndMoney(input)

  // Quick choices. A preset identical to another (or to the whole range) is dropped.
  const weeklyFrom = Math.min(
    ...full.seasons.filter((s) => s.dataTier === 'weekly').map((s) => s.season),
  )
  const presets: FilterPreset[] = [{ label: 'All years', from: first, to: last }]
  if (seasons.length > 5) presets.push({ label: 'Last 5', from: last - 4, to: last })
  if (Number.isFinite(weeklyFrom) && weeklyFrom > first && weeklyFrom <= last) {
    presets.push({ label: `Since ${weeklyFrom}`, from: weeklyFrom, to: last })
  }
  const seen = new Set<string>()
  const uniquePresets = presets.filter((p) => {
    const k = `${p.from}-${p.to}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const member = new Map(input.members.map((m) => [m.managerId, m]))
  const toLines = (series: MemberSeries[]): LineSeries[] =>
    series.map((s) => {
      const m = member.get(s.managerId)
      return {
        id: String(s.managerId),
        label: m?.displayName ?? `#${s.managerId}`,
        color: m ? managerColor(m.color) : 'var(--s-400)',
        points: s.points,
      }
    })

  // "All-time" would be a lie for a window, so a filtered view says what it is.
  const standingsCoverage = filtered
    ? { ...summary.allTime, label: 'Selected years' }
    : summary.allTime
  // The newest season is still being played if nobody has been crowned for it.
  const newest = full.seasons[full.seasons.length - 1]
  const inProgress =
    newest && newest.championManagerId === null && to >= newest.season ? newest.season : null

  const ranked = (pick: (r: (typeof money)[number]) => number | null) =>
    [...money]
      .map((r) => ({ r, v: pick(r) }))
      .sort((x, y) => (y.v ?? -Infinity) - (x.v ?? -Infinity))
      .map(({ r, v }) => {
        const m = member.get(r.managerId)
        return {
          id: String(r.managerId),
          label: m?.displayName ?? `#${r.managerId}`,
          value: v,
          color: m ? managerColor(m.color) : undefined,
        }
      })

  const startsNote = filtered ? ` Totals start from ${from}.` : ''

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/charts" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Charts</h1>
        <div className="ml-auto">
          <HeaderControls />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-12 px-4 py-6">
        <ChartFilter seasons={seasons} from={from} to={to} presets={uniquePresets} />

        <Section
          title="Wins, added up"
          caption={`Each line is a manager’s running regular-season win total; the steeper it climbs, the better the run. A line that starts late is someone who joined later.${startsNote}`}
          coverage={<EraBadge coverage={standingsCoverage} />}
          note={
            inProgress
              ? `${inProgress} is still being played, so the right-hand end is not final.`
              : undefined
          }
        >
          <LineChart
            series={toLines(wins.series)}
            xFormat={{ shortYear: true }}
            ariaLabel="Cumulative regular-season wins by season, per manager"
            height={360}
          />
        </Section>

        <Section
          title="Points vs the league average"
          caption={`How far above or below the average team each manager has scored, season by season, added up. The heavy line is an average team: climbing means out-scoring the field year after year, falling means the opposite.${startsNote}`}
          coverage={<EraBadge coverage={standingsCoverage} />}
          note={
            points.missing.length
              ? `${points.missing.length} manager-season(s) have no points figure on record, so those totals add nothing for that year.`
              : undefined
          }
        >
          <LineChart
            series={toLines(points.series)}
            xFormat={{ shortYear: true }}
            yFormat={{ signed: true }}
            ariaLabel="Points scored above or below the league average, added up by season, per manager"
            height={360}
          />
        </Section>

        <Section
          title="Where everyone finished"
          caption="Regular-season finish each year, first place at the top. Look for the steady climbers and the ones who fell off a cliff."
          coverage={<EraBadge coverage={standingsCoverage} />}
          note="This is the regular season, not the playoffs: the champion is not always the team on top."
        >
          <LineChart
            series={toLines(finish.series)}
            xFormat={{ shortYear: true }}
            yTicks={Array.from({ length: finish.worst }, (_, i) => i + 1)}
            yDomain={[1, Math.max(2, finish.worst)]}
            invertY
            ariaLabel="Regular-season finish by season, per manager, first place at the top"
            height={380}
          />
        </Section>

        <Section
          title="Titles"
          caption={
            filtered
              ? 'Championships won in the years shown.'
              : 'Championships won, counted from the start of the record.'
          }
          coverage={<EraBadge coverage={titlesCoverage} />}
        >
          <BarChart rows={ranked((r) => r.titles)} ariaLabel="Championships won, per manager" />
        </Section>

        <Section
          title="Money won"
          caption="Gross prize money across every placing; a dash means nothing on record, which is not the same as nothing won."
          coverage={<EraBadge coverage={titlesCoverage} />}
          note={
            moneyUnknownSeasons.length
              ? `The payout for ${moneyUnknownSeasons.join(', ')} is unknown, so those seasons add nothing.`
              : undefined
          }
        >
          <BarChart
            rows={ranked((r) => r.moneyWon)}
            format={{ prefix: '$' }}
            ariaLabel="Prize money won, per manager"
          />
        </Section>
      </div>
    </main>
  )
}

function Section({
  title,
  caption,
  coverage,
  note,
  children,
}: {
  title: string
  caption: string
  coverage: React.ReactNode
  note?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">{title}</h2>
        {coverage}
      </div>
      <p className="mb-3 text-sm text-slate-400">{caption}</p>
      {children}
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </section>
  )
}
