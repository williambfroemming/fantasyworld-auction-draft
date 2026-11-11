'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { safeNext } from '@/lib/gate'

interface Seat {
  id: number
  displayName: string
  color: string
  hasPin: boolean
}

/**
 * The sign-in page — and, since the whole site went behind the PIN (src/proxy.ts),
 * the front door for every signed-out visitor.
 *
 * Signing in returns you to the page you were trying to reach (`?next=`, validated by
 * `safeNext`) or the front page. It does NOT go to the draft room unless that is where
 * you were headed; `/` itself sends a signed-in manager to the draft while one is live.
 *
 * There is deliberately **no "already signed in? go somewhere" redirect here**: a
 * signed-in manager who came on purpose to switch seats would be bounced back out.
 */
export default function JoinPage() {
  const router = useRouter()
  const [seats, setSeats] = useState<Seat[] | null>(null)
  const [picked, setPicked] = useState<Seat | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // /api/seats is public; /api/state is not, and this page is what a signed-out
    // visitor sees.
    fetch('/api/seats')
      .then((r) => r.json())
      .then((s) => setSeats(s.seats))
      .catch(() => setError('Could not reach the league. Check your connection.'))
  }, [])

  async function submit() {
    if (!picked || pin.length !== 4) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId: picked.id, pin }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.reason ?? 'Could not sign in')
        setPin('')
      } else {
        // Back to where they were headed (the gate records it), else the front page.
        // Never straight into the draft room: that is a destination, not a default.
        router.push(safeNext(new URLSearchParams(window.location.search).get('next')))
        router.refresh()
      }
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">FantasyWorld</h1>
          <ThemeToggle className="mt-1" />
        </div>
        <p className="mt-1 text-slate-400">Pick your name to sign in.</p>

        {!picked ? (
          <div className="mt-8 grid grid-cols-2 gap-3">
            {seats === null
              ? Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-800" />
                ))
              : seats.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setPicked(s)
                      setError(null)
                    }}
                    className="flex h-16 items-center gap-3 rounded-xl border border-rule bg-slate-900 px-3 text-left transition hover:border-slate-500 hover:bg-slate-800"
                  >
                    <span
                      className="h-8 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{s.displayName}</span>
                      <span className="block text-xs text-slate-500">
                        {s.hasPin ? 'Enter PIN' : 'Set a PIN'}
                      </span>
                    </span>
                  </button>
                ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-rule bg-slate-900 p-5">
            <div className="flex items-center gap-3">
              <span
                className="h-9 w-2 rounded-full"
                style={{ backgroundColor: picked.color }}
              />
              <div>
                <div className="text-lg font-semibold">{picked.displayName}</div>
                <div className="text-xs text-slate-500">
                  {picked.hasPin ? 'Enter your 4-digit PIN' : 'Choose a 4-digit PIN'}
                </div>
              </div>
            </div>

            <input
              autoFocus
              inputMode="numeric"
              pattern="\d*"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="••••"
              className="mt-5 w-full rounded-lg border border-rule bg-slate-950 px-4 py-3 text-center text-3xl tracking-[0.5em] outline-none focus:border-emerald-500"
            />

            {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  setPicked(null)
                  setPin('')
                  setError(null)
                }}
                className="rounded-lg border border-rule px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={pin.length !== 4 || busy}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Signing in…' : picked.hasPin ? 'Sign in' : 'Set PIN & sign in'}
              </button>
            </div>

            {picked.hasPin ? (
              <p className="mt-3 text-xs text-slate-500">
                Forgot your PIN? Ask the commissioner to reset it — they will give you a new one.
              </p>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Choose any 4 digits. This is what keeps the league’s site to the league.
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
