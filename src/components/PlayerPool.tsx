'use client'

import { useMemo, useState } from 'react'
import type { BoardPlayer } from '@/hooks/useDraft'
import type { QueuedPlayer } from '@/server/queue-service'
import { PositionBadge } from './LotPanel'

const FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'] as const
type Filter = (typeof FILTERS)[number] | 'QUEUE'

/**
 * The undrafted pool.
 *
 * Leads with position filters and search rather than a plain ranked scroll:
 * the pool is ~500 players, and Sleeper-sourced pools are ~3,200 with defenses
 * unranked at the bottom. Filtering is how anyone actually finds a player.
 *
 * ## The click collision, and how the star resolves it
 *
 * A row click means "select for nomination", and rows are disabled when it isn't
 * your turn — which is *precisely* when someone wants to build a queue. So the
 * star cannot reuse the row gesture. It is its own button, a sibling rather than
 * a child of the row (a button cannot nest inside a button anyway), and it stays
 * live while the row is disabled. See docs/BACKLOG.md §4.
 */
export function PlayerPool({
  pool,
  canNominate,
  disabledReason,
  onNominate,
  queue,
  onToggleQueue,
  onPruneQueue,
}: {
  pool: BoardPlayer[]
  canNominate: boolean
  /** Why nomination is unavailable. Shown at the top of the list — never leave
   *  someone staring at a dead button with no explanation mid-draft. */
  disabledReason?: string | null
  onNominate: (player: BoardPlayer) => Promise<string | null>
  queue: QueuedPlayer[]
  onToggleQueue: (playerId: string, queued: boolean) => Promise<string | null>
  onPruneQueue: () => Promise<string | null>
}) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BoardPlayer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const queuedIds = useMemo(() => new Set(queue.map((q) => q.playerId)), [queue])
  const takenTargets = useMemo(() => queue.filter((q) => q.drafted), [queue])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (p: { name: string; team: string | null }) =>
      q ? p.name.toLowerCase().includes(q) || (p.team ?? '').toLowerCase().includes(q) : true

    if (filter === 'QUEUE') {
      // The queue view shows queued players in queue order, including the ones
      // already bought — struck through rather than silently vanished.
      return queue.filter(matches).map((entry) => ({
        id: entry.playerId,
        name: entry.name,
        team: entry.team,
        position: entry.position,
        rank: entry.rank,
        posRank: null,
        byeWeek: entry.byeWeek,
        gone: entry.drafted,
      }))
    }
    return pool
      .filter((p) => (filter === 'ALL' ? true : p.position === filter))
      .filter(matches)
      .slice(0, 300)
      .map((p) => ({ ...p, gone: false }))
  }, [pool, queue, filter, query])

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
          <button
            onClick={() => setFilter('QUEUE')}
            title="Your private shortlist — nobody else can see it"
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              filter === 'QUEUE'
                ? 'bg-amber-300 text-slate-900'
                : 'bg-slate-800 text-amber-300/80 hover:bg-slate-700'
            }`}
          >
            ★ {queue.length}
          </button>
          <span className="ml-auto self-center text-xs text-slate-600">{visible.length}</span>
        </div>
      </div>

      {!canNominate && disabledReason && (
        <div className="border-b border-slate-800 bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
          {disabledReason}
        </div>
      )}

      {/* Say it, don't just shrink. A queue that quietly empties itself reads as
          a bug; naming the loss is the difference between "the app ate my list"
          and "I got outbid on two guys". */}
      {takenTargets.length > 0 && (
        <div className="flex items-center gap-2 border-b border-slate-800 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
          <span className="min-w-0 flex-1">
            {takenTargets.length} of your targets{' '}
            {takenTargets.length === 1 ? 'was' : 'were'} drafted
            {takenTargets.length <= 3 && (
              <span className="text-amber-200/60">
                {' '}
                — {takenTargets.map((t) => t.name).join(', ')}
              </span>
            )}
          </span>
          <button
            onClick={() => onPruneQueue()}
            className="shrink-0 rounded bg-amber-400/20 px-2 py-0.5 font-semibold hover:bg-amber-400/30"
          >
            Clear
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">
            {filter === 'QUEUE'
              ? 'No players queued. Tap ☆ on anyone you are targeting — only you can see it.'
              : 'No players match.'}
          </p>
        )}
        {/* Deliberately no tiers and no auction values. Both are one source's
            opinion, and managers bring their own — the board shows facts
            (rank, team, bye) and lets people apply their own judgement. */}
        {visible.map((p) => {
          const queued = queuedIds.has(p.id)
          return (
            <div
              key={p.id}
              className={`flex w-full items-center transition ${
                selected?.id === p.id ? 'bg-emerald-600/20' : 'hover:bg-slate-800/60'
              }`}
            >
              <button
                onClick={() => {
                  setSelected(p)
                  setError(null)
                }}
                disabled={!canNominate || p.gone}
                className={`flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left ${
                  canNominate && !p.gone ? '' : 'cursor-default opacity-70'
                }`}
              >
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-600">
                  {p.rank ?? '—'}
                </span>
                <PositionBadge position={p.position} />
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-medium ${
                    p.gone ? 'text-slate-600 line-through' : ''
                  }`}
                >
                  {p.name}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {p.team ?? 'FA'}
                  {p.byeWeek ? ` ·${p.byeWeek}` : ''}
                </span>
              </button>

              {/* Its own control, always live — the value of a queue is highest
                  exactly when it is not your turn and the row is disabled. */}
              <button
                onClick={() => onToggleQueue(p.id, queued)}
                title={queued ? 'Remove from your queue' : 'Add to your private queue'}
                aria-label={queued ? `Remove ${p.name} from your queue` : `Queue ${p.name}`}
                aria-pressed={queued}
                className={`shrink-0 px-2.5 py-2 text-sm transition ${
                  queued ? 'text-amber-300 hover:text-amber-200' : 'text-slate-700 hover:text-amber-300'
                }`}
              >
                {queued ? '★' : '☆'}
              </button>
            </div>
          )
        })}
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
