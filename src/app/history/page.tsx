import { SiteNav } from '@/components/SiteNav'
import { LeagueSummaryTable } from '@/components/history/LeagueSummaryTable'
import { EraBadge } from '@/components/history/EraBadge'
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
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">
              All-time table
            </h2>
            <p className="text-xs text-slate-400">
              Ranked by career regular-season win percentage.
            </p>
          </div>

          <LeagueSummaryTable report={report} />

          {/*
            The two-era note. The league's own spreadsheet puts these columns
            side by side unlabelled, which is how its records sheet ended up
            disagreeing with its front page about the all-time high score.
          */}
          <div className="mt-4 space-y-1.5 border-t border-rule pt-3 text-xs leading-relaxed text-slate-400">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <EraBadge coverage={report.allTime} />
              <span>
                — record, points and money. Everything the league has a season-level record of.
              </span>
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <EraBadge coverage={report.weekly} />
              <span>
                — anything needing week-by-week data: all-play, lineup efficiency, high and low
                scorer weeks, playoff points. These cannot go back further, because the games
                were not recorded that way.
              </span>
            </p>
            {report.legacyNote.seasons.length > 0 && (
              <p className="flex flex-wrap items-baseline gap-x-2">
                <EraBadge coverage={report.legacyNote} />
                <span>
                  — {report.legacyNote.seasons.join(', ')} survive as a champion&rsquo;s name only,
                  so they appear in no column above.
                </span>
              </p>
            )}
            <p className="pt-1">
              <span className="text-slate-300">—</span> means unknown, which is not the same as
              zero. Third-place games count toward playoff records; the fifth-place game does not.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">Champions</h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {seasons.length} seasons on record
            </span>
          </div>
          <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {seasons.map((s) => (
              <li key={s.season} className="leaders text-sm">
                <span className="font-mono text-slate-400 tabular-nums">{s.season}</span>
                <span className={s.champion ? 'font-semibold' : 'text-slate-500'}>
                  {s.champion ?? 'not yet decided'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
