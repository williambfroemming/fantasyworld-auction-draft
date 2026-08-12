'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { randomOrder, snakeSlot } from '@/lib/draft'
import { useDraft } from '@/hooks/useDraft'
import type { StateManager } from '@/server/draft-service'

/**
 * Pre-draft setup. Commissioner only.
 *
 * The draft order is the point of this page: the league re-draws it at random
 * every season, so it is data to be rolled here, not a constant in the code.
 */
export default function SetupPage() {
  const { state, board, refresh } = useDraft()
  const [me, setMe] = useState<number | null>(null)
  const [order, setOrder] = useState<StateManager[] | null>(null)
  const [rolling, setRolling] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((d) => setMe(d.managerId)).catch(() => {})
  }, [])

  // Seed local order from the server, but never stomp unsaved edits.
  useEffect(() => {
    if (state && !dirty) setOrder(state.managers)
  }, [state, dirty])

  const picksMade = board?.rosters.length ?? 0
  const locked = picksMade > 0

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/commish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setMsg(data.ok ? ok : (data.reason ?? 'Failed'))
      if (data.ok) setDirty(false)
      await refresh()
      return data.ok as boolean
    } finally {
      setBusy(false)
    }
  }

  /** Fisher–Yates, revealed with a brief shuffle so the draw feels like an event. */
  function randomize() {
    if (!order || rolling) return
    setRolling(true)
    setDirty(true)
    let ticks = 0
    const spin = setInterval(() => {
      setOrder((o) => (o ? randomOrder(o) : o))
      if (++ticks >= 12) {
        clearInterval(spin)
        setRolling(false)
      }
    }, 70)
  }

  function move(index: number, delta: number) {
    setOrder((o) => {
      if (!o) return o
      const next = [...o]
      const target = index + delta
      if (target < 0 || target >= next.length) return o
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }

  const preview = useMemo(() => {
    if (!order) return { one: [], two: [] }
    const n = order.length
    return {
      one: Array.from({ length: n }, (_, i) => order[snakeSlot(i, n)]),
      two: Array.from({ length: n }, (_, i) => order[snakeSlot(n + i, n)]),
    }
  }, [order])

  if (!state || !order) {
    return <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>
  }

  const amCommish = state.managers.find((m) => m.id === me)?.isCommish
  if (!amCommish) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-950 px-6 text-center text-slate-400">
        <div>
          <p>Setup is commissioner-only.</p>
          <Link href="/draft" className="mt-3 inline-block text-emerald-400 underline">
            Back to the draft
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Draft setup</h1>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
            {state.draft.status}
          </span>
          <Link href="/draft" className="ml-auto text-sm text-slate-400 underline">
            → draft
          </Link>
        </header>

        {msg && <p className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-sm">{msg}</p>}

        {/* ---------------- Draft order ---------------- */}
        <Section
          title="Draft order"
          note="Re-drawn every season. The snake runs down this order, then back up it."
        >
          <div className="flex flex-wrap gap-2">
            <button
              onClick={randomize}
              disabled={busy || rolling || locked}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {rolling ? 'Rolling…' : '🎲 Randomize'}
            </button>
            <button
              onClick={() => act({ action: 'setDraftOrder', managerIds: order.map((m) => m.id) }, 'Draft order saved.')}
              disabled={busy || rolling || !dirty || locked}
              className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-900 hover:bg-white disabled:opacity-40"
            >
              Save order
            </button>
            {dirty && !locked && (
              <button
                onClick={() => { setOrder(state.managers); setDirty(false) }}
                disabled={busy}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
              >
                Discard
              </button>
            )}
          </div>

          {locked && (
            <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              {picksMade} picks have been made, so the order is locked. Use ⚙ Commish → swap seats
              to fix a single mistake, or reset the draft below to start over.
            </p>
          )}

          <ol className="mt-4 space-y-1">
            {order.map((m, i) => (
              <li
                key={m.id}
                className={`flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 ${
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
            {[
              ['Round 1', preview.one],
              ['Round 2 (reversed)', preview.two],
            ].map(([label, list]) => (
              <div key={label as string} className="rounded-lg border border-slate-800 p-3">
                <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">
                  {label as string}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(list as StateManager[]).map((m, i) => (
                    <span
                      key={`${m.id}-${i}`}
                      className="rounded px-1.5 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: `${m.color}26`, color: m.color }}
                    >
                      {i + 1}. {m.displayName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------- Rules ---------------- */}
        <Section title="Rules" note="Budget and roster size lock once the first player is sold.">
          <Settings state={state} act={act} busy={busy} locked={locked} />
        </Section>

        {/* ---------------- Start ---------------- */}
        <Section title="Start the draft">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => act({ action: 'setStatus', status: 'live' }, 'Draft is live.')}
              disabled={busy || state.draft.status === 'live'}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {state.draft.status === 'live' ? 'Draft is live' : '▶ Start draft'}
            </button>
            {state.draft.status === 'live' && (
              <button
                onClick={() => act({ action: 'setStatus', status: 'setup' }, 'Back to setup.')}
                disabled={busy}
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm hover:bg-slate-800"
              >
                Back to setup
              </button>
            )}
          </div>
        </Section>

        {/* ---------------- Danger ---------------- */}
        <Section title="Before the real draft" note="Run both of these after any rehearsal.">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!window.confirm('Clear every PIN? Each manager will set a new one when they join.')) return
                Promise.all(
                  state.managers.map((m) =>
                    fetch('/api/commish', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'clearPin', managerId: m.id }),
                    }),
                  ),
                ).then(() => { setMsg('All PINs cleared.'); refresh() })
              }}
              disabled={busy}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
            >
              Clear all PINs
            </button>

            <button
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete all ${picksMade} picks and every bid, and return to setup?\n\nThis cannot be undone.`,
                  )
                )
                  return
                act({ action: 'resetDraft', confirm: 'RESET' }, 'Draft cleared.')
              }}
              disabled={busy}
              className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-40"
            >
              Reset draft ({picksMade} picks)
            </button>
          </div>
        </Section>
      </div>
    </main>
  )
}

function Settings({
  state,
  act,
  busy,
  locked,
}: {
  state: NonNullable<ReturnType<typeof useDraft>['state']>
  act: (body: Record<string, unknown>, ok: string) => Promise<boolean>
  busy: boolean
  locked: boolean
}) {
  const [budget, setBudget] = useState(String(state.draft.startingBudget))
  const [roster, setRoster] = useState(String(state.draft.rosterSize))
  const [timer, setTimer] = useState(String(state.draft.timerSeconds))
  const [soft, setSoft] = useState(String(state.draft.softCloseSeconds))

  const maxAtStart = Number(budget) - (Number(roster) - 1)

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Budget per manager" value={budget} onChange={setBudget} disabled={locked} />
        <Field label="Roster spots" value={roster} onChange={setRoster} disabled={locked} />
      </div>
      <p className="text-xs text-slate-500">
        Opening max bid will be{' '}
        <span className="font-semibold text-emerald-400">${Number.isFinite(maxAtStart) ? maxAtStart : '—'}</span>{' '}
        — each empty roster spot keeps $1 in reserve.
      </p>
      <button
        onClick={() =>
          act(
            { action: 'setLeagueSettings', startingBudget: Number(budget), rosterSize: Number(roster) },
            'Rules saved.',
          )
        }
        disabled={busy || locked}
        className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-40"
      >
        Save rules
      </button>

      <div className="grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-2">
        <Field label="Nomination timer (s)" value={timer} onChange={setTimer} />
        <Field label="Soft close (s)" value={soft} onChange={setSoft} />
      </div>
      <p className="text-xs text-slate-500">
        Any bid inside the last {soft || '—'}s pushes the clock back to {soft || '—'}s.
      </p>
      <button
        onClick={() =>
          act(
            { action: 'setTimers', timerSeconds: Number(timer), softCloseSeconds: Number(soft) },
            'Timers saved.',
          )
        }
        disabled={busy}
        className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-40"
      >
        Save timers
      </button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 5))}
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg tabular-nums text-slate-100 disabled:opacity-40"
      />
    </label>
  )
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">{title}</h2>
      {note && <p className="mb-3 mt-1 text-xs text-slate-500">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}
