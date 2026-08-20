import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PlayerTimeline } from '@/components/history/PlayerTimeline'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { managerColor } from '@/lib/colors'
import { getPlayerHistory, listMembers } from '@/server/history-service'

/**
 * One player's whole run in the league.
 *
 * Every other history page is a manager looking outward. This is the only one
 * that turns the league around and asks what it looked like from a player's
 * side — which is the form the arguments actually take ("I had him first").
 *
 * ## The window is stated, never implied
 *
 * Weekly data begins in 2020 (`seasons.data_tier`). The league's records go back
 * to 2006, so a total here is six years and change, not a career, and the page
 * says so out loud. The same discipline as `InjuryBadge` rendering nothing
 * rather than a green tick: a confident number about the wrong window is worse
 * than an honest smaller one.
 */
export const revalidate = 3600

export async function generateMetadata({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const player = await getPlayerHistory(playerId)
  return { title: player ? `${player.playerName} — FantasyWorld` : 'Player — FantasyWorld' }
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="border border-rule p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

export default async function PlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const [player, members] = await Promise.all([getPlayerHistory(playerId), listMembers()])
  if (!player) notFound()

  const colorOf: Record<number, string> = {}
  for (const m of members) colorOf[m.member.managerId] = m.member.color

  const seasonMax = Math.max(1, ...player.seasons.map((s) => s.points))

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/players" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">
          {player.playerName}
        </h1>
        <span className="font-mono text-xs text-slate-500">{player.position ?? '—'}</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6">
        <Link href="/history/players" className="text-xs text-slate-400 hover:text-slate-200">
          ← All players
        </Link>

        {/* The window, stated before any number that depends on it. */}
        <p className="mt-3 text-xs text-slate-500">
          Fantasy World record, {player.firstSeason}–{player.lastSeason}. Week-by-week scoring
          exists from 2020 on, so totals below cover that span — not the league&rsquo;s full
          history.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Points, all weeks rostered"
            value={player.points.toFixed(1)}
            sub={`${player.pointsStarted.toFixed(1)} while started`}
          />
          <Stat
            label="Weeks on a roster"
            value={String(player.weeksRostered)}
            sub={`${player.weeksStarted} started`}
          />
          <Stat
            label="Playoff points"
            value={player.playoff.points.toFixed(1)}
            sub={`${player.playoff.weeksRostered} playoff weeks`}
          />
          <Stat
            label="Best week"
            value={player.best ? player.best.points.toFixed(1) : '—'}
            sub={
              player.best
                ? `${player.best.season} wk ${player.best.week} · ${player.best.displayName}`
                : undefined
            }
          />
        </div>

        <PlayerTimeline weekly={player.weekly} className="mt-8" />

        {/* Season table. A bar column rather than a second chart: six values do
            not need axes, and the numbers are wanted anyway. */}
        <h2 className="mt-10 border-b border-rule-strong pb-1 font-display text-sm font-bold uppercase tracking-[0.08em]">
          By season
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-3 font-normal">Season</th>
                <th className="py-1 pr-3 font-normal">Points</th>
                <th className="py-1 pr-3 font-normal">Playoffs</th>
                <th className="py-1 pr-3 font-normal">Rostered by</th>
                <th className="py-1 font-normal">At auction</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {player.seasons.map((s) => (
                <tr key={s.season} className="border-t border-rule align-top">
                  <td className="py-2 pr-3 font-bold">{s.season}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2 rounded-sm"
                        style={{
                          width: `${Math.max(2, (s.points / seasonMax) * 100)}px`,
                          background: 'var(--mgr-indigo)',
                        }}
                      />
                      {s.points.toFixed(1)}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-slate-400">
                    {s.playoff.weeksRostered === 0 ? '—' : s.playoff.points.toFixed(1)}
                  </td>
                  <td className="py-2 pr-3 font-sans">
                    {s.owners.map((o) => (
                      <span key={o.managerId} className="mr-2 inline-flex items-baseline gap-1">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 self-center"
                          style={{ background: managerColor(colorOf[o.managerId] ?? '') }}
                        />
                        {o.displayName}
                        <span className="text-slate-500">{o.weeksRostered}w</span>
                      </span>
                    ))}
                  </td>
                  <td className="py-2 font-sans">
                    {s.draft ? (
                      <>
                        <span className="font-mono font-bold">${s.draft.price}</span>{' '}
                        {s.draft.displayName}
                        {s.draft.nominatedBy && !s.draft.nominatorWon && (
                          <span className="block text-xs text-slate-500">
                            nominated by {s.draft.nominatedBy.displayName}
                          </span>
                        )}
                        {s.draft.nominatorWon && (
                          <span className="block text-xs text-slate-500">nominated himself</span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-600">no auction on record</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* "Managers" rather than "Who kept him": this page also serves team
            defenses (Kansas City Chiefs, Tampa Bay Buccaneers), where a pronoun
            reads as a bug. The neutral heading is correct for every row. */}
        <h2 className="mt-10 border-b border-rule-strong pb-1 font-display text-sm font-bold uppercase tracking-[0.08em]">
          Managers
        </h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {player.owners.map((o) => (
            <li key={o.managerId} className="flex items-baseline gap-2 border border-rule px-3 py-2">
              <span
                aria-hidden
                className="h-4 w-1.5 shrink-0 self-center"
                style={{ background: managerColor(colorOf[o.managerId] ?? '') }}
              />
              <Link
                href={`/history/members/${o.managerId}`}
                className="flex-1 hover:text-slate-300"
              >
                {o.displayName}
              </Link>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {o.weeksRostered}w · {o.points.toFixed(1)} pts
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
