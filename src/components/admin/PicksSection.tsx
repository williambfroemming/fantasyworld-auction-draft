'use client'

import { useMemo, useState } from 'react'
import type { Board, RosterPick } from '@/hooks/useDraft'
import type { DraftState } from '@/server/draft-service'
import { Btn, NumberField, Section, type Act } from './ui'

/**
 * Fix any pick in the current season, and record a sale the nomination order
 * would not let the room enter.
 *
 * The drawer this replaces could only touch the last pick, but `editPrice` and
 * `reassignPick` always accepted any current-season pick: the limit was the UI.
 * Both still refuse anything that would strand a manager below $1 per empty
 * slot, and both refuse an archived season — that check is in the service, not
 * here.
 *
 * Reassign is not offered on a traded player. Reassign moves the salary with
 * the player (it fixes a mis-award); a trade deliberately leaves the salary with
 * the drafter. The service refuses it too — this just doesn't draw the button.
 */
export function PicksSection({
  state,
  board,
  act,
  busy,
}: {
  state: DraftState
  board: Board | null
  act: Act
  busy: boolean
}) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<number | null>(null)

  const traded = useMemo(
    () => new Set((board?.trades ?? []).flatMap((t) => t.players.map((p) => p.pickId))),
    [board?.trades],
  )
  const names = useMemo(() => new Map(state.managers.map((m) => [m.id, m.displayName])), [state.managers])

  const picks = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return [...(board?.rosters ?? [])]
      .sort((a, b) => b.pickNo - a.pickNo)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (names.get(p.managerId) ?? '').toLowerCase().includes(q) ||
          String(p.pickNo) === q,
      )
  }, [board?.rosters, filter, names])

  return (
    <Section
      id="picks"
      title={`Picks — ${state.draft.season}`}
      note="Fix a mistyped price or a player awarded to the wrong person. Budgets recalculate on their own — they are derived, never stored."
    >
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by player, manager or pick #"
        className="w-full rounded-lg border border-rule bg-slate-950 px-3 py-2 text-sm"
      />

      <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-rule">
        {picks.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            {board?.rosters.length ? 'No picks match.' : 'No picks yet this season.'}
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {picks.map((p) => (
              <li key={p.id} className="px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-8 shrink-0 text-right tabular-nums text-slate-500">#{p.pickNo}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-slate-100">{p.name}</span>
                    <span className="ml-1.5 text-xs text-slate-500">{p.position}</span>
                    <span className="ml-2 text-slate-400">→ {names.get(p.managerId) ?? '?'}</span>
                    {traded.has(p.id) && (
                      <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                        traded
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-200">${p.price}</span>
                  <Btn size="sm" tone="ghost" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                    {editing === p.id ? 'Close' : 'Edit'}
                  </Btn>
                </div>
                {editing === p.id && (
                  <PickEditor
                    pick={p}
                    state={state}
                    traded={traded.has(p.id)}
                    act={act}
                    busy={busy}
                    onDone={() => setEditing(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <RecordSale state={state} board={board} act={act} busy={busy} />
    </Section>
  )
}

function PickEditor({
  pick,
  state,
  traded,
  act,
  busy,
  onDone,
}: {
  pick: RosterPick
  state: DraftState
  traded: boolean
  act: Act
  busy: boolean
  onDone: () => void
}) {
  const [price, setPrice] = useState(String(pick.price))
  const [managerId, setManagerId] = useState(String(pick.managerId))

  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-slate-950/60 p-3 sm:grid-cols-2">
      <div className="flex items-end gap-2">
        <NumberField label="Price ($)" value={price} onChange={setPrice} />
        <Btn
          disabled={busy || !price || Number(price) === pick.price}
          onClick={async () => {
            const r = await act(
              { action: 'editPrice', pickId: pick.id, price: Number(price) },
              `${pick.name} is now $${price}.`,
            )
            if (r?.ok) onDone()
          }}
        >
          Set price
        </Btn>
      </div>
      {traded ? (
        <p className="self-end text-xs text-slate-500">
          Traded, so it cannot be reassigned — the salary stays with the drafter. Reverse the trade to move it.
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <label className="block flex-1 text-xs text-slate-400">
            Owner
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-rule bg-slate-950 px-2 py-2.5 text-sm text-slate-100"
            >
              {state.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
          <Btn
            disabled={busy || Number(managerId) === pick.managerId}
            onClick={async () => {
              const to = state.managers.find((m) => m.id === Number(managerId))?.displayName
              const r = await act(
                { action: 'reassignPick', pickId: pick.id, managerId: Number(managerId) },
                `${pick.name} now belongs to ${to}.`,
                `Give ${pick.name} ($${pick.price}) to ${to}? The $${pick.price} moves with him — this fixes a mis-award, it is not a trade.`,
              )
              if (r?.ok) onDone()
            }}
          >
            Reassign
          </Btn>
        </div>
      )}
    </div>
  )
}

/**
 * The in-app `npm run draft:record`. Bypasses whose turn it is and nothing else:
 * the max-bid check still runs inside the database.
 */
function RecordSale({
  state,
  board,
  act,
  busy,
}: {
  state: DraftState
  board: Board | null
  act: Act
  busy: boolean
}) {
  const [q, setQ] = useState('')
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [managerId, setManagerId] = useState('')
  const [price, setPrice] = useState('1')

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2 || playerId) return []
    return (board?.pool ?? []).filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 8)
  }, [q, board?.pool, playerId])

  const player = board?.pool.find((p) => p.id === playerId) ?? null
  const buyer = state.managers.find((m) => m.id === Number(managerId))
  const notStarted = state.draft.status === 'setup'

  return (
    <div className="mt-5 border-t border-rule pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Record a sale</h3>
      <p className="mb-3 mt-1 text-xs text-slate-500">
        For a player bought in the room that couldn&apos;t be entered the normal way. Skips the nomination order
        and does not move it; the buyer is recorded as the nominator.
        {notStarted && ' Start the draft first.'}
      </p>

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_6rem]">
        <div className="relative">
          <label className="block text-xs text-slate-400">
            Player
            <input
              value={player ? `${player.name} (${player.position}${player.team ? ' ' + player.team : ''})` : q}
              onChange={(e) => {
                setPlayerId(null)
                setQ(e.target.value)
              }}
              placeholder="Search the pool"
              className="mt-1 w-full rounded-lg border border-rule bg-slate-950 px-3 py-2.5 text-sm text-slate-100"
            />
          </label>
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-rule-strong bg-slate-900 shadow-lg">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerId(p.id)
                      setQ('')
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-800"
                  >
                    {p.name} <span className="text-xs text-slate-500">{p.position} {p.team}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="block text-xs text-slate-400">
          Bought by
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-rule bg-slate-950 px-2 py-2.5 text-sm text-slate-100"
          >
            <option value="">Choose…</option>
            {state.managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} (max ${m.maxBid})
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Price ($)" value={price} onChange={setPrice} />
      </div>
      <Btn
        tone="primary"
        className="mt-3"
        disabled={busy || notStarted || !player || !buyer || !price}
        onClick={async () => {
          if (!player || !buyer) return
          const r = await act(
            { action: 'recordSale', playerId: player.id, managerId: buyer.id, price: Number(price) },
            (d) => `Recorded: ${player.name} to ${buyer.displayName} for $${price} (pick #${(d as { pickNo: number }).pickNo}).`,
            `Record ${player.name} to ${buyer.displayName} for $${price}?`,
          )
          if (r?.ok) {
            setPlayerId(null)
            setPrice('1')
          }
        }}
      >
        Record sale
      </Btn>
    </div>
  )
}
