'use client'

import Link from 'next/link'
import { LeagueBoard } from '@/components/LeagueBoard'
import { useCountdown, useDraft } from '@/hooks/useDraft'

/**
 * The League board on its own page.
 *
 * Deliberately separate from /draft: during bidding the only thing that matters
 * is the player and the clock, and a 10-column grid competing for attention
 * made both worse. People come here between picks.
 *
 * It still polls, so it stays live — and it keeps a small clock in the header so
 * anyone parked on this page can see a lot is running and get back.
 */
export default function BoardPage() {
  const { state, board, clock } = useDraft()
  const countdown = useCountdown(state?.lot?.endsAt, clock, state?.draft.status === 'paused')

  if (!state) {
    return <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>
  }

  const lot = state.lot
  const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)
  const urgent = (countdown?.seconds ?? 99) <= 10

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
            <>
              <span className="text-sm text-slate-300">
                <span className="font-semibold">{lot.playerName}</span>
                <span className="ml-2 text-slate-500">${lot.highBid}</span>
              </span>
              <span
                className={`tabular-nums text-2xl font-bold ${
                  urgent ? 'text-rose-400' : 'text-slate-200'
                }`}
              >
                {state.draft.status === 'paused' ? '❚❚' : (countdown?.seconds ?? '—')}
              </span>
            </>
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
