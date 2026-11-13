'use client'

import { useEffect, useState } from 'react'

/**
 * The body of /account. Talks only to /api/account, which takes the seat from the
 * session cookie — there is no id here to change.
 */
interface Linked {
  provider: string
  externalUsername: string | null
  verified: boolean
}

const PROVIDER_LABEL: Record<string, string> = { sleeper: 'Sleeper', yahoo: 'Yahoo', espn: 'ESPN' }

const field =
  'w-full rounded-lg border border-rule bg-slate-950 px-3 py-2.5 outline-none focus:border-emerald-500'
const pinField = `${field} text-center text-xl tracking-[0.4em]`
const card = 'rounded-xl border border-rule bg-slate-900/40 p-4'
const btn =
  'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40'

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4)

async function post(body: object): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch {
    return { ok: false, reason: 'Network error — try again' }
  }
}

export function AccountPanel() {
  const [name, setName] = useState<string | null>(null)
  const [linked, setLinked] = useState<Linked[]>([])

  useEffect(() => {
    fetch('/api/account', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setName(d.displayName)
          setLinked(d.linked)
        }
      })
      .catch(() => {})
  }, [])

  if (name === null) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-5">
      <NameCard initial={name} onSaved={setName} />
      <PinCard />
      <section className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Linked accounts</h2>
        {linked.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None on record.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {linked.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-semibold">{PROVIDER_LABEL[l.provider] ?? l.provider}</span>
                <span className="text-slate-300">{l.externalUsername ?? 'linked'}</span>
                {l.verified && <span className="text-xs text-emerald-400">verified</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Yahoo and ESPN can be linked here once the league supports them.</p>
      </section>
    </div>
  )
}

function NameCard({ initial, onSaved }: { initial: string; onSaved: (n: string) => void }) {
  const [value, setValue] = useState(initial)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const changed = value.trim() && value.trim() !== initial

  async function save() {
    setBusy(true)
    const r = await post({ action: 'rename', displayName: value })
    setBusy(false)
    if (r.ok) {
      onSaved(value.trim())
      setMsg({ ok: true, text: 'Saved. The board and the menu show it from now on.' })
    } else setMsg({ ok: false, text: r.reason ?? 'Could not save' })
  }

  return (
    <section className={card}>
      <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Your name</h2>
      <p className="mt-1 text-xs text-slate-500">
        What the board shows for you. Past seasons keep the name that was on the board that night.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={value}
          maxLength={24}
          onChange={(e) => (setValue(e.target.value), setMsg(null))}
          onKeyDown={(e) => e.key === 'Enter' && changed && save()}
          className={field}
        />
        <button onClick={save} disabled={!changed || busy} className={btn}>
          Save
        </button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</p>}
    </section>
  )
}

function PinCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = current.length === 4 && next.length === 4 && again.length === 4

  async function save() {
    if (next !== again) return setMsg({ ok: false, text: 'The new PINs do not match.' })
    setBusy(true)
    const r = await post({ action: 'changePin', currentPin: current, newPin: next })
    setBusy(false)
    if (r.ok) {
      setCurrent('')
      setNext('')
      setAgain('')
      setMsg({ ok: true, text: 'PIN changed. Use the new one next time you sign in.' })
    } else {
      setCurrent('')
      setMsg({ ok: false, text: r.reason ?? 'Could not change your PIN' })
    }
  }

  return (
    <section className={card}>
      <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Change PIN</h2>
      <p className="mt-1 text-xs text-slate-500">
        Wrong current PINs count toward the same five-strikes lock as the sign-in screen.
        Forgotten it? Ask the commissioner for a reset link.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(
          [
            ['Current', current, setCurrent],
            ['New', next, setNext],
            ['Again', again, setAgain],
          ] as const
        ).map(([label, v, set]) => (
          <label key={label} className="block">
            <span className="mb-1 block text-xs text-slate-400">{label}</span>
            <input
              inputMode="numeric"
              pattern="\d*"
              autoComplete="off"
              maxLength={4}
              value={v}
              onChange={(e) => (set(digits(e.target.value)), setMsg(null))}
              placeholder="••••"
              className={pinField}
            />
          </label>
        ))}
      </div>
      <button onClick={save} disabled={!ready || busy} className={`${btn} mt-3`}>
        {busy ? 'Saving…' : 'Change PIN'}
      </button>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</p>}
    </section>
  )
}
