import { PlayerSearch } from '@/components/history/PlayerSearch'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { listPlayers } from '@/server/history-service'

/** Everyone the league has ever rostered, newest scoring first. */
export const revalidate = 3600

export const metadata = { title: 'Players — FantasyWorld' }

export default async function PlayersPage() {
  const players = await listPlayers()

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/players" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Players</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        <p className="mb-3 text-xs text-slate-500">
          Every player on a Fantasy World roster since 2020, when week-by-week scoring starts.
          Ordered by total points scored while rostered.
        </p>
        <PlayerSearch players={players} />
      </div>
    </main>
  )
}
