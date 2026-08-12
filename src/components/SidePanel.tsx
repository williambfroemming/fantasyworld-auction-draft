'use client'

import { useMemo, useState } from 'react'
import { SLOTS, autoSlot, positionCounts } from '@/lib/draft'
import type { Board, RosterPick } from '@/hooks/useDraft'
import type { DraftState, StateManager } from '@/server/draft-service'
import { PositionBadge } from './LotPanel'

type Tab = 'me' | 'league' | 'budgets' | 'picks'

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
            ['league', 'League'],
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
        {tab === 'league' && <LeagueBoard managers={state.managers} byManager={byManager} />}
        {tab === 'budgets' && <Budgets managers={state.managers} byManager={byManager} />}
        {tab === 'picks' && <PickLog board={board} managers={state.managers} />}
      </div>
    </div>
  )
}

/** One roster laid into the 16 slot rows. */
function MyRoster({ picks, rosterSize }: { picks: RosterPick[]; rosterSize: number }) {
  const { slots, overflow } = autoSlot(
    picks.map((p) => ({ id: p.id, position: p.position, slotOverride: p.slotOverride })),
  )
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

      <table className="w-full text-sm">
        <tbody>
          {SLOTS.map((slot) => {
            const pick = slots[slot.key] ? byId.get(slots[slot.key]!.id) : null
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
        <p className="mt-2 text-xs text-amber-400">
          {overflow.length} extra player{overflow.length > 1 ? 's' : ''} beyond the 16 slots.
        </p>
      )}
    </div>
  )
}

/**
 * The grid: 16 slot rows x 10 manager columns, mirroring the league's old
 * spreadsheet. Slot labels stay pinned while the columns scroll sideways.
 */
function LeagueBoard({
  managers,
  byManager,
}: {
  managers: StateManager[]
  byManager: Map<number, RosterPick[]>
}) {
  const laid = useMemo(() => {
    const map = new Map<number, ReturnType<typeof autoSlot>>()
    for (const m of managers) {
      const picks = byManager.get(m.id) ?? []
      map.set(
        m.id,
        autoSlot(picks.map((p) => ({ id: p.id, position: p.position, slotOverride: p.slotOverride }))),
      )
    }
    return map
  }, [managers, byManager])

  const nameById = useMemo(() => {
    const m = new Map<number, RosterPick>()
    for (const list of byManager.values()) for (const p of list) m.set(p.id, p)
    return m
  }, [byManager])

  return (
    <div className="overflow-auto">
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 border-b border-r border-slate-800 bg-slate-900 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">
              Slot
            </th>
            {managers.map((m) => (
              <th
                key={m.id}
                className="sticky top-0 z-10 border-b border-slate-800 px-2 py-2 text-left font-semibold"
                style={{ backgroundColor: m.color, color: '#fff', minWidth: '8.5rem' }}
              >
                {m.displayName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot) => (
            <tr key={slot.key}>
              <td className="sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-900 px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                {slot.label}
              </td>
              {managers.map((m) => {
                const entry = laid.get(m.id)?.slots[slot.key]
                const pick = entry ? nameById.get(entry.id) : null
                return (
                  <td
                    key={m.id}
                    className="border-b border-slate-800/60 px-2 py-1.5"
                    style={{ backgroundColor: pick ? `${m.color}1a` : undefined }}
                  >
                    {pick ? (
                      <span className="flex items-baseline justify-between gap-1">
                        <span className="truncate">{pick.name}</span>
                        <span className="shrink-0 tabular-nums text-slate-500">${pick.price}</span>
                      </span>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Budgets({
  managers,
  byManager,
}: {
  managers: StateManager[]
  byManager: Map<number, RosterPick[]>
}) {
  return (
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
