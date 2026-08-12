'use client'

import { useEffect, useRef, useState } from 'react'
import type { ClockSync } from '@/lib/clock'
import { validateBid } from '@/lib/draft'
import { sounds } from '@/lib/sounds'
import { useCountdown } from '@/hooks/useDraft'
import type { DraftState } from '@/server/draft-service'

const POSITION_TINT: Record<string, string> = {
  QB: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  RB: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  WR: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  TE: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  DEF: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  K: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
}

export function PositionBadge({ position }: { position: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ${
        POSITION_TINT[position] ?? POSITION_TINT.K
      }`}
    >
      {position}
    </span>
  )
}

export function LotPanel({
  state,
  clock,
  me,
  onBid,
}: {
  state: DraftState
  clock: ClockSync
  me: number | null
  onBid: (amount: number) => Promise<string | null>
  }) {
  const lot = state.lot
  const paused = state.draft.status === 'paused'
  const countdown = useCountdown(lot?.endsAt, clock, paused)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const myManager = state.managers.find((m) => m.id === me) ?? null
  const highBidder = state.managers.find((m) => m.id === lot?.highBidderId)
  const nominator = state.managers.find((m) => m.id === lot?.nominatorId)
  const iAmHigh = lot?.highBidderId === me

  const seconds = countdown?.seconds ?? null
  const urgent = seconds !== null && seconds <= 10
  const critical = seconds !== null && seconds <= 3

  // --- audio cues ----------------------------------------------------------
  const lastBid = useRef<number | null>(null)
  const lastSecond = useRef<number | null>(null)
  const lastLotId = useRef<number | null>(null)

  useEffect(() => {
    if (!lot) {
      // A lot that existed a moment ago and is now gone was sold.
      if (lastLotId.current !== null) sounds.sold()
      lastLotId.current = null
      lastBid.current = null
      return
    }
    if (lot.id !== lastLotId.current) {
      lastLotId.current = lot.id
      lastBid.current = lot.highBid
      return
    }
    if (lastBid.current !== null && lot.highBid > lastBid.current) sounds.bid()
    lastBid.current = lot.highBid
  }, [lot])

  useEffect(() => {
    if (seconds === null || paused) return
    if (lastSecond.current === seconds) return
    const prev = lastSecond.current
    lastSecond.current = seconds
    if (prev === null) return
    if (seconds === 10) sounds.warn()
    else if (seconds <= 3 && seconds > 0 && seconds < prev) sounds.tick()
  }, [seconds, paused])

  // -------------------------------------------------------------------------
  if (!lot) {
    const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)
    return (
      <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
        {state.draft.status === 'done' ? (
          <>
            <div className="text-2xl font-bold">Draft complete</div>
            <p className="mt-2 text-slate-400">Every roster is full.</p>
          </>
        ) : (
          <>
            <div className="text-sm uppercase tracking-widest text-slate-500">On the clock</div>
            <div className="mt-2 text-4xl font-bold" style={{ color: onClock?.color }}>
              {onClock?.displayName ?? '—'}
            </div>
            <p className="mt-3 max-w-sm text-slate-400">
              {onClock?.id === me
                ? 'Pick a player from the list and set your opening bid.'
                : 'Waiting for a nomination. No clock is running — take your time.'}
            </p>
          </>
        )}
      </div>
    )
  }

  const nextBid = lot.highBid + 1
  const maxBid = myManager?.maxBid ?? 0
  const canBidAtAll = me !== null && !iAmHigh

  const check = (amount: number) =>
    validateBid({
      amount,
      currentHighBid: lot.highBid,
      managerMaxBid: maxBid,
      managerRostered: myManager?.rostered ?? 0,
      rosterSize: state.draft.rosterSize,
      draftStatus: state.draft.status,
      lotStatus: 'open',
      msRemaining: countdown?.ms ?? 0,
    })

  async function bid(amount: number) {
    const pre = check(amount)
    if (!pre.ok) {
      setError(pre.reason)
      return
    }
    setPending(true)
    setError(null)
    const reason = await onBid(amount)
    setError(reason)
    setPending(false)
    setCustom('')
  }

  return (
    <div
      className={`rounded-2xl border bg-slate-900/60 p-5 transition-colors sm:p-6 ${
        critical
          ? 'border-rose-500/70 shadow-[0_0_40px_-10px] shadow-rose-500/40'
          : urgent
            ? 'border-amber-500/60'
            : 'border-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PositionBadge position={lot.playerPosition} />
            <span className="text-sm text-slate-400">
              {lot.playerTeam ?? 'FA'}
              {lot.playerByeWeek ? ` · bye ${lot.playerByeWeek}` : ''}
            </span>
          </div>
          <h2 className="mt-1 truncate text-3xl font-bold tracking-tight sm:text-4xl">
            {lot.playerName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            nominated by {nominator?.displayName ?? '—'}
          </p>
        </div>

        <div className="text-right">
          <div
            className={`tabular-nums font-bold leading-none transition-colors ${
              critical ? 'text-rose-400' : urgent ? 'text-amber-300' : 'text-slate-100'
            } text-6xl sm:text-7xl`}
          >
            {paused ? '❚❚' : (seconds ?? '—')}
          </div>
          <div className="mt-1 text-xs uppercase tracking-widest text-slate-500">
            {paused ? 'paused' : !countdown?.synced ? 'syncing…' : 'seconds'}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-slate-800 pt-5">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Current bid</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-4xl font-bold tabular-nums">${lot.highBid}</span>
            <span
              className="rounded-full px-2.5 py-1 text-sm font-semibold"
              style={{
                backgroundColor: `${highBidder?.color ?? '#334155'}22`,
                color: highBidder?.color ?? '#cbd5e1',
              }}
            >
              {iAmHigh ? 'You' : (highBidder?.displayName ?? '—')}
            </span>
          </div>
        </div>

        {myManager && (
          <div className="text-right text-sm">
            <div className="text-slate-500">
              Budget <span className="font-semibold text-slate-300">${myManager.budget}</span>
            </div>
            <div className="text-slate-500">
              Max bid{' '}
              <span
                className={`font-semibold ${maxBid <= 0 ? 'text-rose-400' : 'text-emerald-400'}`}
              >
                ${maxBid}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bid controls */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {[1, 2, 5, 10].map((inc) => {
          const amount = lot.highBid + inc
          const ok = canBidAtAll && check(amount).ok
          return (
            <button
              key={inc}
              disabled={!ok || pending}
              onClick={() => bid(amount)}
              className="rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              ${amount}
              <span className="ml-1 text-xs opacity-70">+{inc}</span>
            </button>
          )
        })}

        <div className="flex items-center gap-2">
          <input
            inputMode="numeric"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && custom && bid(Number(custom))}
            placeholder={String(nextBid)}
            className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-center tabular-nums outline-none focus:border-emerald-500"
          />
          <button
            disabled={!custom || !canBidAtAll || pending}
            onClick={() => bid(Number(custom))}
            className="rounded-lg border border-slate-700 px-4 py-3 font-semibold transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Bid
          </button>
        </div>
      </div>

      {/* Why a bid isn't allowed — never fail silently mid-auction. */}
      {(error || iAmHigh || maxBid <= 0) && (
        <p
          className={`mt-3 text-sm ${
            error ? 'text-rose-400' : iAmHigh ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          {error ??
            (iAmHigh
              ? "You're the high bidder."
              : 'Your roster is full — you cannot bid.')}
        </p>
      )}
    </div>
  )
}
