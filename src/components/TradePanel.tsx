'use client'

import { useMemo, useState } from 'react'
import { validateTrade } from '@/lib/draft'
import type { Board, RosterPick } from '@/hooks/useDraft'
import type { DraftState, StateManager } from '@/server/draft-service'
import { PositionBadge } from './LotPanel'

/**
 * Build and execute a trade.
 *
 * The deal itself is agreed in the room, out loud, like the auction — so this
 * is an entry form, not a negotiation. It shows the consequence of the deal
 * before it is committed, because the thing people get wrong about auction
 * trades is not who gets which player, it's what it does to the budgets.
 *
 * Two rules are surprising enough that the preview spells them out:
 *
 *  1. A traded player's salary stays with whoever bought them. Receiving a $50
 *     player costs you nothing; giving one away refunds you nothing.
 *  2. Giving a player away still opens a roster slot, and every empty slot must
 *     keep $1 behind it — so a manager who is nearly broke can be blocked from
 *     trading a player out even though no money leaves their side.
 */
export function TradePanel({
  state,
  board,
  onDone,
}: {
  state: DraftState
  board: Board | null
  onDone: () => Promise<void>
}) {
  const [aId, setAId] = useState<number | null>(null)
  const [bId, setBId] = useState<number | null>(null)
  const [aPicks, setAPicks] = useState<Set<number>>(new Set())
  const [bPicks, setBPicks] = useState<Set<number>>(new Set())
  const [cashA, setCashA] = useState('')
  const [cashB, setCashB] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const a = state.managers.find((m) => m.id === aId) ?? null
  const b = state.managers.find((m) => m.id === bId) ?? null

  const rosterOf = useMemo(() => {
    const map = new Map<number, RosterPick[]>()
    for (const p of board?.rosters ?? []) {
      const list = map.get(p.managerId) ?? []
      list.push(p)
      map.set(p.managerId, list)
    }
    return map
  }, [board])

  const cashAOut = Number(cashA || 0)
  const cashBOut = Number(cashB || 0)

  const preview =
    a && b
      ? validateTrade({
          rosterSize: state.draft.rosterSize,
          a: {
            name: a.displayName,
            budget: a.budget,
            rostered: a.rostered,
            playersOut: aPicks.size,
            playersIn: bPicks.size,
            cashOut: cashAOut,
            cashIn: cashBOut,
          },
          b: {
            name: b.displayName,
            budget: b.budget,
            rostered: b.rostered,
            playersOut: bPicks.size,
            playersIn: aPicks.size,
            cashOut: cashBOut,
            cashIn: cashAOut,
          },
        })
      : null

  function reset() {
    setAPicks(new Set())
    setBPicks(new Set())
    setCashA('')
    setCashB('')
    setError(null)
  }

  async function submit() {
    if (!a || !b) return
    setPending(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aId: a.id,
          bId: b.id,
          picksAToB: [...aPicks],
          picksBToA: [...bPicks],
          cashAToB: cashAOut,
          cashBToA: cashBOut,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setDone(`Trade #${data.data.tradeId} recorded.`)
        reset()
      } else {
        setError(data.reason ?? 'Trade rejected')
      }
      await onDone()
    } catch {
      setError('Network error — nothing was recorded')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Side
          label="Manager A"
          selectedId={aId}
          otherId={bId}
          managers={state.managers}
          onSelect={(id) => {
            setAId(id)
            setAPicks(new Set())
          }}
          roster={a ? (rosterOf.get(a.id) ?? []) : []}
          picked={aPicks}
          onToggle={(id) => setAPicks(toggle(aPicks, id))}
          cash={cashA}
          onCash={setCashA}
          manager={a}
        />
        <Side
          label="Manager B"
          selectedId={bId}
          otherId={aId}
          managers={state.managers}
          onSelect={(id) => {
            setBId(id)
            setBPicks(new Set())
          }}
          roster={b ? (rosterOf.get(b.id) ?? []) : []}
          picked={bPicks}
          onToggle={(id) => setBPicks(toggle(bPicks, id))}
          cash={cashB}
          onCash={setCashB}
          manager={b}
        />
      </div>

      {a && b && (
        <div className="rounded-xl border border-rule bg-slate-950/60 p-3">
          <div className="text-xs uppercase tracking-widest text-slate-500">After the trade</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Outcome
              m={a}
              rosterSize={state.draft.rosterSize}
              playersOut={aPicks.size}
              playersIn={bPicks.size}
              cashOut={cashAOut}
              cashIn={cashBOut}
            />
            <Outcome
              m={b}
              rosterSize={state.draft.rosterSize}
              playersOut={bPicks.size}
              playersIn={aPicks.size}
              cashOut={cashBOut}
              cashIn={cashAOut}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Salary stays with whoever drafted the player, so moving players changes roster spots and
            max bids, not budgets. Only the cash moves money.
          </p>
        </div>
      )}

      {preview && !preview.ok && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{preview.reason}</p>
      )}
      {error && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      )}
      {done && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{done}</p>
      )}

      <div className="flex gap-2">
        <button
          disabled={!preview?.ok || pending}
          onClick={submit}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
        >
          {pending ? 'Recording…' : 'Execute trade'}
        </button>
        <button
          onClick={reset}
          className="rounded-lg border border-rule px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Clear
        </button>
      </div>

      {board && board.trades.length > 0 && (
        <div className="border-t border-rule pt-3">
          <div className="text-xs uppercase tracking-widest text-slate-500">Completed trades</div>
          <ul className="mt-2 space-y-2">
            {board.trades.map((t) => {
              const ma = state.managers.find((m) => m.id === t.managerAId)
              const mb = state.managers.find((m) => m.id === t.managerBId)
              return (
                <li key={t.id} className="rounded-lg border border-rule bg-slate-900/60 p-2.5 text-xs">
                  <div className="font-semibold">
                    <span style={{ color: ma?.color }}>{ma?.displayName}</span>
                    <span className="text-slate-600"> ↔ </span>
                    <span style={{ color: mb?.color }}>{mb?.displayName}</span>
                    <span className="ml-2 font-normal text-slate-600">#{t.id}</span>
                  </div>
                  {t.players.map((p) => {
                    const to = state.managers.find((m) => m.id === p.toManagerId)
                    return (
                      <div key={p.pickId} className="mt-1 flex items-center gap-1.5 text-slate-400">
                        <PositionBadge position={p.position} />
                        <span>{p.name}</span>
                        <span className="text-slate-600">→ {to?.displayName}</span>
                      </div>
                    )
                  })}
                  {t.cashAToB !== 0 && (
                    <div className="mt-1 text-emerald-400">
                      ${Math.abs(t.cashAToB)}{' '}
                      {t.cashAToB > 0
                        ? `${ma?.displayName} → ${mb?.displayName}`
                        : `${mb?.displayName} → ${ma?.displayName}`}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function toggle(set: Set<number>, id: number): Set<number> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function Side({
  label,
  selectedId,
  otherId,
  managers,
  onSelect,
  roster,
  picked,
  onToggle,
  cash,
  onCash,
  manager,
}: {
  label: string
  selectedId: number | null
  otherId: number | null
  managers: StateManager[]
  onSelect: (id: number) => void
  roster: RosterPick[]
  picked: Set<number>
  onToggle: (id: number) => void
  cash: string
  onCash: (v: string) => void
  manager: StateManager | null
}) {
  return (
    <div className="rounded-xl border border-rule bg-slate-900/60 p-3">
      <div className="text-xs uppercase tracking-widest text-slate-500">{label} gives</div>
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}
        className="mt-2 w-full rounded-lg border border-rule bg-slate-950 px-2 py-2 text-sm"
      >
        <option value="">Choose a manager…</option>
        {managers
          .filter((m) => m.id !== otherId)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} — ${m.budget}, {m.rostered} players
            </option>
          ))}
      </select>

      {manager && (
        <>
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {roster.length === 0 && (
              <p className="py-3 text-center text-xs text-slate-600">No players yet.</p>
            )}
            {roster.map((p) => (
              <button
                key={p.id}
                onClick={() => onToggle(p.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                  picked.has(p.id) ? 'bg-emerald-600/25 ring-1 ring-emerald-500/50' : 'hover:bg-slate-800'
                }`}
              >
                <input type="checkbox" readOnly checked={picked.has(p.id)} className="accent-emerald-500" />
                <PositionBadge position={p.position} />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="tabular-nums text-slate-500">${p.price}</span>
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            plus $
            <input
              inputMode="numeric"
              value={cash}
              onChange={(e) => onCash(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0"
              className="w-20 rounded-lg border border-rule bg-slate-950 px-2 py-1.5 text-center tabular-nums outline-none focus:border-emerald-500"
            />
            of auction budget
          </label>
        </>
      )}
    </div>
  )
}

function Outcome({
  m,
  rosterSize,
  playersOut,
  playersIn,
  cashOut,
  cashIn,
}: {
  m: StateManager
  rosterSize: number
  playersOut: number
  playersIn: number
  cashOut: number
  cashIn: number
}) {
  const rostered = m.rostered - playersOut + playersIn
  const budget = m.budget - cashOut + cashIn
  const maxBid = rostered >= rosterSize ? 0 : budget - (rosterSize - rostered - 1)
  const changed = budget !== m.budget || rostered !== m.rostered

  return (
    <div className="rounded-lg bg-slate-900 p-2.5 text-xs">
      <div className="font-semibold" style={{ color: m.color }}>
        {m.displayName}
      </div>
      <div className={`mt-1 tabular-nums ${changed ? 'text-slate-200' : 'text-slate-500'}`}>
        ${budget} budget · {rostered}/{rosterSize} players · max bid ${maxBid}
      </div>
    </div>
  )
}
