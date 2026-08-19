import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EraBadge } from '@/components/history/EraBadge'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { managerColor } from '@/lib/colors'
import { getMemberProfile, getMostStarted } from '@/server/history-service'

/**
 * One member's career.
 *
 * Career totals come from `leagueSummary` rather than being recomputed here, so
 * this page and the all-time table cannot disagree — the failure that makes
 * people stop trusting both.
 */
export const revalidate = 3600

const pct = (n: number | null) => (n === null ? '—' : n.toFixed(3).replace(/^0/, ''))
const money = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString()}`)

/**
 * The podium, spelled out.
 *
 * ⚠️ A trophy next to a regular-season place of 4 is not a contradiction — it
 * means they were the 4 seed and won the thing. The first cut showed the medal
 * in an unlabelled column beside one headed "Place", which read as a mistake.
 * Two columns now, each saying which question it answers.
 */
const FINISH: Record<string, { medal: string; label: string }> = {
  champion: { medal: '🏆', label: 'Champion' },
  'runner-up': { medal: '🥈', label: 'Runner-up' },
  third: { medal: '🥉', label: 'Third' },
}

/** 1 -> 1st. Ordinals read faster than a bare number in a column of them. */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const managerId = Number(id)
  const [{ profile, members }, favorites] = await Promise.all([
    getMemberProfile(managerId),
    getMostStarted(managerId, 10),
  ])
  if (!profile) notFound()

  const { member, allTime: a, weekly: w } = profile
  const color = managerColor(member.color)

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/members" />
        <h1 className="flex items-baseline gap-2 font-display text-lg font-bold uppercase tracking-[0.08em]">
          <span aria-hidden className="h-4 w-1.5 self-center" style={{ backgroundColor: color }} />
          {member.displayName}
        </h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[80rem] px-4 py-6">
        {/* Career line */}
        <section className="mb-6 border-b border-rule-strong pb-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            {[
              ['Championships', a.titles || '—'],
              ['Record', `${a.wins}-${a.losses}${a.ties ? `-${a.ties}` : ''}`],
              ['Win %', pct(a.winPct)],
              ['Seasons', a.seasons],
              ['Playoffs', `${a.playoffAppearances}×`],
              ['Playoff record', a.playoffWins + a.playoffLosses ? `${a.playoffWins}-${a.playoffLosses}` : '—'],
              ['Won', money(a.moneyWon)],
              ['Avg finish', a.avgFinish?.toFixed(1) ?? '—'],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <div className="font-display text-[0.6rem] uppercase tracking-[0.12em] text-slate-500">
                  {label}
                </div>
                <div className="font-mono text-lg tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <EraBadge coverage={profile.allTimeCoverage} />
          </div>
        </section>

        <div className="grid min-w-0 gap-8 lg:grid-cols-[2fr_1fr]">
          {/* Season by season */}
          <section className="min-w-0">
            <h2 className="mb-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
              Season by season
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    {(
                      [
                        ['Season', 'left', undefined],
                        ['Seed', 'left', 'Where they finished the regular season'],
                        ['Record', 'right', 'Regular-season record'],
                        ['PF', 'right', 'Points for'],
                        ['PA', 'right', 'Points against'],
                        ['Playoffs', 'right', 'Playoff record. Third-place games count'],
                        ['Finish', 'left', 'How the playoffs ended'],
                        ['Spent', 'right', 'Total spent at that auction'],
                        ['Biggest buy', 'right', undefined],
                      ] as const
                    ).map(([h, align, title]) => (
                      <th
                        key={h}
                        title={title}
                        className={`px-2 py-1.5 font-display text-[0.6rem] uppercase tracking-[0.08em] text-slate-400 text-${align}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profile.seasons.map((s) => (
                    <tr key={s.season} className="border-b border-rule/60">
                      <td className="px-2 py-1.5 font-mono tabular-nums">{s.season}</td>
                      <td className="px-2 py-1.5 font-mono tabular-nums text-slate-300">
                        {s.place === null ? '—' : ordinal(s.place)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {s.wins}-{s.losses}
                        {s.ties ? `-${s.ties}` : ''}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {s.pointsFor === null ? '—' : s.pointsFor.toFixed(0)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {s.pointsAgainst === null ? '—' : s.pointsAgainst.toFixed(0)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {s.madePlayoffs ? `${s.playoffWins ?? 0}-${s.playoffLosses ?? 0}` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                        {s.finish ? (
                          <span className={s.finish === 'champion' ? 'text-amber-300' : 'text-slate-300'}>
                            {FINISH[s.finish].medal} {FINISH[s.finish].label}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      {/* Null spend is unknown, not zero — that season's auction is not on record. */}
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {s.draftSpend === null ? '—' : `$${s.draftSpend}`}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {s.biggestBuy ? (
                          <>
                            {s.biggestBuy.playerName}{' '}
                            <span className="font-mono text-slate-400 tabular-nums">
                              ${s.biggestBuy.price}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="min-w-0 space-y-8">
            {w && (
              <section>
                <h2 className="mb-2 flex items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
                  Since Sleeper
                  <EraBadge coverage={profile.weeklyCoverage} />
                </h2>
                <ul className="space-y-1 text-sm">
                  {[
                    ['All-play', `${w.allPlayWins}-${w.allPlayLosses}`],
                    ['All-play %', pct(w.allPlayPct)],
                    ['Lineup efficiency', w.lineupEfficiency === null ? '—' : `${(w.lineupEfficiency * 100).toFixed(1)}%`],
                    ['High-scorer weeks', w.highScoreWeeks],
                    ['Low-scorer weeks', w.lowScoreWeeks],
                  ].map(([label, value]) => (
                    <li key={String(label)} className="leaders">
                      <span className="text-slate-400">{label}</span>
                      <span className="shrink-0 font-mono font-semibold tabular-nums">{value}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2 className="mb-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
                Head to head
              </h2>
              <ul className="space-y-1 text-sm">
                {profile.h2h.map((c) => {
                  const opp = members.find((m) => m.managerId === c.opponentManagerId)
                  return (
                    <li key={c.opponentManagerId} className="leaders">
                      <Link
                        href={`/history/members/${c.opponentManagerId}`}
                        className="text-slate-300 hover:text-amber-300"
                      >
                        {opp?.displayName ?? c.opponentManagerId}
                      </Link>
                      <span className="shrink-0 font-mono tabular-nums">
                        {c.wins}-{c.losses}
                        {c.ties ? `-${c.ties}` : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <Link
                href="/history/h2h"
                className="mt-2 inline-block text-xs text-slate-400 hover:text-amber-300"
              >
                Full grid →
              </Link>
            </section>
          </div>
        </div>

        {/*
          Ranked by weeks STARTED, not weeks rostered and not money spent.
          Starting somebody is a decision taken every single week; a roster spot
          can be inertia. Both other columns stay visible because the gaps
          between them are the interesting part — a player carried for 30 weeks
          and started for 9 is a different story from one started every time.
        */}
        <section className="mt-10 min-w-0">
          <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
            Favourite players
            <span className="font-sans text-[0.68rem] font-normal normal-case tracking-normal text-slate-500">
              Top 10 by weeks started
            </span>
          </h2>
          <PlayerTable rows={favorites} />
        </section>
      </div>
    </main>
  )
}

function PlayerTable({
  rows,
}: {
  rows: Array<{
    playerId: string
    playerName: string
    position: string | null
    timesDrafted: number
    totalSpent: number
    seasons: number[]
    weeksRostered: number
    weeksStarted: number
    pointsScored: number
  }>
}) {
  if (rows.length === 0) {
    return <p className="py-2 text-sm text-slate-500">Nothing on record yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule">
            {(
              [
                ['Player', 'left', undefined],
                ['Spent', 'right', 'Total paid at auction, across every season'],
                ['×', 'right', 'How many separate auctions they bought him in'],
                ['Wks', 'right', 'Weeks on the roster'],
                ['Started', 'right', 'Weeks in the starting lineup'],
                ['Points', 'right', 'Points scored while started'],
              ] as const
            ).map(([h, align, title]) => (
              <th
                key={h}
                title={title}
                className={`px-2 py-1.5 font-display text-[0.6rem] uppercase tracking-[0.08em] text-slate-400 text-${align}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.playerId} className="border-b border-rule/60">
              <td className="px-2 py-1.5">
                <span className="font-semibold">{p.playerName}</span>
                {p.position && (
                  <span className="ml-1.5 font-mono text-[0.65rem] text-slate-500">{p.position}</span>
                )}
                {p.seasons.length > 0 && (
                  <span className="ml-1.5 font-mono text-[0.65rem] text-slate-600 tabular-nums">
                    {p.seasons.join(', ')}
                  </span>
                )}
              </td>
              {/* Em dash, not $0: never drafted is not the same as bought for nothing. */}
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-400">
                {p.totalSpent > 0 ? `$${p.totalSpent}` : '—'}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                {p.timesDrafted || '—'}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-400">
                {p.weeksRostered || '—'}
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-100">
                {p.weeksStarted || '—'}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-400">
                {p.pointsScored ? p.pointsScored.toFixed(0) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
