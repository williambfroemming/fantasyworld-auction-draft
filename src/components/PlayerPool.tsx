'use client'

import { useMemo, useState } from 'react'
import type { BoardPlayer } from '@/hooks/useDraft'
import { PositionBadge } from './LotPanel'

const FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'] as const

/**
 * The undrafted pool.
 *
 * Leads with position filters and search rather than a plain ranked scroll:
 * the pool is ~500 players, and Sleeper-sourced pools are ~3,200 with defenses
 * unranked at the bottom. Filtering is how anyone actually finds a player.
 */
export function PlayerPool({
  pool,
  canNominate,
  disabledReason,
  onNominate,
}: {
  pool: BoardPlayer[]
  canNominate: boolean
  /** Why nomination is unavailable. Shown at the top of the list — never leave
   *  someone staring at a dead button with no explanation mid-draft. */
  disabledReason?: string | null
  onNominate: (player: BoardPlayer) => Promise<string | null>
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BoardPlayer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pool
      .filter((p) => (filter === 'ALL' ? true : p.position === filter))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || (p.team ?? '').toLowerCase().includes(q) : true))
      .slice(0, 300)
  }, [pool, filter, query])

  async function nominate() {
    if (!selected) return
    setPending(true)
    setError(null)
    const reason = await onNominate(selected)
    setPending(false)
    if (reason) setError(reason)
    else {
      setSelected(null)
      setQuery('')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                filter === f
                  ? 'bg-slate-100 text-slate-900'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-slate-600">{visible.length}</span>
        </div>
      </div>

      {!canNominate && disabledReason && (
        <div className="border-b border-slate-800 bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
          {disabledReason}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">No players match.</p>
        )}
        {/* Deliberately no tiers and no auction values. Both are one source's
            opinion, and managers bring their own — the board shows facts
            (rank, team, bye) and lets people apply their own judgement. */}
        {visible.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSelected(p)
              setError(null)
            }}
            disabled={!canNominate}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${
              selected?.id === p.id ? 'bg-emerald-600/20' : 'hover:bg-slate-800/60'
            } ${canNominate ? '' : 'cursor-default opacity-70'}`}
          >
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-600">
              {p.rank ?? '—'}
            </span>
            <PositionBadge position={p.position} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
            <span className="shrink-0 text-xs text-slate-500">
              {p.team ?? 'FA'}
              {p.byeWeek ? ` ·${p.byeWeek}` : ''}
            </span>
          </button>
        ))}
      </div>

      {/* Nomination tray */}
      {selected && canNominate && (
        <div className="border-t border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center gap-2">
            <PositionBadge position={selected.position} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.name}</span>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              cancel
            </button>
          </div>
          {/* No opening bid. The room opens the bidding out loud; the app only
              needs to know which player everyone is looking at. */}
          <button
            onClick={nominate}
            disabled={pending}
            className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending ? 'Nominating…' : 'Put up for auction'}
          </button>
          {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  )
}
