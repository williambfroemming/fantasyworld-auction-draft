'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { playerIndexView } from '@/lib/player-index'
import type { PlayerListing } from '@/server/history-service'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

/**
 * Find a player.
 *
 * All ~600 are shipped once and filtered in the browser rather than queried per
 * keystroke: the payload is around 88KB, which is one cacheable page against a
 * round trip per character, and it keeps this off the database entirely.
 *
 * ## Stats, within one position only
 *
 * A season filter narrows the list to who was rostered that year and shows that year's regular
 * season points. With exactly one position selected a stat column appears (passing yards for a
 * quarterback, receiving yards for a receiver, and so on) and the list can be sorted by it. With
 * "All" there is no stat column and no stat sort, because a list ranked by yards across positions
 * measures nothing (src/lib/player-index.ts, which has the tests).
 *
 * The list is capped at 100 rendered rows. Six hundred rows of DOM to display a
 * search nobody scrolls past the top of is waste, and the count above the list
 * says how many matched so a cap never reads as a missing player.
 */
export function PlayerSearch({ players }: { players: PlayerListing[] }) {
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<string | null>(null)
  const [season, setSeason] = useState<number | null>(null)
  const [sort, setSort] = useState<'points' | 'stat'>('points')

  const seasons = useMemo(
    () =>
      [...new Set(players.flatMap((p) => p.seasons.map((s) => s.season)))].sort((a, b) => b - a),
    [players],
  )
  const view = useMemo(
    () => playerIndexView(players, { query: q, position: pos, season, sort }),
    [players, q, pos, season, sort],
  )
  const matches = view.rows
  const stat = view.statLabel

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
              onClick={() => {
                const next = pos === p ? null : p
                setPos(next)
                if (next === null) setSort('points')
              }}
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

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
        <label className="flex items-center gap-2">
          Season
          <select
            value={season ?? ''}
            onChange={(e) => setSeason(e.target.value === '' ? null : Number(e.target.value))}
            className="border border-rule bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200"
          >
            <option value="">All seasons</option>
            {seasons.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {view.canSortByStat ? (
          <span role="group" aria-label="Sort by" className="inline-flex items-center gap-2">
            Sort by
            <span className="inline-flex border border-rule">
              {(['points', 'stat'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={view.sort === m}
                  onClick={() => setSort(m)}
                  className={`px-2 py-0.5 font-display uppercase tracking-[0.06em] ${
                    view.sort === m
                      ? 'bg-slate-800 text-slate-50'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'points' ? 'Fantasy points' : stat}
                </button>
              ))}
            </span>
          </span>
        ) : (
          <span className="text-slate-600">Pick one position to see and sort by a stat.</span>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {matches.length} of {players.length} players
        {matches.length > 100 && ' · showing the first 100'}
      </p>

      {stat && (
        <p className="mt-1 text-[11px] text-slate-600">
          {stat}: regular season, {season ?? 'all seasons'}, weeks rostered in this league. A dash
          means no game played.
        </p>
      )}
      {season !== null && (
        <p className="mt-1 text-[11px] text-slate-600">Points are {season} regular season only.</p>
      )}

      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {matches.slice(0, 100).map(({ player: p, points, stat: value }) => (
          <li key={p.playerId}>
            <Link
              href={`/history/players/${encodeURIComponent(p.playerId)}`}
              className="flex items-baseline gap-3 px-1 py-2 hover:bg-slate-900/60"
            >
              <span className="w-9 shrink-0 font-mono text-[11px] text-slate-500">
                {p.position ?? '—'}
              </span>
              <span className="min-w-[6rem] flex-1 truncate">{p.playerName}</span>
              {stat && (
                <span
                  className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-slate-200 sm:w-20"
                  title={`${stat}${season ? `, ${season}` : ', all seasons'}, regular season`}
                >
                  {value === null ? '—' : value.toLocaleString('en-US')}
                </span>
              )}
              <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
                {points.toFixed(0)} pts
              </span>
              <span className="hidden w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-600 sm:block">
                {p.firstSeason}–{p.lastSeason}
              </span>
              <span className="hidden w-10 shrink-0 text-right font-mono text-xs tabular-nums text-slate-500 sm:block">
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
