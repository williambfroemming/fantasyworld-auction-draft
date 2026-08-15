'use client'

import { useMemo, useState } from 'react'
import { autoSlot, pickInRow, positionCounts, slotRows } from '@/lib/draft'
import type { Board, RosterPick } from '@/hooks/useDraft'
import type { DraftState, StateManager } from '@/server/draft-service'
import { PositionBadge } from './LotPanel'
import { MySpendSplit } from './MarketPanel'

type Tab = 'me' | 'budgets' | 'picks'

export function SidePanel({
  state,
  board,
  me,
}: {
  state: DraftState
  board: Board | null
  me: number | null
}) {
  const [tab, setTab] = useState<Tab>('me')

  const byManager = useMemo(() => {
    const map = new Map<number, RosterPick[]>()
    for (const m of state.managers) map.set(m.id, [])
    for (const p of board?.rosters ?? []) map.get(p.managerId)?.push(p)
    return map
  }, [board, state.managers])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="flex shrink-0 gap-1 border-b border-slate-800 p-2">
        {(
          [
            ['me', 'My Roster'],
            ['budgets', 'Budgets'],
            ['picks', 'Picks'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              tab === key ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'me' && <MyRoster picks={byManager.get(me ?? -1) ?? []} rosterSize={state.draft.rosterSize} />}
        {tab === 'budgets' && (
          <Budgets
            managers={state.managers}
            byManager={byManager}
            rosterSize={state.draft.rosterSize}
          />
        )}
        {tab === 'picks' && <PickLog board={board} managers={state.managers} />}
      </div>
    </div>
  )
}

/** One roster laid into the slot rows, plus extra bench rows if it needs them. */
function MyRoster({ picks, rosterSize }: { picks: RosterPick[]; rosterSize: number }) {
  const laid = autoSlot(
    picks.map((p) => ({ id: p.id, position: p.position, slotOverride: p.slotOverride })),
  )
  const { overflow } = laid
  // Skip the DEFENSE slot and your 16th player has nowhere to sit. Draw a bench
  // row for them rather than leaving a player you paid for off your own roster.
  const rows = slotRows(overflow.length)
  const byId = new Map(picks.map((p) => [p.id, p]))
  const counts = positionCounts(picks.map((p) => ({ id: p.id, position: p.position })))
  const spent = picks.reduce((s, p) => s + p.price, 0)

  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {['QB', 'RB', 'WR', 'TE', 'DEF', 'K'].map((pos) => (
          <span key={pos} className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
            {pos} <span className="font-bold text-slate-200">{counts[pos] ?? 0}</span>
          </span>
        ))}
        <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
          {picks.length}/{rosterSize} · ${spent}
        </span>
      </div>

      {/* Where your own money went. The league-wide comparison lives on /board,
          which has the width for a 10 x 4 matrix; this is the at-a-glance
          version for while you are bidding. */}
      <MySpendSplit picks={picks} />

      <table className="w-full text-sm">
        <tbody>
          {rows.map((slot, rowIndex) => {
            const entry = pickInRow(laid, rowIndex)
            const pick = entry ? byId.get(entry.id) : null
            return (
              <tr key={slot.key} className="border-b border-slate-800/60 last:border-0">
                <td className="w-24 py-1.5 pr-2 text-[11px] uppercase tracking-wide text-slate-500">
                  {slot.label}
                </td>
                <td className="py-1.5">
                  {pick ? (
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{pick.name}</span>
                      <span className="text-xs text-slate-500">{pick.team}</span>
                    </span>
                  ) : (
                    <span className="text-slate-700">—</span>
                  )}
                </td>
                <td className="w-12 py-1.5 text-right tabular-nums text-slate-400">
                  {pick ? `$${pick.price}` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {overflow.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {overflow.length === 1 ? 'An extra bench row is' : `${overflow.length} extra bench rows are`}{' '}
          shown — your roster does not fill every named slot.
        </p>
      )}
    </div>
  )
}

/**
 * What the rest of the room has left — "am I rich or poor, and is the market
 * about to inflate or crash?"
 *
 * Two numbers, deliberately, because they answer different questions and one
 * unlabelled "average" would be the least useful of the three candidates:
 *
 *   mean budget      — am I rich or poor relative to the field right now
 *   $ per open slot  — is the next twenty players about to go cheap or dear
 *
 * ⚠️ Both **exclude managers whose roster is full.** A manager at 16 cannot bid,
 * so their leftover money is dead and will never chase another player; folding it
 * into anything labelled "the room" overstates what is actually competing. This
 * is the same rule the nomination order already applies when it skips them.
 *
 * Derived at render, never stored — it is a number about budgets, so it lives
 * under the same rule as budget itself.
 */
function RoomMoney({ managers, rosterSize }: { managers: StateManager[]; rosterSize: number }) {
  const active = managers.filter((m) => m.rostered < rosterSize)
  if (active.length === 0) return null

  const money = active.reduce((s, m) => s + m.budget, 0)
  const openSlots = active.reduce((s, m) => s + (rosterSize - m.rostered), 0)
  const mean = Math.round(money / active.length)
  const perSlot = openSlots > 0 ? money / openSlots : 0
  const sidelined = managers.length - active.length

  return (
    <div className="border-b border-slate-800 bg-slate-900/80 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          The room{sidelined > 0 && ` · ${sidelined} full`}
        </span>
        <span className="text-[10px] text-slate-600">{active.length} still bidding</span>
      </div>
      <div className="mt-1 flex items-baseline gap-4">
        <span className="text-sm">
          <span className="font-bold tabular-nums text-slate-100">${mean}</span>{' '}
          <span className="text-[11px] text-slate-500">avg left</span>
        </span>
        <span className="text-sm">
          <span className="font-bold tabular-nums text-slate-100">${perSlot.toFixed(1)}</span>{' '}
          <span className="text-[11px] text-slate-500">per open slot</span>
        </span>
      </div>
    </div>
  )
}

function Budgets({
  managers,
  byManager,
  rosterSize,
}: {
  managers: StateManager[]
  byManager: Map<number, RosterPick[]>
  rosterSize: number
}) {
  return (
    <>
    <RoomMoney managers={managers} rosterSize={rosterSize} />
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
          <th className="px-3 py-2 text-left">Team</th>
          <th className="px-2 py-2 text-right">Budget</th>
          <th className="px-2 py-2 text-right">Max</th>
          <th className="px-2 py-2 text-right">Plyrs</th>
          <th className="px-3 py-2 text-right">Avg</th>
        </tr>
      </thead>
      <tbody>
        {managers.map((m) => {
          const picks = byManager.get(m.id) ?? []
          const spent = picks.reduce((s, p) => s + p.price, 0)
          return (
            <tr key={m.id} className="border-b border-slate-800/60">
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="h-3 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                  <span className="truncate font-medium">{m.displayName}</span>
                </span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums font-semibold">${m.budget}</td>
              <td
                className={`px-2 py-2 text-right tabular-nums ${
                  m.maxBid <= 0 ? 'text-slate-600' : 'text-emerald-400'
                }`}
              >
                ${m.maxBid}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-400">{m.rostered}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                ${picks.length ? Math.round(spent / picks.length) : 0}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
    </>
  )
}

function PickLog({ board, managers }: { board: Board | null; managers: StateManager[] }) {
  const byId = new Map(managers.map((m) => [m.id, m]))
  const picks = [...(board?.rosters ?? [])].sort((a, b) => b.pickNo - a.pickNo)
  if (picks.length === 0)
    return <p className="p-6 text-center text-sm text-slate-500">No picks yet.</p>

  return (
    <table className="w-full text-sm">
      <tbody>
        {picks.map((p) => {
          const m = byId.get(p.managerId)
          return (
            <tr key={p.id} className="border-b border-slate-800/60">
              <td className="w-8 px-2 py-1.5 text-right tabular-nums text-slate-600">{p.pickNo}</td>
              <td className="px-1 py-1.5">
                <PositionBadge position={p.position} />
              </td>
              <td className="px-2 py-1.5 truncate font-medium">{p.name}</td>
              <td className="px-2 py-1.5 truncate text-xs" style={{ color: m?.color }}>
                {m?.displayName}
              </td>
              <td className="w-12 px-3 py-1.5 text-right tabular-nums font-semibold">${p.price}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
