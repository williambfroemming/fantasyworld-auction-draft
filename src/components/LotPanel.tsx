'use client'

import { useEffect, useRef, useState } from 'react'
import { validateAward } from '@/lib/draft'
import { InjuryBadge } from './InjuryBadge'
import { sounds } from '@/lib/sounds'
import type { DraftState, StateManager } from '@/server/draft-service'

/**
 * Position badges are solid blocks of ink, not tinted washes — a newspaper
 * prints a block or it prints nothing, and a wash reads as mush at this size.
 *
 * The fill is the `-300` step and the ink is `slate-950`. That pairing is
 * correct in BOTH themes because they move in opposite directions: `-300` is
 * the readable accent on each ground (dark on newsprint, bright on press
 * black) while `slate-950` inverts to the page colour behind it. Every
 * combination clears 6.4:1.
 */
const POSITION_TINT: Record<string, string> = {
  QB: 'bg-rose-300 text-slate-950',
  RB: 'bg-emerald-300 text-slate-950',
  WR: 'bg-sky-300 text-slate-950',
  TE: 'bg-amber-300 text-slate-950',
  DEF: 'bg-violet-300 text-slate-950',
  K: 'bg-slate-300 text-slate-950',
}

export function PositionBadge({ position }: { position: string }) {
  return (
    <span
      // `uppercase` carries the condensed gothic (see globals.css); the ring is
      // gone because the fill is solid now and a ring on it just muddies the edge.
      className={`px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        POSITION_TINT[position] ?? POSITION_TINT.K
      }`}
    >
      {position}
    </span>
  )
}

/**
 * The player on the block, and the form that records what the room decided.
 *
 * The bidding happens out loud. This panel's whole job is to make the two facts
 * that come out of it — who won, and for how much — fast and impossible to get
 * wrong. Hence the layout: type the price first, and every manager who cannot
 * afford it greys out before you can pick them. The rejection arrives while the
 * room is still listening, not after the nominator has already moved on.
 */
