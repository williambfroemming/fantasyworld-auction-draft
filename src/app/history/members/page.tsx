import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { managerColor } from '@/lib/colors'
import { listMembers } from '@/server/history-service'

/** The ten. Ordered by career win percentage, same as the all-time table. */
export const revalidate = 3600

export const metadata = { title: 'Members — FantasyWorld' }

export default async function MembersPage() {
  const members = await listMembers()

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/members" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Members</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6">
        <ul className="grid gap-2 sm:grid-cols-2">
          {members.map((m) => (
            <li key={m.member.managerId}>
              <Link
                href={`/history/members/${m.member.managerId}`}
                className="flex items-baseline gap-3 border border-rule p-3 hover:border-rule-strong hover:bg-slate-900/60"
              >
                <span
                  aria-hidden
                  className="h-6 w-1.5 shrink-0 self-center"
                  style={{ backgroundColor: managerColor(m.member.color) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-base font-bold">
                    {m.member.displayName}
                  </span>
                  <span className="block font-mono text-xs text-slate-400 tabular-nums">
                    {m.wins}-{m.losses} · {m.winPct.toFixed(3).replace(/^0/, '')} · {m.seasons}{' '}
                    seasons
                  </span>
                </span>
                {/*
                  Up to three rings are drawn; past that it becomes one ring and
                  a count. Three trophies followed by "×4" reads as three times
                  four, which is how a five-time champion looked like a
                  twelve-time one.
                */}
                {m.titles > 0 && (
                  <span
                    className="shrink-0 font-mono text-sm text-amber-400 tabular-nums"
                    title={`${m.titles} championship${m.titles === 1 ? '' : 's'}`}
                  >
                    {m.titles <= 3 ? '🏆'.repeat(m.titles) : `🏆 ×${m.titles}`}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
