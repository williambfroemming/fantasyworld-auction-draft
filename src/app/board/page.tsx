'use client'

import Link from 'next/link'
import { LeagueBoard } from '@/components/LeagueBoard'
import { useDraft } from '@/hooks/useDraft'

/**
 * The League board on its own page.
 *
 * Deliberately separate from /draft: during bidding the only thing that matters
 * is the player on the block, and a 10-column grid competing for attention made
 * both worse. People come here between picks.
 *
 * It still polls, so it stays live — and it names the player currently up in the
 * header so anyone parked on this page can see the auction has moved on.
 */
export default function BoardPage() {
  const { state, board } = useDraft()

  if (!state) {
    return <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>
  }

  const lot = state.lot
  const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)

  return (
    <main className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2.5">
        <Link
          href="/draft"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold hover:bg-slate-700"
        >
          ← Back to draft
        </Link>
        <h1 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          League board
        </h1>

        {/* Live status, so nobody misses a lot while studying the grid. */}
        <div className="ml-auto flex items-center gap-3">
          {lot ? (
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
        <LeagueBoard managers={state.managers} board={board} className="h-full" />
      </div>
    </main>
  )
}
