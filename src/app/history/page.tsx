import { SiteNav } from '@/components/SiteNav'
import { LeagueSummaryTable } from '@/components/history/LeagueSummaryTable'
import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getLeagueSummary, listHistorySeasons } from '@/server/history-service'

/**
 * The league's all-time table.
 *
 * A **Server Component**, not a client page that fetches. History does not
 * change, so there is no poll, no `/api/history`, and nothing here can end up
 * anywhere near the 400ms path that drives draft night. It renders on the server
 * once an hour and ships no JavaScript for the table at all.
 */
export const revalidate = 3600

export const metadata = {
  title: 'League history — Fantasy 101',
}

export default async function HistoryPage() {
  const [report, seasons] = await Promise.all([getLeagueSummary(), listHistorySeasons()])

  const played = seasons.filter((s) => s.dataTier !== 'weekly' || s.champion !== null)
  const oldest = seasons[seasons.length - 1]?.season
  const newest = played[0]?.season

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">League History</h1>
        <span className="font-mono text-xs text-slate-400 tabular-nums">
          {oldest}–{newest}
        </span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[92rem] px-4 py-6">
        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
            <h2 className="flex items-baseline gap-2 font-display text-sm font-bold uppercase tracking-[0.1em]">
              All-time table
              <GlossaryLink anchor="league" label="the all-time table" />
            </h2>
            <p className="text-xs text-slate-400">
              Ranked by career regular-season win percentage.
            </p>
          </div>

          <LeagueSummaryTable report={report} />

          {/*
            The three era badges stay — they are the label on which columns
            cover which years, and the league's own spreadsheet puts those
            columns side by side unlabelled, which is how its records sheet
            ended up disagreeing with its front page about the all-time high
            score. The four paragraphs that used to gloss them are in the
            glossary under "Coverage tiers".
          */}
          <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-t border-rule pt-3 text-xs text-slate-400">
            <span className="flex items-baseline gap-1.5">
              <EraBadge coverage={report.allTime} />
              <span>record, points, money</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <EraBadge coverage={report.weekly} />
              <span>all-play, lineup, high/low, playoff points</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <EraBadge coverage={report.titles} />
              <span>championships</span>
            </span>
            <span>
              <span className="text-slate-300">—</span> is unknown, not zero
            </span>
          </div>
        </section>
      </div>
    </main>
  )
}
