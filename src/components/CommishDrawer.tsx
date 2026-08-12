'use client'

import { useState } from 'react'
import type { Board } from '@/hooks/useDraft'
import type { DraftState } from '@/server/draft-service'

/**
 * Commissioner controls.
 *
 * Deliberately blunt and always one tap away: when something goes wrong mid-lot
 * the commissioner is being shouted at by nine people, and hunting through a
 * settings page is not an option.
 */
export function CommishDrawer({
  state,
  board,
  onDone,
}: {
  state: DraftState
  board: Board | null
  onDone: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [timer, setTimer] = useState(String(state.draft.timerSeconds))
  const [softClose, setSoftClose] = useState(String(state.draft.softCloseSeconds))

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/commish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setMsg(data.ok ? 'Done.' : (data.reason ?? 'Failed'))
      await onDone()
    } catch {
      setMsg('Network error')
    } finally {
      setBusy(false)
    }
  }

  const paused = state.draft.status === 'paused'
  const lastPick = [...(board?.rosters ?? [])].sort((a, b) => b.pickNo - a.pickNo)[0]

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-200 shadow-lg ring-1 ring-slate-700 hover:bg-slate-700"
      >
        ⚙ Commish
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setOpen(false)}>
      <div
        className="h-full w-full max-w-sm overflow-y-auto border-l border-slate-800 bg-slate-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Commissioner</h2>
          <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-100">
            ✕
          </button>
        </div>

        {msg && (
          <p className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300">{msg}</p>
        )}

        {/* Run state */}
        <Section title="Run state">
          <div className="flex gap-2">
            <Btn
              onClick={() => act({ action: paused ? 'resume' : 'pause' })}
              disabled={busy}
              tone={paused ? 'go' : 'warn'}
              className="flex-1"
            >
              {paused ? '▶ Resume' : '❚❚ Pause'}
            </Btn>
            {state.draft.status === 'setup' && (
              <Btn onClick={() => act({ action: 'setStatus', status: 'live' })} tone="go" disabled={busy}>
                Start draft
              </Btn>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Pause banks the exact time left on the clock, so a break mid-player is safe.
          </p>
        </Section>

        {/* Clock */}
        <Section title="Clock">
          <div className="flex gap-2">
            {[-10, +10, +30].map((d) => (
              <Btn key={d} onClick={() => act({ action: 'adjustClock', deltaSeconds: d })} disabled={busy}>
                {d > 0 ? `+${d}s` : `${d}s`}
              </Btn>
            ))}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-400">
              Nomination timer
              <input
                value={timer}
                onChange={(e) => setTimer(e.target.value.replace(/\D/g, '').slice(0, 3))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center tabular-nums text-slate-100"
              />
            </label>
            <label className="flex-1 text-xs text-slate-400">
              Soft close
              <input
                value={softClose}
                onChange={(e) => setSoftClose(e.target.value.replace(/\D/g, '').slice(0, 3))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center tabular-nums text-slate-100"
              />
            </label>
            <Btn
              onClick={() =>
                act({
                  action: 'setTimers',
                  timerSeconds: Number(timer),
                  softCloseSeconds: Number(softClose),
                })
              }
              disabled={busy}
            >
              Set
            </Btn>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Applies to the next nomination. Shorten this as the draft drags on.
          </p>
        </Section>

        {/* Fixing mistakes */}
        <Section title="Fix a mistake">
          <div className="flex flex-wrap gap-2">
            <Btn
              onClick={() =>
                act(
                  { action: 'undoLastPick' },
                  lastPick
                    ? `Undo pick #${lastPick.pickNo} (${lastPick.name}, $${lastPick.price})? The player returns to the pool and the money is refunded.`
                    : undefined,
                )
              }
              disabled={busy || !lastPick}
              tone="danger"
            >
              Undo last pick
            </Btn>
            <Btn
              onClick={() => act({ action: 'voidLot' }, 'Cancel the player currently on the clock?')}
              disabled={busy || !state.lot}
              tone="danger"
            >
              Cancel current lot
            </Btn>
            <Btn
              onClick={() => act({ action: 'skipNominator' })}
              disabled={busy || !!state.lot}
            >
              Skip nominator
            </Btn>
          </div>
          {lastPick && (
            <p className="mt-2 text-xs text-slate-500">
              Last pick: #{lastPick.pickNo} {lastPick.name} — ${lastPick.price}
            </p>
          )}
        </Section>

        {/* Price / reassignment */}
        {lastPick && (
          <Section title="Edit the last pick">
            <EditPick pick={lastPick} state={state} act={act} busy={busy} />
          </Section>
        )}

        <Section title="Seats">
          <p className="text-xs text-slate-500">
            Someone forgot their PIN? Clear it and they can set a new one.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1">
            {state.managers.map((m) => (
              <button
                key={m.id}
                onClick={() => act({ action: 'clearPin', managerId: m.id }, `Clear ${m.displayName}'s PIN?`)}
                disabled={busy}
                className="truncate rounded-md bg-slate-800 px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700"
              >
                {m.displayName}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Setup">
          <a
            href="/setup"
            className="inline-block rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Draft order, rules & reset →
          </a>
        </Section>

        <Section title="Export">
          <a
            href="/api/export"
            className="inline-block rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Download draft CSV
          </a>
        </Section>
      </div>
    </div>
  )
}

function EditPick({
  pick,
  state,
  act,
  busy,
}: {
  pick: NonNullable<Board['rosters'][number]>
  state: DraftState
  act: (body: Record<string, unknown>, confirmText?: string) => Promise<void>
  busy: boolean
}) {
  const [price, setPrice] = useState(String(pick.price))
  const [managerId, setManagerId] = useState(String(pick.managerId))

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{pick.name}</div>
      <div className="flex gap-2">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, '').slice(0, 3))}
          className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center tabular-nums"
        />
        <Btn onClick={() => act({ action: 'editPrice', pickId: pick.id, price: Number(price) })} disabled={busy}>
          Set price
        </Btn>
      </div>
      <div className="flex gap-2">
        <select
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
        >
          {state.managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <Btn
          onClick={() => act({ action: 'reassignPick', pickId: pick.id, managerId: Number(managerId) })}
          disabled={busy}
        >
          Reassign
        </Btn>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-slate-800 pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function Btn({
  children,
  onClick,
  disabled,
  tone = 'neutral',
  className = '',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'neutral' | 'go' | 'warn' | 'danger'
  className?: string
}) {
  const tones = {
    neutral: 'bg-slate-800 hover:bg-slate-700 text-slate-200',
    go: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    warn: 'bg-amber-600 hover:bg-amber-500 text-white',
    danger: 'bg-rose-700 hover:bg-rose-600 text-white',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  )
}
