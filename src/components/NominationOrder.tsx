'use client'

import { useMemo } from 'react'
import { upcomingOrder } from '@/lib/draft'
import type { DraftState } from '@/server/draft-service'
import { textOn } from '@/lib/colors'

/**
 * Who nominates now, and who is coming up.
 *
 * Sits above the lot rather than below it, because it is the one thing on the
 * page about *what happens next* — the recent-picks ticker underneath is about
 * what already happened, and the two read badly stacked together.
 *
 * ## On honesty
 *
 * Only the first two names are certain. Everything after that assumes rosters
 * stay as they are, and a manager who fills their 16th slot drops out of the
 * order and shuffles everyone behind them up. That is exactly right for most of
 * a draft (nobody is full early) and drifts at the end, which is why the tail is
 * dimmed and labelled rather than presented as fact. See `upcomingOrder`.
 */
export function NominationOrder({
  state,
  me,
  count = 10,
}: {
  state: DraftState
  me: number | null
  /** How many seats to show, including whoever is on the clock. */
  count?: number
}) {
  const byId = useMemo(
    () => new Map(state.managers.map((m) => [m.id, m])),
    [state.managers],
  )

  const upcoming = useMemo(() => {
    if (!state.onTheClock) return []
    return upcomingOrder(
      state.managers.map((m) => ({
        id: m.id,
        draftSlot: m.draftSlot,
        rosterCount: m.rostered,
      })),
      state.onTheClock.index,
      state.draft.rosterSize,
      count,
    )
  }, [state.managers, state.onTheClock, state.draft.rosterSize, count])

  if (upcoming.length === 0) return null

  const n = state.managers.length

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-rule bg-slate-900/40 px-4 py-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Order
      </span>

      {upcoming.map((turn, i) => {
        const m = byId.get(turn.manager.id)
        if (!m) return null
        const isNow = i === 0
        const isMe = m.id === me
        // Round number, so the snake's double-back reads as deliberate rather
        // than as the same person listed twice by mistake.
        const round = Math.floor(turn.index / n) + 1
        const certain = i <= 1

        return (
          <span key={turn.index} className="flex shrink-0 items-center gap-2">
            {i > 0 && <span className="text-slate-700">›</span>}
            <span
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${
                isNow ? '' : 'bg-slate-800/60'
              } ${!certain ? 'opacity-60' : ''}`}
              style={isNow ? { backgroundColor: m.color, color: textOn(m.color) } : undefined}
              title={
                certain
                  ? undefined
                  : 'Projected — assumes nobody fills their roster before then'
              }
            >
              {!isNow && (
                <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
              )}
              <span className={`text-xs font-semibold ${isNow ? '' : 'text-slate-200'}`}>
                {m.displayName}
                {isMe && !isNow && <span className="ml-1 text-[10px] opacity-70">(you)</span>}
              </span>
              <span className={`text-[10px] tabular-nums ${isNow ? 'opacity-75' : 'text-slate-500'}`}>
                R{round}
              </span>
            </span>
          </span>
        )
      })}

      <span className="ml-auto shrink-0 pl-3 text-[10px] text-slate-600">
        after the next two, projected
      </span>
    </div>
  )
}
