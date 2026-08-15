'use client'

import { useMemo, useState } from 'react'
import { SLOTS, autoSlot } from '@/lib/draft'
import { textOn } from '@/lib/colors'

/**
 * A column header. Deliberately narrower than `StateManager` so the same grid
 * renders a finished season out of the archive, where there is no max bid, no
 * PIN, and no commissioner — see src/server/archive-service.ts.
 */
export interface BoardColumn {
  id: number
  displayName: string
  color: string
  budget: number
  /** Omitted for an archived season: nobody is bidding in 2026 any more. */
  maxBid?: number
}

/** A cell. Also the common subset of a live `RosterPick` and an `ArchivePick`. */
export interface BoardCell {
  id: number
  managerId: number
  price: number
  position: string
  slotOverride: string | null
  name: string
}

/**
 * The grid: 16 slot rows x 10 manager columns, mirroring the league's old
 * spreadsheet. This is the view the room reads the draft off, so it gets the
 * width — cramming it into a sidebar made it useless.
 *
 * Slot labels stay pinned while the columns scroll sideways, and the whole
 * thing can go full screen for when everyone crowds round one laptop.
 */
export function LeagueBoard({
  managers,
  board,
  highlightManagerId,
  title = 'League board',
  className = '',
}: {
  managers: BoardColumn[]
  board: { rosters: BoardCell[] } | null
  /** Tint this manager's column — usually you. */
  highlightManagerId?: number | null
  /** Overridden by the archive to name the season being viewed. */
  title?: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)

  const byManager = useMemo(() => {
    const map = new Map<number, BoardCell[]>()
    for (const m of managers) map.set(m.id, [])
    for (const p of board?.rosters ?? []) map.get(p.managerId)?.push(p)
    return map
  }, [board, managers])

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

  const pickById = useMemo(() => {
    const m = new Map<number, BoardCell>()
    for (const list of byManager.values()) for (const p of list) m.set(p.id, p)
    return m
  }, [byManager])

  const grid = (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-20 border-b border-r border-slate-800 bg-slate-900 px-2 py-2 text-left text-[10px] uppercase tracking-wider text-slate-500">
              Slot
            </th>
            {managers.map((m) => {
              const spent = (byManager.get(m.id) ?? []).reduce((s, p) => s + p.price, 0)
              return (
                <th
                  key={m.id}
                  className="sticky top-0 z-20 border-b border-slate-800 px-2 py-1.5 text-left"
                  style={{ backgroundColor: m.color, color: textOn(m.color), minWidth: '9rem' }}
                >
                  <div className="truncate font-semibold">{m.displayName}</div>
                  <div className="text-[10px] font-normal opacity-75">
                    ${m.budget} left ·{' '}
                    {m.maxBid === undefined ? null : <>max ${m.maxBid} · </>}${spent} spent
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot, rowIndex) => (
            <tr key={slot.key}>
              <td
                className={`sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-900 px-2 py-1.5 text-[10px] uppercase tracking-wider ${
                  slot.label === 'BENCH' ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                {slot.label}
              </td>
              {managers.map((m) => {
                const entry = laid.get(m.id)?.slots[slot.key]
                const pick = entry ? pickById.get(entry.id) : null
                const isMine = highlightManagerId === m.id
                return (
                  <td
                    key={m.id}
                    className={`border-b border-slate-800/60 px-2 py-1.5 ${
                      isMine ? 'ring-1 ring-inset ring-slate-600/40' : ''
                    } ${rowIndex === 9 ? 'border-b-slate-700' : ''}`}
                    style={{ backgroundColor: pick ? `${m.color}1f` : undefined }}
                  >
                    {pick ? (
                      <span className="flex items-baseline justify-between gap-1">
                        <span className="truncate text-slate-100">{pick.name}</span>
                        <span className="shrink-0 tabular-nums text-slate-400">${pick.price}</span>
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

  const header = (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">{title}</h2>
      <span className="text-[11px] text-slate-600">
        {board?.rosters.length ?? 0} picks · scroll sideways for every team
      </span>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="ml-auto rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700"
      >
        {expanded ? '✕ Close' : '⤢ Full screen'}
      </button>
    </div>
  )

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 p-3">
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/60">
          {header}
          {grid}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 ${className}`}
    >
      {header}
      {grid}
    </div>
  )
}
