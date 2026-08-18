'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LeagueBoard } from '@/components/LeagueBoard'
import { MarketPanel } from '@/components/MarketPanel'
import { SeasonPicker } from '@/components/SeasonPicker'
import { useDraft } from '@/hooks/useDraft'
import { useSeasonView } from '@/hooks/useSeasonView'
import { ThemeToggle } from '@/components/ThemeToggle'

/**
 * The League board on its own page, for the live draft and every past one.
 *
 * Deliberately separate from /draft: during bidding the only thing that matters
 * is the player on the block, and a 10-column grid competing for attention made
 * both worse. People come here between picks.
 *
 * The season picker lives here rather than on /draft for the same reason — this
 * is already the wide, dense, "study the board" screen, and browsing 2026 is a
 * between-picks activity by definition. Picking a past year swaps in a
 * read-only archive: same grid, no nominate, no award, and it stops polling.
 */
export default function BoardPage() {
  const { state, board } = useDraft()
  const { seasons, viewing, setViewing, isArchive, archive, archiveError } = useSeasonView()
  const [view, setView] = useState<'grid' | 'market'>('grid')

  if (!state) {
    return <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>
  }

  const lot = state.lot
  const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)

  return (
    <main className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <Link
          href="/draft"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold hover:bg-slate-700"
        >
          ← Back to draft
        </Link>

        {/* Grid vs market: two ways of reading the same draft. The grid is who
            has whom; the market is what the money has been going to. */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
          {(
            [
              ['grid', 'Board'],
              ['market', 'Market'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                view === key ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <SeasonPicker
          liveSeason={state.draft.season}
          seasons={seasons}
          viewing={viewing}
          onSelect={setViewing}
        />

        <Link
          href="/stats"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          Stats →
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {isArchive ? (
            <>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                Archived · read only
              </span>
              <a
                href={`/api/export?season=${viewing}`}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold hover:bg-slate-700"
              >
                Export CSV
              </a>
            </>
          ) : lot ? (
            <span className="flex items-center gap-2 text-sm text-slate-300">
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                On the block
              </span>
              <span className="font-semibold">{lot.playerName}</span>
            </span>
          ) : (
            <span className="text-sm text-slate-400">
              On the clock:{' '}
              <span className="font-semibold" style={{ color: onClock?.color }}>
                {onClock?.displayName ?? '—'}
              </span>
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 p-3">
        {!isArchive ? (
          view === 'grid' ? (
            <LeagueBoard managers={state.managers} board={board} className="h-full" />
          ) : (
            <MarketPanel
              rosters={board?.rosters ?? []}
              pool={board?.pool ?? []}
              className="h-full"
            />
          )
        ) : archiveError ? (
          <div className="grid h-full place-items-center text-slate-400">{archiveError}</div>
        ) : !archive ? (
          <div className="grid h-full place-items-center text-slate-500">Loading {viewing}…</div>
        ) : view === 'grid' ? (
          <LeagueBoard
            managers={archive.managers}
            board={archive}
            title={`${archive.season} draft`}
            className="h-full"
          />
        ) : (
          // No pool for a finished season — "what's left at WR" is not a
          // question a completed draft has an answer to.
          <MarketPanel rosters={archive.rosters} className="h-full" />
        )}
      </div>
    </main>
  )
}
