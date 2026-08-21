import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Column, Furniture, GameNotes, Masthead, Tables } from '@/components/gazette/Issue'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getAdjacentIssues, getIssue } from '@/server/gazette-service'
import { listMembers } from '@/server/history-service'

/**
 * One edition.
 *
 * A Server Component with no poll and no `/api` route: a finished week never
 * changes, so there is nothing to poll for. Every figure on the page comes from
 * the fact pack stored on the issue rather than from a live query — see the
 * note on `Issue.tsx`.
 *
 * No `generateStaticParams`. It would hit the live database at build time, which
 * AGENTS.md already warns about for `npm run build`.
 */
export const revalidate = 3600

export const metadata = { title: 'The FantasyWorld Gazette' }

const PRINTED = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export default async function IssuePage({
  params,
}: {
  params: Promise<{ season: string; week: string }>
}) {
  const { season, week } = await params
  const [issue, memberRows] = await Promise.all([
    getIssue(Number(season), Number(week)),
    listMembers(),
  ])
  // listMembers returns career rows; the components want the members themselves.
  const members = memberRows.map((r) => r.member)
  if (!issue) notFound()

  const { prev, next } = await getAdjacentIssues(issue.season, issue.week)
  const printedAt = PRINTED.format(new Date(issue.generatedAt))

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/gazette" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Gazette</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[72rem] px-4 py-8">
        <Masthead facts={issue.facts} issueTitle={issue.issueTitle} lens={issue.lens} printedAt={printedAt} />
        <Column issue={issue} />
        <GameNotes issue={issue} members={members} />
        <Tables facts={issue.facts} members={members} />
        <Furniture facts={issue.facts} members={members} />

        <footer className="mt-10 border-t border-rule pt-3">
          {/*
            The one line that keeps this honest. docs/BACKLOG.md §1 cut a live
            news feed because a panel of headlines reads identically whether it
            is four minutes or four weeks old. This is the opposite claim, made
            explicitly: a recap of a finished week, from the record as it stood
            when it went to press.
          */}
          <p className="text-[0.68rem] leading-relaxed text-slate-500">
            Every figure above is from the league record as it stood at press time. Scores can
            still move for a day or two after a week ends; an issue does not.
          </p>
          <nav className="mt-3 flex flex-wrap items-center justify-between gap-3 font-display text-[0.7rem] uppercase tracking-[0.12em]">
            {prev ? (
              <Link href={`/history/gazette/${prev.season}/${prev.week}`} className="hover:text-amber-300">
                ← Previous issue
              </Link>
            ) : (
              <span className="text-slate-600">← Previous issue</span>
            )}
            <Link href="/history/gazette" className="hover:text-amber-300">
              All issues
            </Link>
            {next ? (
              <Link href={`/history/gazette/${next.season}/${next.week}`} className="hover:text-amber-300">
                Next issue →
              </Link>
            ) : (
              <span className="text-slate-600">Next issue →</span>
            )}
          </nav>
        </footer>
      </div>
    </main>
  )
}
