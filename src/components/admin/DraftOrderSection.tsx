'use client'

import { useMemo, useState } from 'react'
import { randomOrder, snakeSlot } from '@/lib/draft'
import { managerTint } from '@/lib/colors'
import type { DraftState, StateManager } from '@/server/draft-service'
import { Btn, Section, type Act } from './ui'

/**
 * The draft order. The league re-draws it at random every season, so it is data
 * to be rolled here, not a constant in the code. Moved from /setup unchanged,
 * plus the swap-two-seats control the old "locked" message pointed at but that
 * no screen actually had.
 */
export function DraftOrderSection({
  state,
  picksMade,
  act,
  busy,
}: {
  state: DraftState
  picksMade: number
  act: Act
  busy: boolean
}) {
  // null = no unsaved edits, so show the server's order as it polls in. Once
  // the commissioner rolls or moves anyone, the local draft wins until it is
  // saved or discarded — a poll must never stomp an unsaved draw.
  const [draft, setDraft] = useState<StateManager[] | null>(null)
  const [rolling, setRolling] = useState(false)
  const order = draft ?? state.managers
  const dirty = draft !== null
  const locked = picksMade > 0

  /** Fisher–Yates, revealed with a brief shuffle so the draw feels like an event. */
  function randomize() {
    if (rolling) return
    setRolling(true)
    let ticks = 0
    const spin = setInterval(() => {
      setDraft((o) => randomOrder(o ?? state.managers))
      if (++ticks >= 12) {
        clearInterval(spin)
        setRolling(false)
      }
    }, 70)
  }

  function move(index: number, delta: number) {
    setDraft((o) => {
      const next = [...(o ?? state.managers)]
      const target = index + delta
      if (target < 0 || target >= next.length) return o
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const preview = useMemo(() => {
    const n = order.length
    return {
      one: Array.from({ length: n }, (_, i) => order[snakeSlot(i, n)]),
      two: Array.from({ length: n }, (_, i) => order[snakeSlot(n + i, n)]),
    }
  }, [order])

  return (
    <Section id="order" title="Draft order" note="Re-drawn every season. The snake runs down this order, then back up it.">
      <div className="flex flex-wrap gap-2">
        <Btn onClick={randomize} disabled={busy || rolling || locked} tone="go">
          {rolling ? 'Rolling…' : '🎲 Randomize'}
        </Btn>
        <Btn
          tone="primary"
          onClick={async () => {
            const r = await act({ action: 'setDraftOrder', managerIds: order.map((m) => m.id) }, 'Draft order saved.')
            if (r?.ok) setDraft(null)
          }}
          disabled={busy || rolling || !dirty || locked}
        >
          Save order
        </Btn>
        {dirty && !locked && (
          <Btn
            tone="ghost"
            onClick={() => setDraft(null)}
            disabled={busy}
          >
            Discard
          </Btn>
        )}
      </div>

      {locked && (
        <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          {picksMade} picks have been made, so the order is locked. To fix a single mistake, swap two seats:
          <SwapSeats state={state} act={act} busy={busy} />
        </div>
      )}

      <ol className="mt-4 space-y-1">
        {order.map((m, i) => (
          <li
            key={m.id}
            className={`flex items-center gap-3 rounded-lg border border-rule bg-slate-900/60 px-3 py-2 ${
              rolling ? 'transition-transform duration-75' : ''
            }`}
          >
            <span className="w-6 text-center text-sm tabular-nums text-slate-500">{i + 1}</span>
            <span className="h-5 w-2 rounded-full" style={{ backgroundColor: m.color }} />
            <span className="flex-1 font-medium">{m.displayName}</span>
            <div className="flex gap-1">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0 || locked || rolling}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-30"
                aria-label={`Move ${m.displayName} up`}
              >
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1 || locked || rolling}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-30"
                aria-label={`Move ${m.displayName} down`}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>

      {/* Showing both directions makes the snake unambiguous before committing. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(
          [
            ['Round 1', preview.one],
            ['Round 2 (reversed)', preview.two],
          ] as const
        ).map(([label, list]) => (
          <div key={label} className="rounded-lg border border-rule p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
            <div className="flex flex-wrap gap-1">
              {list.map((m, i) => (
                <span
                  key={`${m.id}-${i}`}
                  className="rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: managerTint(m.color, 15), color: m.color }}
                >
                  {i + 1}. {m.displayName}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function SwapSeats({ state, act, busy }: { state: DraftState; act: Act; busy: boolean }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const name = (id: string) => state.managers.find((m) => m.id === Number(id))?.displayName
  const select = (value: string, set: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => set(e.target.value)}
      className="rounded-lg border border-rule bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
    >
      <option value="">Choose…</option>
      {state.managers.map((m) => (
        <option key={m.id} value={m.id}>
          {m.draftSlot + 1}. {m.displayName}
        </option>
      ))}
    </select>
  )
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {select(a, setA)}
      <span>⇄</span>
      {select(b, setB)}
      <Btn
        size="sm"
        disabled={busy || !a || !b || a === b}
        onClick={() =>
          act(
            { action: 'swapSeats', aId: Number(a), bId: Number(b) },
            `${name(a)} and ${name(b)} swapped seats.`,
            `Swap ${name(a)} and ${name(b)}? Completed picks are untouched; only who nominates next changes.`,
          )
        }
      >
        Swap
      </Btn>
    </div>
  )
}
