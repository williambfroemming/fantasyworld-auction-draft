'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { PlayerListing } from '@/server/history-service'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

/**
 * Find a player.
 *
 * All ~600 are shipped once and filtered in the browser rather than queried per
 * keystroke: the payload is around 88KB, which is one cacheable page against a
 * round trip per character, and it keeps this off the database entirely.
 *
 * The list is capped at 100 rendered rows. Six hundred rows of DOM to display a
 * search nobody scrolls past the top of is waste, and the count above the list
 * says how many matched so a cap never reads as a missing player.
 */
export function PlayerSearch({ players }: { players: PlayerListing[] }) {
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<string | null>(null)

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return players.filter(
      (p) =>
        (!pos || p.position === pos) &&
        (needle === '' || p.playerName.toLowerCase().includes(needle)),
    )
  }, [players, q, pos])

  return (
    <>
      {/* Filters in one row above the list. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search players…"
          aria-label="Search players by name"
          className="min-w-0 flex-1 border border-rule bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-rule-strong"
        />
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPos(pos === p ? null : p)}
              aria-pressed={pos === p}
              className={`border px-2 py-1 font-mono text-xs ${
                pos === p
                  ? 'border-rule-strong bg-slate-800 text-slate-100'
                  : 'border-rule text-slate-400 hover:text-slate-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {matches.length} of {players.length} players
        {matches.length > 100 && ' · showing the first 100'}
      </p>

      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {matches.slice(0, 100).map((p) => (
          <li key={p.playerId}>
            <Link
              href={`/history/players/${encodeURIComponent(p.playerId)}`}
              className="flex items-baseline gap-3 px-1 py-2 hover:bg-slate-900/60"
            >
              <span className="w-9 shrink-0 font-mono text-[11px] text-slate-500">
                {p.position ?? '—'}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.playerName}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
                {p.points.toFixed(0)} pts
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-600">
                {p.firstSeason}–{p.lastSeason}
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-slate-500">
                {p.topPrice === null ? '' : `$${p.topPrice}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {matches.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">
          Nobody by that name has been on a Fantasy World roster since 2020.
        </p>
      )}
    </>
  )
}
