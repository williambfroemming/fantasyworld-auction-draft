'use client'

import { useMemo, useState } from 'react'
import type { BoardPlayer } from '@/hooks/useDraft'
import type { QueuedPlayer } from '@/server/queue-service'
import { PositionBadge } from './LotPanel'
import { InjuryBadge } from './InjuryBadge'
import { PlayerDrawer } from './PlayerDrawer'

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
  onReorderQueue,
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
  onReorderQueue: (from: number, to: number) => Promise<string | null>
}) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BoardPlayer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // §1's click collision, solved the same way §4 solved it: a sibling button,
  // live even when the row is disabled — which is exactly when you want to read
  // about somebody.
  const [detail, setDetail] = useState<BoardPlayer | null>(null)

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
        injury: entry.injury,
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

  /**
   * Nominate straight from the queue — the payoff §4 was built for.
   *
   * Skips the select-then-confirm tray, because in the queue view the list *is*
   * the shortlist: you put these players there yourself, on purpose, and the
   * whole point is not fumbling through a 500-row pool with nine people
   * watching. It stays a distinct labelled button rather than making the row
   * itself one-tap — a mis-click that puts the wrong player on the block in
   * front of the room needs the commissioner to void it.
   */
  async function nominateNow(p: BoardPlayer) {
    setPending(true)
    setError(null)
    const reason = await onNominate(p)
    setPending(false)
    if (reason) setError(reason)
    else setSelected(null)
  }

  // Drag state is tracked by index into the *queue*, which is only the visible
  // list when the queue filter is on and nothing is being searched. Reordering
  // a filtered subset would move entries relative to rows that are not on
  // screen, so dragging is offered only when what you see is the whole list.
  const canDrag = filter === 'QUEUE' && query.trim() === ''

  async function dropAt(to: number) {
    const from = dragFrom
    setDragFrom(null)
    setDragOver(null)
    if (from === null || from === to) return
    const reason = await onReorderQueue(from, to)
    if (reason) setError(reason)
  }

  return (
    <div className="rule-strong flex h-full min-h-0 flex-col rounded-2xl border border-rule bg-slate-900/60">
      <div className="border-b border-rule p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players…"
          className="w-full rounded-lg border border-rule bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
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
        <div className="border-b border-rule bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
          {disabledReason}
        </div>
      )}

      {/* Say it, don't just shrink. A queue that quietly empties itself reads as
          a bug; naming the loss is the difference between "the app ate my list"
          and "I got outbid on two guys". */}
      {takenTargets.length > 0 && (
        <div className="flex items-center gap-2 border-b border-rule bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
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
        {canDrag && visible.length > 1 && (
          <p className="px-3 py-1.5 text-[11px] text-slate-600">
            Drag ⠿ to reorder — your order, nobody else sees it.
          </p>
        )}
        {/* Deliberately no tiers and no auction values. Both are one source's
            opinion, and managers bring their own — the board shows facts
            (rank, team, bye) and lets people apply their own judgement. */}
        {visible.map((p, index) => {
          const queued = queuedIds.has(p.id)
          return (
            <div
              key={p.id}
              draggable={canDrag}
              onDragStart={() => canDrag && setDragFrom(index)}
              onDragOver={(e) => {
                if (!canDrag || dragFrom === null) return
                // Without preventDefault the browser refuses the drop outright.
                e.preventDefault()
                setDragOver(index)
              }}
              onDrop={(e) => {
                if (!canDrag) return
                e.preventDefault()
                void dropAt(index)
              }}
              onDragEnd={() => {
                setDragFrom(null)
                setDragOver(null)
              }}
              className={`flex w-full items-center transition ${
                selected?.id === p.id ? 'bg-emerald-600/20' : 'hover:bg-slate-800/60'
              } ${dragFrom === index ? 'opacity-40' : ''} ${
                dragOver === index && dragFrom !== index
                  ? 'border-t-2 border-amber-300'
                  : 'border-t-2 border-transparent'
              }`}
            >
              {canDrag && (
                <span
                  aria-hidden
                  title="Drag to reorder your queue"
                  className="cursor-grab select-none pl-2 text-xs text-slate-600 active:cursor-grabbing"
                >
                  ⠿
                </span>
              )}
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
                <InjuryBadge injury={p.injury} />
                <span className="shrink-0 text-xs text-slate-500">
                  {p.team ?? 'FA'}
                  {p.byeWeek ? ` ·${p.byeWeek}` : ''}
                </span>
              </button>

              {/* One tap from the shortlist to the block. Queue view only: in
                  the full pool this would sit beside 300 rows you never chose. */}
              {filter === 'QUEUE' && canNominate && !p.gone && (
                <button
                  onClick={() => nominateNow(p)}
                  disabled={pending}
                  className="shrink-0 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  Nominate
                </button>
              )}

              {/* Same reasoning as the star below: its own control, live while
                  the row is disabled, because "is this guy hurt" is asked most
                  when it is NOT your turn. */}
              <button
                onClick={() => setDetail(p)}
                title={`News and injury for ${p.name}`}
                aria-label={`Details for ${p.name}`}
                className="shrink-0 px-1.5 py-2 text-xs text-slate-700 transition hover:text-sky-300"
              >
                ⓘ
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

      <PlayerDrawer player={detail} onClose={() => setDetail(null)} />

      {/* Nomination tray */}
      {selected && canNominate && (
        <div className="border-t border-rule bg-slate-900 p-3">
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