export function LotPanel({
  state,
  me,
  onAward,
}: {
  state: DraftState
  me: number | null
  onAward: (winnerId: number, price: number) => Promise<string | null>
}) {
  const lot = state.lot
  const [price, setPrice] = useState('')
  const [winnerId, setWinnerId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const nominator = state.managers.find((m) => m.id === lot?.nominatorId)
  const myManager = state.managers.find((m) => m.id === me) ?? null
  // The nominator ran the bidding, so they type the result. The commissioner can
  // always step in — on the night, someone's phone will lock at the wrong moment.
  const canRecord = !!lot && (lot.nominatorId === me || !!myManager?.isCommish)

  // Reset the form whenever a different player goes up, or the entry is cleared
  // out from under us by someone else recording it first.
  const lastLotId = useRef<number | null>(null)
  useEffect(() => {
    if (lot?.id === lastLotId.current) return
    if (lastLotId.current !== null && !lot) sounds.sold()
    lastLotId.current = lot?.id ?? null
    setPrice('')
    setWinnerId(null)
    setError(null)
  }, [lot])

  if (!lot) {
    const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)
    const onDeck = state.managers.find((m) => m.id === state.onDeck?.managerId)

    const filled = state.managers.reduce((sum, m) => sum + m.rostered, 0)
    const total = state.managers.length * state.draft.rosterSize
    const slotsLeft = total - filled
    const spent = state.managers.reduce(
      (sum, m) => sum + (state.draft.startingBudget - m.budget),
      0,
    )

    // Three different states used to render as the same empty clock, which is
    // what made the 2026 stall read as a freeze: nobody could tell whether to
    // wait or intervene. See docs/BACKLOG.md §9, P1.
    const finished = state.draft.status === 'done' || slotsLeft === 0
    const stuck = !finished && !onClock && state.draft.status === 'live'

    return (
      <div className="rule-strong flex h-full flex-col items-center justify-center rounded-2xl border border-rule bg-slate-900/60 p-8 text-center">
        {finished ? (
          <>
            <div className="text-7xl">🏈</div>
            <div className="mt-4 font-display text-6xl font-bold uppercase tracking-tight text-rose-500">
              Draft Complete!
            </div>
            <p className="mt-4 text-lg text-slate-300">
              {filled} picks · ${spent} spent · {state.managers.length} rosters full
            </p>
            <p className="mt-1 text-sm text-slate-500">
              The {state.draft.season} board is saved and stays browsable by year.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <a
                href="/board"
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
              >
                League board →
              </a>
              <a
                href={`/api/export?season=${state.draft.season}`}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
              >
                Export CSV
              </a>
            </div>
          </>
        ) : stuck ? (
          // Never render a bare empty clock while slots remain. That is a bug,
          // and the screen should say so rather than looking deliberate.
          <>
            <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-rose-300">
              Nobody on the clock
            </span>
            <p className="mt-4 max-w-md text-lg text-slate-300">
              {slotsLeft} roster {slotsLeft === 1 ? 'slot is' : 'slots are'} still unfilled but the
              app has lost track of whose turn it is. This is a fault, not the end of the draft.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              The commissioner can use ⚙ Commish → Skip nominator to get things moving.
            </p>
          </>
        ) : (
          <>
            <span className="text-sm uppercase tracking-[0.3em] text-slate-500">On the clock</span>
            <span
              className="mt-3 font-display text-7xl font-bold leading-none tracking-tight"
              style={{ color: onClock?.color }}
            >
              {onClock?.displayName ?? '—'}
            </span>
            {/* One name, not a list. The snake turn — where the same manager
                nominates twice in a row — is the part that confuses the room. */}
            {onDeck && (
              <span className="mt-4 text-sm text-slate-500">
                On deck:{' '}
                <span className="font-semibold" style={{ color: onDeck.color }}>
                  {onDeck.displayName}
                </span>
                {onDeck.id === onClock?.id && ' (again — the order turns here)'}
              </span>
            )}
            {onClock?.id === me && (
              <span className="mt-5 text-lg text-slate-400">
                Pick a player on the left to put them up for auction.
              </span>
            )}
            <span className="mt-6 text-xs uppercase tracking-widest text-slate-600">
              {filled} of {total} picks made · {slotsLeft} to go
            </span>
          </>
        )}
      </div>
    )
  }

  const priceNum = price === '' ? null : Number(price)

  const check = (mgr: StateManager, amount: number) =>
    validateAward({
      price: amount,
      winnerMaxBid: mgr.maxBid,
      winnerRostered: mgr.rostered,
      winnerName: mgr.displayName,
      rosterSize: state.draft.rosterSize,
      draftStatus: state.draft.status,
      lotStatus: 'open',
    })

  const winner = state.managers.find((m) => m.id === winnerId) ?? null
  const ready = winner !== null && priceNum !== null && check(winner, priceNum).ok

  async function submit() {
    if (!winner || priceNum === null) return
    const pre = check(winner, priceNum)
    if (!pre.ok) {
      setError(pre.reason)
      return
    }
    setPending(true)
    setError(null)
    const reason = await onAward(winner.id, priceNum)
    setPending(false)
    if (reason) setError(reason)
    else {
      setPrice('')
      setWinnerId(null)
    }
  }

  return (
    <div className="rule-strong flex h-full flex-col rounded-2xl border border-emerald-600/40 bg-slate-900/60 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PositionBadge position={lot.playerPosition} />
            {/* On the block is where health matters most — this is the moment
                money gets committed. Full text, not the abbreviation. */}
            <InjuryBadge injury={lot.playerInjury} size="lg" />
            <span className="text-sm text-slate-400">
              {lot.playerTeam ?? 'FA'}
              {lot.playerByeWeek ? ` · bye ${lot.playerByeWeek}` : ''}
            </span>
          </div>
          <h2 className="mt-1 truncate font-display text-4xl font-bold tracking-tight sm:text-6xl">
            {lot.playerName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            nominated by {nominator?.displayName ?? '—'}
          </p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-300">
          On the block
        </span>
      </div>

      {!canRecord ? (
        <div className="mt-auto border-t border-rule pt-6 text-slate-400">
          <p className="text-lg">
            Bidding is open in the room.{' '}
            <span className="font-semibold" style={{ color: nominator?.color }}>
              {nominator?.displayName ?? 'The nominator'}
            </span>{' '}
            will record the winner and price.
          </p>
          {myManager && (
            <p className="mt-2 text-sm text-slate-500">
              You have <span className="font-semibold text-slate-300">${myManager.budget}</span> and
              can bid up to{' '}
              <span className={`font-semibold ${myManager.maxBid <= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                ${myManager.maxBid}
              </span>
              {myManager.maxBid <= 0 && ' — your roster is full'}.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-auto border-t border-rule pt-5">
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs uppercase tracking-widest text-slate-500">
              Sold for
              <div className="mt-1 flex items-center gap-1">
                <span className="font-display text-4xl font-bold text-slate-500">$</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value.replace(/\D/g, '').slice(0, 4))
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && ready && submit()}
                  placeholder="0"
                  className="w-28 rounded-lg border border-rule bg-slate-950 px-3 py-2 text-center font-display text-4xl font-bold tabular-nums outline-none focus:border-emerald-500"
                />
              </div>
            </label>
            <button
              disabled={!ready || pending}
              onClick={submit}
              className="rounded-lg bg-emerald-600 px-8 py-4 text-xl font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {pending ? 'Recording…' : 'Sold'}
            </button>
          </div>

          <div className="mt-4 text-xs uppercase tracking-widest text-slate-500">Winner</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            {state.managers.map((m) => {
              // Before a price is typed, only a full roster rules someone out.
              const verdict = check(m, priceNum ?? 1)
              const selected = m.id === winnerId
              return (
                <button
                  key={m.id}
                  disabled={!verdict.ok}
                  title={verdict.ok ? undefined : verdict.reason}
                  onClick={() => {
                    setWinnerId(m.id)
                    setError(null)
                  }}
                  className={`rounded-lg border px-2 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-30 ${
                    selected
                      ? 'border-emerald-500 bg-emerald-600/20'
                      : 'border-rule hover:bg-slate-800'
                  }`}
                  style={selected ? { borderColor: m.color } : undefined}
                >
                  <div className="truncate text-sm font-semibold" style={{ color: m.color }}>
                    {m.displayName}
                  </div>
                  <div className="text-[11px] tabular-nums text-slate-500">
                    ${m.budget} · max ${m.maxBid}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Never fail silently: if a price is over someone's max, say so with
              the number, because the room is waiting on an answer. */}
          {(error || (winner && priceNum !== null && !check(winner, priceNum).ok)) && (
            <p className="mt-3 text-sm font-medium text-rose-400">
              {error ?? (winner && priceNum !== null ? (check(winner, priceNum) as { reason: string }).reason : '')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
