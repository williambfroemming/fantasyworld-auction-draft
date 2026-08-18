'use client'

import { useMemo, useState } from 'react'
import { autoSlot, pickInRow, positionCounts, slotRows } from '@/lib/draft'
import { perSlotLeft, spendColumnFor, type SpendColumn } from '@/lib/stats'
import type { Board, RosterPick } from '@/hooks/useDraft'
import type { DraftState, StateManager } from '@/server/draft-service'
import { PositionBadge } from './LotPanel'

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
    <div className="rule-strong flex h-full min-h-0 flex-col rounded-2xl border border-rule bg-slate-900/60">
      <div className="flex shrink-0 gap-1 border-b border-rule p-2">
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
        {tab === 'me' && (
          <MyRoster
            picks={byManager.get(me ?? -1) ?? []}
            rosterSize={state.draft.rosterSize}
            budget={state.managers.find((m) => m.id === me)?.budget ?? 0}
          />
        )}
        {tab === 'budgets' && (
          <Budgets
            managers={state.managers}
            rosterSize={state.draft.rosterSize}
            byManager={byManager}
          />
        )}
        {tab === 'picks' && <PickLog board={board} managers={state.managers} />}
      </div>
    </div>
  )
}

/** One roster laid into the slot rows, plus extra bench rows if it needs them. */
function MyRoster({
  picks,
  rosterSize,
  budget,
}: {
  picks: RosterPick[]
  rosterSize: number
  budget: number
}) {
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

  // Count AND dollars on one chip per position. Previously these were two
  // separate rows of near-identical chips — "QB 3" above "QB $63" — which read
  // as the same thing twice, and the totals chip was shoved onto a third line
  // by `ml-auto` as soon as it wrapped.
  const spendByPos = picks.reduce<Record<string, number>>((acc, p) => {
    acc[p.position] = (acc[p.position] ?? 0) + p.price
    return acc
  }, {})

  return (
    <div className="p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-rule pb-2">
        <span className="text-sm">
          <span className="font-bold tabular-nums text-slate-100">
            {picks.length}
            <span className="text-slate-500">/{rosterSize}</span>
          </span>{' '}
          <span className="text-[11px] uppercase tracking-wider text-slate-500">players</span>
        </span>
        <span className="text-sm tabular-nums">
          <span className="font-bold text-slate-100">${spent}</span>{' '}
          <span className="text-[11px] uppercase tracking-wider text-slate-500">spent</span>
          <span className="mx-1.5 text-slate-700">·</span>
          <span className="font-bold text-emerald-400">${budget}</span>{' '}
          <span className="text-[11px] uppercase tracking-wider text-slate-500">left</span>
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {['QB', 'RB', 'WR', 'TE', 'DEF', 'K'].map((pos) => {
          const n = counts[pos] ?? 0
          return (
            <span
              key={pos}
              className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
                n === 0 ? 'bg-slate-800/50 text-slate-600' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {pos} <span className={n === 0 ? '' : 'font-bold text-slate-200'}>{n}</span>
              {n > 0 && <span className="text-slate-500"> · ${spendByPos[pos] ?? 0}</span>}
            </span>
          )
        })}
      </div>

      <table className="w-full text-sm">
        <tbody>
          {rows.map((slot, rowIndex) => {
            const entry = pickInRow(laid, rowIndex)
            const pick = entry ? byId.get(entry.id) : null
            return (
              <tr key={slot.key} className="border-b border-rule/60 last:border-0">
                {/* Narrow enough that the name sits next to its slot instead of
                    across a gap — SUPERFLEX is the longest label and still fits. */}
                <td className="w-[4.5rem] py-1.5 pr-1 align-middle text-[10px] uppercase tracking-wide text-slate-600">
                  {slot.label}
                </td>
                <td className="py-1.5">
                  {pick ? (
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate font-medium">{pick.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-500">{pick.team}</span>
                    </span>
                  ) : (
                    <span className="text-slate-700">—</span>
                  )}
                </td>
                <td className="w-10 py-1.5 text-right tabular-nums text-slate-400">
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
    <div className="border-b border-rule bg-slate-900/80 px-3 py-2">
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

/**
 * Where each manager's money has gone, as one thin stacked bar per row.
 *
 * Backlog §7 wanted a per-manager positional split on the draft screen and
 * warned — correctly — that the 10 x 4 matrix from /stats does not fit a 19rem
 * sidebar; step 20 clipped a column off the Budgets table just by adding a
 * sixth. A stacked bar is the compact encoding for a four-way split: it costs no
 * columns at all, riding under the row it belongs to, and answers the only
 * question worth asking mid-draft — "is he loading up on running backs?" —
 * without a single number.
 *
 * Proportion, not magnitude. Each bar fills its own width, so it says how a
 * manager split their money, not how much they spent; the $ columns above
 * already answer that, and scaling these to a league-wide peak would make the
 * early-draft bars invisible slivers.
 */
const SPLIT_SEGMENTS: Array<{ key: SpendColumn; label: string; hex: string }> = [
  // ⚠️ Not in SPEND_COLUMNS order, deliberately. Rose (QB) against emerald (RB)
  // is ΔE 4.6 under deuteranopia — indistinguishable for the ~1 in 12 men with
  // it, and a bar has no room for the labels that make PositionBadge safe.
  // Interleaving them costs nothing and lifts the worst adjacent pair to 10.6.
  // Same trick, same reason as SEAT_ORDER in src/lib/colors.ts.
  { key: 'WR', label: 'WR', hex: '#38bdf8' },
  { key: 'QB', label: 'QB', hex: '#fb7185' },
  { key: 'TE', label: 'TE', hex: '#fbbf24' },
  { key: 'RB', label: 'RB', hex: '#34d399' },
  // Grey on purpose: K and DEF are the residue, and a residual bucket reading as
  // "not a real category" is the correct signal, not a palette failure.
  { key: 'OTHER', label: 'K/DEF', hex: '#64748b' },
]

function SpendSplit({ picks }: { picks: RosterPick[] }) {
  const spent = picks.reduce((s, p) => s + p.price, 0)
  if (spent === 0) return <div className="h-1" />

  const by = picks.reduce<Partial<Record<SpendColumn, number>>>((acc, p) => {
    const k = spendColumnFor(p.position)
    acc[k] = (acc[k] ?? 0) + p.price
    return acc
  }, {})

  return (
    <div className="flex h-1 gap-px overflow-hidden rounded-full">
      {SPLIT_SEGMENTS.map(({ key, label, hex }) => {
        const v = by[key] ?? 0
        if (v === 0) return null
        return (
          <span
            key={key}
            className="h-full"
            style={{ width: `${(v / spent) * 100}%`, backgroundColor: hex }}
            title={`${label} $${v} — ${Math.round((v / spent) * 100)}% of $${spent}`}
          />
        )
      })}
    </div>
  )
}

function Budgets({
  managers,
  rosterSize,
  byManager,
}: {
  managers: StateManager[]
  rosterSize: number
  byManager: Map<number, RosterPick[]>
}) {
  return (
    <>
    <RoomMoney managers={managers} rosterSize={rosterSize} />
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
          <th className="px-2 py-2 text-left">Team</th>
          <th className="px-2 py-2 text-right">Budget</th>
          <th className="px-2 py-2 text-right">Max</th>
          {/* What they can average on every spot they still have to fill —
              the number that says whether someone can actually compete for the
              next player or is about to be filling slots at a dollar. */}
          <th className="px-2 py-2 text-right" title="Budget divided by roster spots still to fill">
            $/slot
          </th>
          <th className="pl-1 pr-2 py-2 text-right">Plyrs</th>
        </tr>
      </thead>
      <tbody>
        {managers.map((m) => {
          const full = m.rostered >= rosterSize
          const perSlot = perSlotLeft(m.budget, m.rostered, rosterSize)
          return (
            <tr key={m.id} className="border-b border-rule/60">
              <td className="px-2 py-2">
                <span className="flex items-center gap-2">
                  <span className="h-3 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                  <span className="truncate font-medium">{m.displayName}</span>
                </span>
                {/* Rides under the name rather than taking a sixth column,
                    which does not fit — see SpendSplit. */}
                <SpendSplit picks={byManager.get(m.id) ?? []} />
              </td>
              <td className="px-2 py-2 text-right tabular-nums font-semibold">${m.budget}</td>
              <td
                className={`px-2 py-2 text-right tabular-nums ${
                  m.maxBid <= 0 ? 'text-slate-600' : 'text-emerald-400'
                }`}
              >
                ${m.maxBid}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {full ? (
                  <span className="text-slate-700">—</span>
                ) : (
                  <span className="font-semibold text-slate-200">${perSlot.toFixed(1)}</span>
                )}
              </td>
              <td className="py-2 pl-1 pr-2 text-right tabular-nums text-slate-400">{m.rostered}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pb-2 pt-1 text-[10px] text-slate-500">
      <span className="uppercase tracking-wider">Spend split</span>
      {SPLIT_SEGMENTS.map(({ key, label, hex }) => (
        <span key={key} className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hex }} aria-hidden />
          {label}
        </span>
      ))}
    </div>
    </>
  )
}

const PICK_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'] as const
type SortKey = 'pickNo' | 'price' | 'name'

function SortArrow({ active, desc }: { active: boolean; desc: boolean }) {
  if (!active) return null
  return <span className="text-slate-400">{desc ? '↓' : '↑'}</span>
}

/**
 * Every pick made, filterable by position and sortable.
 *
 * Defaults to newest first, which is what it was before and what you want while
 * the draft is running. The filters turn it into "what have the RBs gone for" —
 * the same question /stats answers league-wide, asked about individual players.
 */
function PickLog({ board, managers }: { board: Board | null; managers: StateManager[] }) {
  const [filter, setFilter] = useState<(typeof PICK_FILTERS)[number]>('ALL')
  const [sort, setSort] = useState<SortKey>('pickNo')
  const [desc, setDesc] = useState(true)

  const byId = useMemo(() => new Map(managers.map((m) => [m.id, m])), [managers])

  const picks = useMemo(() => {
    const rows = (board?.rosters ?? []).filter((p) =>
      filter === 'ALL' ? true : p.position === filter,
    )
    const dir = desc ? -1 : 1
    return [...rows].sort((a, b) => {
      if (sort === 'name') return dir * a.name.localeCompare(b.name)
      if (sort === 'price') {
        // Ties on price are common ($1 fills); fall back to pick order so the
        // list never reshuffles arbitrarily between polls.
        return dir * (a.price - b.price) || b.pickNo - a.pickNo
      }
      return dir * (a.pickNo - b.pickNo)
    })
  }, [board, filter, sort, desc])

  /** Clicking the active column flips direction; a new column starts sensibly. */
  const sortBy = (key: SortKey) => {
    if (key === sort) return setDesc((d) => !d)
    setSort(key)
    setDesc(key !== 'name') // A-Z reads better ascending; numbers, biggest first
  }

  const all = board?.rosters ?? []

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-rule bg-slate-900 px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {PICK_FILTERS.map((f) => {
            const n = f === 'ALL' ? all.length : all.filter((p) => p.position === f).length
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                disabled={n === 0 && f !== 'ALL'}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                  filter === f
                    ? 'bg-slate-100 text-slate-900'
                    : n === 0
                      ? 'bg-slate-800/40 text-slate-700'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {f} <span className="tabular-nums opacity-60">{n}</span>
              </button>
            )
          })}
        </div>
      </div>

      {picks.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">
          {all.length === 0 ? 'No picks yet.' : `No ${filter} picks yet.`}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
              <th className="w-10 cursor-pointer px-2 py-1.5 text-right hover:text-slate-300">
                <button onClick={() => sortBy('pickNo')}>
                  # <SortArrow active={sort === 'pickNo'} desc={desc} />
                </button>
              </th>
              <th className="cursor-pointer px-2 py-1.5 text-left hover:text-slate-300" colSpan={2}>
                <button onClick={() => sortBy('name')}>
                  Player <SortArrow active={sort === 'name'} desc={desc} />
                </button>
              </th>
              <th className="w-16 px-1 py-1.5 text-left">By</th>
              <th className="w-14 cursor-pointer px-3 py-1.5 text-right hover:text-slate-300">
                <button onClick={() => sortBy('price')}>
                  $ <SortArrow active={sort === 'price'} desc={desc} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => {
              const m = byId.get(p.managerId)
              return (
                <tr key={p.id} className="border-b border-rule/60">
                  <td className="w-10 px-2 py-1.5 text-right tabular-nums text-slate-600">
                    {p.pickNo}
                  </td>
                  <td className="w-8 px-1 py-1.5">
                    <PositionBadge position={p.position} />
                  </td>
                  {/* `w-full max-w-0` is the pair that makes ONE cell absorb the
                      leftover width and truncate. Putting it on two competing
                      cells collapses both — the player name shrank to a single
                      character. The manager column is fixed instead. */}
                  <td className="w-full max-w-0 truncate px-2 py-1.5 font-medium">{p.name}</td>
                  {/* Fixed width, and NO max-w-0 — that pairing belongs to the
                      one greedy column above; here it would collapse the cell. */}
                  <td className="w-16 truncate px-1 py-1.5 text-[11px]" style={{ color: m?.color }}>
                    {m?.displayName}
                  </td>
                  <td className="w-14 px-3 py-1.5 text-right tabular-nums font-semibold">
                    ${p.price}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
