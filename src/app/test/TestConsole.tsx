'use client'

import { useState } from 'react'
import { useDraft } from '@/hooks/useDraft'

/**
 * Ten seats in one window.
 *
 * Every action goes through the same auction rules as the real UI — this only
 * skips the PIN. So a max-bid rejection here is the real rule firing, which is
 * what makes it worth anything as a verification tool.
 *
 * The "over max ✗" button on each seat is the important one: it should always be
 * refused, and it is the fastest way to confirm the invariant still holds after
 * a change.
 */
export function TestConsole() {
  const { state, board, refresh } = useDraft()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [playerQuery, setPlayerQuery] = useState('')
  const [price, setPrice] = useState('1')

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

  /**
   * Fire the same award from every seat at once. Exactly one must land: the lot
   * can only be sold once, and the losers must be told why rather than silently
   * double-charging somebody.
   */
  async function stampede() {
    if (!state?.lot) return
    const lotId = state.lot.id
    const amount = Number(price) || 1
    const winners = state.managers.filter((m) => m.maxBid >= amount)
    setBusy(true)
    note(`⚡ ${winners.length} seats all recording $${amount} simultaneously…`)
    const results = await Promise.all(
      winners.map((m) =>
        fetch('/api/test/act', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // managerId is the caller; the commissioner seat is allowed to record
          // any lot, so this exercises the real award path from ten directions.
          body: JSON.stringify({
            action: 'award',
            managerId: state.lot!.nominatorId,
            lotId,
            winnerId: m.id,
            price: amount,
          }),
        })
          .then((r) => r.json())
          .then((d) => ({ m, d })),
      ),
    )
    const landed = results.filter((r) => r.d.ok)
    note(
      `   ${landed.length} accepted (${landed.map((w) => w.m.displayName).join(', ') || 'none'}), ` +
        `${results.length - landed.length} rejected — expect exactly 1 accepted`,
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
        <section className="mt-4 rounded-xl border border-rule bg-slate-900/60 p-4">
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
                  on the block — nominated by{' '}
                  <span className="font-semibold text-slate-200">
                    {state.managers.find((m) => m.id === lot.nominatorId)?.displayName}
                  </span>
                </div>
              </div>
              <label className="ml-auto text-xs text-slate-400">
                price
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="ml-2 w-20 rounded-lg border border-rule bg-slate-950 px-2 py-1.5 text-center text-sm tabular-nums"
                />
              </label>
              <button
                onClick={stampede}
                disabled={busy}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold hover:bg-amber-500 disabled:opacity-40"
              >
                ⚡ All record at once
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
                className="rounded-lg border border-rule bg-slate-950 px-3 py-1.5 text-sm"
              />
              <button
                disabled={busy || !pool[0] || !onClock}
                onClick={() =>
                  act(
                    { action: 'nominate', managerId: onClock!.id, playerId: pool[0].id },
                    `${onClock!.displayName} nominates ${pool[0].name}`,
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
          {state.managers.map((m) => (
            <div key={m.id} className="rounded-xl border border-rule bg-slate-900/60 p-3">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                <span className="font-semibold">{m.displayName}</span>
                <span className="ml-auto text-xs text-slate-400">
                  ${m.budget} · max ${m.maxBid} · {m.rostered}/{state.draft.rosterSize}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  disabled={busy || !lot}
                  onClick={() =>
                    act(
                      {
                        action: 'award',
                        managerId: lot!.nominatorId,
                        lotId: lot!.id,
                        winnerId: m.id,
                        price: Number(price) || 1,
                      },
                      `${m.displayName} wins at $${Number(price) || 1}`,
                    )
                  }
                  className="rounded-md bg-emerald-800/70 px-2.5 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-700/70 disabled:opacity-30"
                >
                  wins at ${Number(price) || 1}
                </button>
                <button
                  disabled={busy || !lot || m.maxBid <= 0}
                  onClick={() =>
                    act(
                      {
                        action: 'award',
                        managerId: lot!.nominatorId,
                        lotId: lot!.id,
                        winnerId: m.id,
                        price: m.maxBid,
                      },
                      `${m.displayName} wins at their max $${m.maxBid}`,
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
                      {
                        action: 'award',
                        managerId: lot!.nominatorId,
                        lotId: lot!.id,
                        winnerId: m.id,
                        price: m.maxBid + 1,
                      },
                      `${m.displayName} at $${m.maxBid + 1} (should be REJECTED)`,
                    )
                  }
                  className="rounded-md bg-rose-900/60 px-2.5 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-800/60 disabled:opacity-30"
                >
                  over max ✗
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* Log */}
        <section className="mt-4 rounded-xl border border-rule bg-slate-900/60 p-3">
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
