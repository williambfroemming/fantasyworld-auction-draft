'use client'

import { useState } from 'react'
import { useCountdown, useDraft } from '@/hooks/useDraft'

/**
 * Ten seats in one window.
 *
 * Every action goes through the same auction rules as the real UI — this only
 * skips the PIN. So a race started here is a genuine race, and a max-bid
 * rejection here is the real rule firing.
 */
export function TestConsole() {
  const { state, board, clock, refresh } = useDraft()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [playerQuery, setPlayerQuery] = useState('')
  const [openingBid, setOpeningBid] = useState('1')

  const countdown = useCountdown(state?.lot?.endsAt, clock, state?.draft.status === 'paused')

  function note(line: string) {
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 60))
  }

  async function act(body: Record<string, unknown>, label: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/test/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      note(data.ok ? `✓ ${label}` : `✗ ${label} — ${data.reason}`)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  /** Fire N bids at the same instant to prove exactly one wins. */
  async function stampede() {
    if (!state?.lot) return
    const lotId = state.lot.id
    const amount = state.lot.highBid + 5
    const bidders = state.managers.filter(
      (m) => m.id !== state.lot!.highBidderId && m.maxBid >= amount,
    )
    setBusy(true)
    note(`⚡ ${bidders.length} managers all bidding $${amount} simultaneously…`)
    const results = await Promise.all(
      bidders.map((m) =>
        fetch('/api/test/act', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'bid', managerId: m.id, lotId, amount }),
        })
          .then((r) => r.json())
          .then((d) => ({ m, d })),
      ),
    )
    const winners = results.filter((r) => r.d.ok)
    note(
      `   ${winners.length} accepted (${winners.map((w) => w.m.displayName).join(', ') || 'none'}), ` +
        `${results.length - winners.length} rejected — expect exactly 1 accepted`,
    )
    setBusy(false)
    await refresh()
  }

  if (!state) return <main className="p-8 text-slate-400">Loading…</main>

  const lot = state.lot
  const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)
  const pool = (board?.pool ?? []).filter((p) =>
    playerQuery ? p.name.toLowerCase().includes(playerQuery.toLowerCase()) : true,
  )

  return (
    <main className="min-h-dvh bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">Test Console</h1>
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-300">
            acts as any manager — dev only
          </span>
          <a href="/draft" className="ml-auto text-sm text-slate-400 underline">
            → real draft view
          </a>
        </header>

        {/* Current lot */}
        <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          {lot ? (
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <div className="text-lg font-bold">
                  {lot.playerName}{' '}
                  <span className="text-sm font-normal text-slate-400">
                    {lot.playerPosition} · {lot.playerTeam}
                  </span>
                </div>
                <div className="text-sm text-slate-400">
                  ${lot.highBid} —{' '}
                  <span className="font-semibold text-slate-200">
                    {state.managers.find((m) => m.id === lot.highBidderId)?.displayName}
                  </span>
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-4xl font-bold tabular-nums">{countdown?.seconds ?? '—'}</div>
                <div className="text-xs text-slate-500">
                  {state.draft.status === 'paused' ? 'paused' : 'seconds'}
                </div>
              </div>
              <button
                onClick={stampede}
                disabled={busy}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold hover:bg-amber-500 disabled:opacity-40"
              >
                ⚡ All bid at once
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-slate-400">
                Nothing on the block. On the clock:{' '}
                <span className="font-semibold" style={{ color: onClock?.color }}>
                  {onClock?.displayName ?? '—'}
                </span>
              </span>
              <input
                value={playerQuery}
                onChange={(e) => setPlayerQuery(e.target.value)}
                placeholder="search a player…"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
              />
              <input
                value={openingBid}
                onChange={(e) => setOpeningBid(e.target.value.replace(/\D/g, '').slice(0, 3))}
                className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center text-sm tabular-nums"
              />
              <button
                disabled={busy || !pool[0] || !onClock}
                onClick={() =>
                  act(
                    {
                      action: 'nominate',
                      managerId: onClock!.id,
                      playerId: pool[0].id,
                      openingBid: Number(openingBid) || 1,
                    },
                    `${onClock!.displayName} nominates ${pool[0].name} at $${openingBid}`,
                  )
                }
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
              >
                Nominate {pool[0]?.name ?? '—'}
              </button>
            </div>
          )}
        </section>

        {/* Seats */}
        <section className="mt-4 grid gap-2 sm:grid-cols-2">
          {state.managers.map((m) => {
            const isHigh = lot?.highBidderId === m.id
            return (
              <div
                key={m.id}
                className={`rounded-xl border p-3 ${
                  isHigh ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                  <span className="font-semibold">{m.displayName}</span>
                  {isHigh && <span className="text-xs text-emerald-400">high bidder</span>}
                  <span className="ml-auto text-xs text-slate-400">
                    ${m.budget} · max ${m.maxBid} · {m.rostered}/{state.draft.rosterSize}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {[1, 5, 10].map((inc) => (
                    <button
                      key={inc}
                      disabled={busy || !lot || isHigh}
                      onClick={() =>
                        act(
                          { action: 'bid', managerId: m.id, lotId: lot!.id, amount: lot!.highBid + inc },
                          `${m.displayName} bids $${lot!.highBid + inc}`,
                        )
                      }
                      className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold hover:bg-slate-700 disabled:opacity-30"
                    >
                      +${inc}
                    </button>
                  ))}
                  <button
                    disabled={busy || !lot || isHigh || m.maxBid <= (lot?.highBid ?? 0)}
                    onClick={() =>
                      act(
                        { action: 'bid', managerId: m.id, lotId: lot!.id, amount: m.maxBid },
                        `${m.displayName} bids their max $${m.maxBid}`,
                      )
                    }
                    className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold hover:bg-slate-700 disabled:opacity-30"
                  >
                    max ${m.maxBid}
                  </button>
                  <button
                    disabled={busy || !lot}
                    onClick={() =>
                      act(
                        { action: 'bid', managerId: m.id, lotId: lot!.id, amount: m.maxBid + 1 },
                        `${m.displayName} tries $${m.maxBid + 1} (should be REJECTED)`,
                      )
                    }
                    className="rounded-md bg-rose-900/60 px-2.5 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-800/60 disabled:opacity-30"
                  >
                    over max ✗
                  </button>
                </div>
              </div>
            )
          })}
        </section>

        {/* Log */}
        <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Activity
          </h2>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-300">
            {log.join('\n') || 'Nothing yet.'}
          </pre>
        </section>
      </div>
    </main>
  )
}
