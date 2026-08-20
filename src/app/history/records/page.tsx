import { EraBadge } from '@/components/history/EraBadge'
import { RecordLine } from '@/components/history/RecordLine'
import { SeasonReviewCard } from '@/components/history/SeasonReviewCard'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { managerColor } from '@/lib/colors'
import { getBestPickups, getRecordBook, getSeasonReviews } from '@/server/history-service'

/**
 * The record book, and a card for every season.
 *
 * The three groups are separated because **they do not cover the same years**.
 * Single-game records can only reach back to 2020, when the league started
 * keeping week-by-week results; season and career records reach to 2011. Each
 * group therefore carries its own `EraBadge`.
 *
 * That is not pedantry. The source workbook prints an all-time high score of
 * 203.9 from 2014 on one sheet and 234.96 from 2023 on another. Both are
 * correct for the era each was computed over, and neither says which.
 */
export const revalidate = 3600

export const metadata = { title: 'Records — FantasyWorld' }

const points = (n: number) => n.toFixed(2)
const whole = (n: number) => String(Math.round(n))
const dollars = (n: number) => `$${n.toLocaleString()}`

const FORMAT: Record<string, (n: number) => string> = {
  bestRecord: whole,
  worstRecord: whole,
  longestWinStreak: whole,
  longestLossStreak: whole,
  mostTitles: whole,
  mostPlayoffs: whole,
  longestPlayoffStreak: whole,
  mostMoney: dollars,
}

export default async function RecordsPage() {
  const [{ book, members }, { reviews }, pickups] = await Promise.all([
    getRecordBook(),
    getSeasonReviews(),
    getBestPickups(3),
  ])

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/records" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Records</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[92rem] px-4 py-6">
        <div className="grid gap-8 lg:grid-cols-3">
          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5">
              <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">
                Single game
              </h2>
              <EraBadge coverage={book.gameCoverage} />
            </div>
            <ul>
              {book.games.map((r) => (
                <RecordLine key={r.key} record={r} members={members} format={points} />
              ))}
            </ul>
            {book.games.length === 0 && (
              <p className="py-2 text-sm text-slate-500">No game-level results on record yet.</p>
            )}
          </section>

          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5">
              <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">Season</h2>
              <EraBadge coverage={book.seasonCoverage} />
            </div>
            <ul>
              {book.seasons.map((r) => (
                <RecordLine
                  key={r.key}
                  record={r}
                  members={members}
                  format={FORMAT[r.key] ?? points}
                  showEra={r.coverage.from !== book.seasonCoverage.from}
                />
              ))}
            </ul>
            {/*
              Streaks live in this column but are a weekly-era record, so they
              carry their own badge rather than inheriting the season one.
            */}
          </section>

          <section>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5">
              <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">Career</h2>
              <EraBadge coverage={book.seasonCoverage} />
            </div>
            <ul>
              {book.careers.map((r) => (
                <RecordLine key={r.key} record={r} members={members} format={FORMAT[r.key] ?? whole} />
              ))}
            </ul>

            <h3 className="mb-2 mt-6 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
              Highest-scoring seasons
            </h3>
            <ol className="space-y-1">
              {book.topScoringSeasons.map((s, i) => {
                const who = members.find((m) => m.managerId === s.managerId)
                return (
                  <li key={`${s.season}-${s.managerId}`} className="leaders text-sm">
                    <span className="flex items-baseline gap-2">
                      <span className="w-3 font-mono text-xs text-slate-500 tabular-nums">{i + 1}</span>
                      {who && (
                        <span className="flex items-baseline gap-1.5">
                          <span
                            aria-hidden
                            className="h-2.5 w-1"
                            style={{ backgroundColor: managerColor(who.color) }}
                          />
                          <span className="font-semibold">{who.displayName}</span>
                        </span>
                      )}
                      <span className="font-mono text-xs text-slate-500 tabular-nums">{s.season}</span>
                    </span>
                    <span className="shrink-0 font-mono font-semibold tabular-nums">
                      {s.points.toFixed(2)}
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
        </div>

        <section className="mt-10">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">
              Season by season
            </h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {reviews.length} seasons
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {reviews.map((r) => (
              <SeasonReviewCard
                key={r.season}
                review={r}
                members={members}
                pickups={pickups.get(r.season) ?? []}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
