import Link from 'next/link'
import { Column, Furniture, GameNotes, Masthead, Tables } from '@/components/gazette/Issue'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getLatestIssue, listIssues } from '@/server/gazette-service'
import { listMembers } from '@/server/history-service'

/**
 * The Gazette: the latest edition, and every back issue under it.
 *
 * The front page is the newest issue in full rather than a list of links,
 * because a newspaper's front page is the paper. The archive is the index, and
 * it sits below the fold where an index belongs.
 */
export const revalidate = 3600

export const metadata = { title: 'The FantasyWorld Gazette' }

const PRINTED = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export default async function GazettePage() {
  const [latest, issues, memberRows] = await Promise.all([
    getLatestIssue(),
    listIssues(),
    listMembers(),
  ])
  // listMembers returns career rows; the components want the members themselves.
  const members = memberRows.map((r) => r.member)

  const bySeason = new Map<number, typeof issues>()
  for (const i of issues) bySeason.set(i.season, [...(bySeason.get(i.season) ?? []), i])

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
        {!latest ? (
          <p className="text-sm text-slate-400">No issues on record yet.</p>
        ) : (
          <>
            <Masthead
              facts={latest.facts}
              issueTitle={latest.issueTitle}
              lens={latest.lens}
              printedAt={PRINTED.format(new Date(latest.generatedAt))}
            />
            <Column issue={latest} />
            <GameNotes issue={latest} members={members} />
            <Tables facts={latest.facts} members={members} />
            <Furniture facts={latest.facts} members={members} />
          </>
        )}

        <section className="mt-12">
          <h2 className="rule-strong mb-3 pt-2 font-display text-[0.72rem] font-bold uppercase tracking-[0.16em] text-slate-400">
            Back issues
          </h2>
          {issues.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing in the archive yet.</p>
          ) : (
            [...bySeason.entries()]
              .sort(([a], [b]) => b - a)
              .map(([season, rows]) => (
                <div key={season} className="mb-6">
                  <h3 className="border-b border-rule-strong pb-1 font-display text-sm font-bold uppercase tracking-[0.1em]">
                    {season}
                  </h3>
                  <ul className="divide-y divide-rule">
                    {rows.map((i) => (
                      <li key={`${i.season}-${i.week}`}>
                        <Link
                          href={`/history/gazette/${i.season}/${i.week}`}
                          className="block py-2 hover:bg-slate-900"
                        >
                          <div className="leaders text-[0.9rem]">
                            <span className="font-[family-name:var(--font-gazette)] text-slate-200">
                              {i.headline}
                            </span>
                            <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-slate-500">
                              {i.weekLabel}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[0.72rem] italic text-slate-500">{i.deck}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
          )}
        </section>
      </div>
    </main>
  )
}
