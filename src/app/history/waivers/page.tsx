import Link from 'next/link'
import { EraBadge } from '@/components/history/EraBadge'
import { FaabClaimLists, FaabMoneyTable, LostBids } from '@/components/history/FaabTables'
import { HeaderControls } from '@/components/HeaderControls'
import { SiteNav } from '@/components/SiteNav'
import { getFaab, getHistoryInput } from '@/server/history-service'

/**
 * Waivers and FAAB, one season at a time (src/lib/faab.ts). A Server Component; the season
 * is a query parameter so a view is linkable, and defaults to the newest season on record.
 */
export const revalidate = 3600

export const metadata = { title: 'Waivers — FantasyWorld' }

export default async function WaiversPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>
}) {
  const [{ season: asked }, all, input] = await Promise.all([
    searchParams,
    getFaab(),
    getHistoryInput(),
  ])
  const seasons = all.map((f) => f.season).sort((a, b) => b - a)
  const wanted = Number(asked)
  const season = seasons.includes(wanted) ? wanted : (seasons[0] ?? null)
  const faab = all.find((f) => f.season === season) ?? null

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="history" current="/history/waivers" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Waivers</h1>
        <div className="ml-auto">
          <HeaderControls />
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-10 px-4 py-6">
        {!faab || season === null ? (
          <p className="text-sm text-slate-500">No transactions on record yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <nav aria-label="Season" className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm">
                {seasons.map((s) => (
                  <Link
                    key={s}
                    href={`/history/waivers?season=${s}`}
                    aria-current={s === season ? 'page' : undefined}
                    className={
                      s === season
                        ? 'font-bold text-slate-100 underline underline-offset-4'
                        : 'text-slate-400 hover:text-slate-200'
                    }
                  >
                    {s}
                  </Link>
                ))}
              </nav>
              <EraBadge
                coverage={{
                  from: seasons[seasons.length - 1],
                  to: seasons[0],
                  seasons: [...seasons].reverse(),
                  label: 'Waivers',
                }}
              />
            </div>
            <FaabMoneyTable faab={faab} members={input.members} />
            <FaabClaimLists faab={faab} members={input.members} />
            <LostBids bids={faab.lostBids} members={input.members} />
          </>
        )}
      </div>
    </main>
  )
}
