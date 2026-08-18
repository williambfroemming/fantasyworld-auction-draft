'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TradePanel } from '@/components/TradePanel'
import { useDraft } from '@/hooks/useDraft'
import { managerTint } from '@/lib/colors'
import { ThemeToggle } from '@/components/ThemeToggle'

/**
 * Trades, on their own page.
 *
 * Same reasoning that moved the League board off /draft: bidding, studying the
 * board, and negotiating a trade are three different moments, and a form with
 * two rosters and four inputs cannot share a 19rem sidebar with a live auction.
 *
 * It polls like every other page, so budgets and rosters here are never stale —
 * which matters, because a trade is validated against the state at the instant
 * it executes, not the state that was on screen when it was built.
 */
export default function TradesPage() {
  const router = useRouter()
  const { state, board, refresh } = useDraft()
  const [me, setMe] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((d) => {
        setMe(d.managerId)
        if (!d.managerId) router.replace('/')
      })
      .catch(() => {})
  }, [router])

  if (!state) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>
    )
  }

  const myManager = state.managers.find((m) => m.id === me)

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <Link
          href="/draft"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold hover:bg-slate-700"
        >
          ← Back to draft
        </Link>
        <h1 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Trades</h1>
        {state.lot && (
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
            {state.lot.playerName} is on the block
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {myManager && (
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: managerTint(myManager.color, 20), color: myManager.color }}
          >
            {myManager.displayName}
          </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-4xl p-4">
        <TradePanel state={state} board={board} onDone={refresh} />
      </div>
    </main>
  )
}
