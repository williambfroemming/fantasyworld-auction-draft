import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { listAuctions } from '@/server/history-service'

/**
 * Every auction the league has on record.
 *
 * The home of the Draft History section, and the answer to "show me a past
 * draft" — which the app could technically already do through the year picker on
 * `/board`, but only if you already knew the picker was there.
 *
 * A season is listed exactly when somebody drafted in it, so this cannot drift
 * from the picks table.
 */
export const revalidate = 3600

export const metadata = { title: 'Past auctions — FantasyWorld' }

export default async function DraftsPage() {
  const auctions = await listAuctions()

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="draft-history" current="/history/drafts" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Past Auctions</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {auctions.length === 0 && (
          <p className="text-sm text-slate-400">No drafts on record yet.</p>
        )}

        <ul className="space-y-3">
          {auctions.map((a) => (
            <li key={a.season} className="border border-rule p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-display text-xl font-bold tracking-[0.04em]">{a.season}</h2>
                {a.isCurrent && (
                  <span className="bg-emerald-500/15 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                    Current
                  </span>
                )}
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {a.picks} picks · ${a.spent.toLocaleString()} spent
                </span>

                <span className="ml-auto flex gap-2">
                  <Link
                    href={`/board?season=${a.season}`}
                    className="bg-slate-800 px-3 py-1 text-xs font-semibold hover:bg-slate-700"
                  >
                    Board
                  </Link>
                  <Link
                    href={`/stats?season=${a.season}`}
                    className="bg-slate-800 px-3 py-1 text-xs font-semibold hover:bg-slate-700"
                  >
                    Spend
                  </Link>
                  <a
                    href={`/api/export?season=${a.season}`}
                    className="bg-slate-800 px-3 py-1 text-xs font-semibold hover:bg-slate-700"
                  >
                    CSV
                  </a>
                </span>
              </div>

              {a.topPick && (
                <p className="mt-1.5 text-sm text-slate-300">
                  Most expensive:{' '}
                  <span className="font-semibold">{a.topPick.playerName}</span>{' '}
                  <span className="font-mono tabular-nums text-slate-400">
                    ${a.topPick.price}
                  </span>{' '}
                  <span className="text-slate-500">to {a.topPick.displayName}</span>
                </p>
              )}

              {/*
                The recap leads, because this is a page people read for fun and
                a wall of caveats made a complete record look like an errata
                sheet. Written once from computed facts and stored — see
                scripts/history/draft-recap.ts.
              */}
              {a.recap && (
                <p className="mt-2 max-w-3xl text-[0.92rem] leading-relaxed text-slate-300">
                  {a.recap}
                </p>
              )}

              {/*
                Provenance is demoted, never dropped. "Departures from a source
                are never silent" (PROJECT_PLAN §12) — a negative budget or a
                removed duplicate that turns up unexplained on a board looks
                exactly like the bug this app was built to remove. So it stays
                one click away rather than above the fold.
              */}
              {(a.notes.length > 0 || a.overBudget.length > 0) && (
                <details className="group/notes mt-2">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[0.68rem] uppercase tracking-[0.1em] text-slate-500 hover:text-slate-300">
                    <span aria-hidden className="transition-transform group-open/notes:rotate-90">
                      ▸
                    </span>
                    Data notes
                    <span className="font-mono normal-case tracking-normal text-slate-600">
                      ({a.notes.length + (a.overBudget.length > 0 ? 1 : 0)})
                    </span>
                  </summary>
                  <ul className="mt-1.5 space-y-1 border-l border-rule pl-3 text-[0.7rem] leading-relaxed text-slate-500">
                    {a.overBudget.length > 0 && (
                      <li className="text-amber-200/70">
                        Over budget:{' '}
                        {a.overBudget.map((m) => `${m.displayName} $${m.spent}`).join(' · ')}
                      </li>
                    )}
                    {a.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
