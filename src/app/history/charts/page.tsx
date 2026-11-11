import { BarChart } from "@/components/charts/BarChart";
import { LineChart, type LineSeries } from "@/components/charts/LineChart";
import { EraBadge } from "@/components/history/EraBadge";
import { HeaderControls } from "@/components/HeaderControls";
import { SiteNav } from "@/components/SiteNav";
import {
  cumulativePoints,
  cumulativeWins,
  finishBySeason,
  titlesAndMoney,
  type MemberSeries,
} from "@/lib/chart-series";
import { managerColor } from "@/lib/colors";
import { leagueSummary } from "@/lib/history";
import { getHistoryInput } from "@/server/history-service";

/**
 * The league, drawn. A Server Component: it computes the series once an hour and hands
 * the chart kit plain data (src/components/charts — formatting is a serialisable spec,
 * never a function, because a function cannot cross into a client component).
 */
export const revalidate = 3600;

export const metadata = { title: "Charts — FantasyWorld" };

export default async function ChartsPage() {
  const input = await getHistoryInput();
  const summary = leagueSummary(input);
  const wins = cumulativeWins(input);
  const points = cumulativePoints(input);
  const finish = finishBySeason(input);
  const {
    rows: money,
    coverage: titlesCoverage,
    moneyUnknownSeasons,
  } = titlesAndMoney(input);

  const member = new Map(input.members.map((m) => [m.managerId, m]));
  const toLines = (series: MemberSeries[]): LineSeries[] =>
    series.map((s) => {
      const m = member.get(s.managerId);
      return {
        id: String(s.managerId),
        label: m?.displayName ?? `#${s.managerId}`,
        color: m ? managerColor(m.color) : "var(--s-400)",
        points: s.points,
      };
    });

  const standingsCoverage = summary.allTime;
  // The newest season is still being played if nobody has been crowned for it.
  const newest = input.seasons[input.seasons.length - 1];
  const inProgress =
    newest && newest.championManagerId === null ? newest.season : null;

  const ranked = (pick: (r: (typeof money)[number]) => number | null) =>
    [...money]
      .map((r) => ({ r, v: pick(r) }))
      .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
      .map(({ r, v }) => {
        const m = member.get(r.managerId);
        return {
          id: String(r.managerId),
          label: m?.displayName ?? `#${r.managerId}`,
          value: v,
          color: m ? managerColor(m.color) : undefined,
        };
      });

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/charts" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">
          Charts
        </h1>
        <div className="ml-auto">
          <HeaderControls />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-12 px-4 py-6">
        <Section
          title="Wins, added up"
          caption="Each line is a manager’s running regular-season win total; the steeper it climbs, the better the run. A line that starts late is someone who joined later."
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
          title="Points, added up"
          caption="The same picture for points scored: wins can be luck of the schedule, points mostly cannot."
          coverage={<EraBadge coverage={standingsCoverage} />}
          note={
            points.missing.length
              ? `${points.missing.length} manager-season(s) have no points figure on record, so those totals run low.`
              : undefined
          }
        >
          <LineChart
            series={toLines(points.series)}
            xFormat={{ shortYear: true }}
            yFormat={{}}
            ariaLabel="Cumulative points scored by season, per manager"
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
          caption="Championships won, counted from the start of the record."
          coverage={<EraBadge coverage={titlesCoverage} />}
        >
          <BarChart
            rows={ranked((r) => r.titles)}
            ariaLabel="Championships won, per manager"
          />
        </Section>

        <Section
          title="Money won"
          caption="Gross prize money across every placing; a dash means nothing on record, which is not the same as nothing won."
          coverage={<EraBadge coverage={titlesCoverage} />}
          note={
            moneyUnknownSeasons.length
              ? `The payout for ${moneyUnknownSeasons.join(", ")} is unknown, so those seasons add nothing.`
              : undefined
          }
        >
          <BarChart
            rows={ranked((r) => r.moneyWon)}
            format={{ prefix: "$" }}
            ariaLabel="Prize money won, per manager"
          />
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  caption,
  coverage,
  note,
  children,
}: {
  title: string;
  caption: string;
  coverage: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">
          {title}
        </h2>
        {coverage}
      </div>
      <p className="mb-3 text-sm text-slate-400">{caption}</p>
      {children}
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </section>
  );
}
