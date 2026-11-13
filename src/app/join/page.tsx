'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { safeNext } from '@/lib/gate'

interface Seat {
  id: number
  displayName: string
  color: string
  hasPin: boolean
}

interface Challenge {
  token: string
  code: string
  username: string
  instructions: string
  expiresAt: string
}

type Mode = 'seats' | 'reset' | 'new'

/**
 * The sign-in page — and, since the whole site went behind the PIN (src/proxy.ts),
 * the front door for every signed-out visitor. Three modes:
 *
 * - **seats**: pick your name, enter your PIN. A seat with no PIN is shown but not
 *   claimable here: it used to be "first to type four digits owns it", on a public page.
 * - **reset** (`?reset=<token>`): a one-time link from the commissioner. Choose a new PIN
 *   and you are signed in. The token is stripped from the address bar on success.
 * - **new**: someone new to the league proves it on Sleeper (a code in their team name),
 *   chooses a name and PIN, and waits for the commissioner to approve the seat.
 *
 * Signing in returns you to the page you were trying to reach (`?next=`, validated by
 * `safeNext`) or the front page. It does NOT go to the draft room unless that is where
 * you were headed; `/` itself sends a signed-in manager to the draft while one is live.
 *
 * There is deliberately **no "already signed in? go somewhere" redirect here**: a
 * signed-in manager who came on purpose to switch seats would be bounced back out.
 */
export default function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const router = useRouter()
  const reset = use(searchParams).reset
  const resetToken = typeof reset === 'string' && reset ? reset : null
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'seats')
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

  function done() {
    // Back to where they were headed (the gate records it), else the front page.
    // Never straight into the draft room: that is a destination, not a default.
    // `replace`, so a reset token does not linger in history.
    router.replace(safeNext(new URLSearchParams(window.location.search).get('next')))
    router.refresh()
  }

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
        done()
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

        {mode === 'reset' && resetToken && (
          <ResetForm token={resetToken} onDone={done} onCancel={() => setMode('seats')} />
        )}

        {mode === 'new' && <NewMemberFlow onCancel={() => setMode('seats')} />}

        {mode === 'seats' && (
          <>
            <p className="mt-1 text-slate-400">Pick your name to sign in.</p>

            {!picked ? (
              <>
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
                          <span className="h-8 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{s.displayName}</span>
                            <span className="block text-xs text-slate-500">
                              {s.hasPin ? 'Enter PIN' : 'No PIN yet'}
                            </span>
                          </span>
                        </button>
                      ))}
                </div>
                {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
                <button
                  onClick={() => {
                    setMode('new')
                    setError(null)
                  }}
                  className="mt-6 w-full rounded-xl border border-dashed border-rule px-4 py-3 text-sm text-slate-300 transition hover:border-slate-500 hover:bg-slate-900"
                >
                  New to the league? <span className="font-semibold text-slate-100">Join with Sleeper</span>
                </button>
              </>
            ) : !picked.hasPin ? (
              <div className="mt-8 rounded-xl border border-rule bg-slate-900 p-5">
                <SeatHeader seat={picked} sub="No PIN set yet" />
                <p className="mt-4 text-sm text-slate-300">
                  Ask the commissioner for a link to set your PIN. Seats can no longer be claimed
                  from this screen — anyone on the internet can reach it.
                </p>
                <button
                  onClick={() => setPicked(null)}
                  className="mt-5 rounded-lg border border-rule px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Back
                </button>
              </div>
            ) : (
              <div className="mt-8 rounded-xl border border-rule bg-slate-900 p-5">
                <SeatHeader seat={picked} sub="Enter your 4-digit PIN" />

                <PinInput
                  autoFocus
                  value={pin}
                  onChange={(v) => {
                    setPin(v)
                    setError(null)
                  }}
                  onEnter={submit}
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
                  <PrimaryButton onClick={submit} disabled={pin.length !== 4 || busy}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </PrimaryButton>
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  Forgot your PIN? Ask the commissioner for a reset link — you choose the new one.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function SeatHeader({ seat, sub }: { seat: Seat; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-9 w-2 rounded-full" style={{ backgroundColor: seat.color }} />
      <div>
        <div className="text-lg font-semibold">{seat.displayName}</div>
        <div className="text-xs text-slate-500">{sub}</div>
      </div>
    </div>
  )
}

function PinInput({
  value,
  onChange,
  onEnter,
  autoFocus,
  label,
}: {
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  autoFocus?: boolean
  label?: string
}) {
  return (
    <label className="mt-5 block">
      {label && <span className="mb-1 block text-xs text-slate-400">{label}</span>}
      <input
        autoFocus={autoFocus}
        inputMode="numeric"
        pattern="\d*"
        maxLength={4}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        placeholder="••••"
        className="w-full rounded-lg border border-rule bg-slate-950 px-4 py-3 text-center text-3xl tracking-[0.5em] outline-none focus:border-emerald-500"
      />
    </label>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** `?reset=<token>`: choose a new PIN from a commissioner's one-time link. */
function ResetForm({ token, onDone, onCancel }: { token: string; onDone: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = pin.length === 4 && again.length === 4

  async function submit() {
    if (!ready) return
    if (pin !== again) {
      setError('Those two PINs do not match.')
      setAgain('')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken: token, pin }),
      })
      const data = await res.json()
      if (data.ok) onDone()
      else setError(data.reason ?? 'Could not set your PIN')
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-rule bg-slate-900 p-5">
      <div className="text-lg font-semibold">Choose your new PIN</div>
      <p className="mt-1 text-xs text-slate-500">
        Any four digits. This link works once; your old PIN stops working when you save.
      </p>
      <PinInput autoFocus label="New PIN" value={pin} onChange={(v) => (setPin(v), setError(null))} />
      <PinInput label="Same again" value={again} onChange={(v) => (setAgain(v), setError(null))} onEnter={submit} />
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      <div className="mt-5 flex gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-rule px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </button>
        <PrimaryButton onClick={submit} disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Save PIN & sign in'}
        </PrimaryButton>
      </div>
    </div>
  )
}

/**
 * New to the league: Sleeper username → code in your team name → name and PIN → wait
 * for the commissioner. See src/server/onboarding-service.ts.
 */
function NewMemberFlow({ onCancel }: { onCancel: () => void }) {
  const [username, setUsername] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function post(body: object) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.ok) setError(data.reason ?? 'Something went wrong')
      return data
    } catch {
      setError('Network error — try again')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function lookUp() {
    const d = await post({ action: 'challenge', provider: 'sleeper', username: username.trim() })
    if (d?.ok) setChallenge(d.data)
  }

  async function request() {
    if (pin !== again) {
      setError('Those two PINs do not match.')
      setAgain('')
      return
    }
    const d = await post({ action: 'request', token: challenge!.token, displayName, pin })
    if (d?.ok) setSent(d.data.displayName)
    else if (d && /expired/i.test(d.reason ?? '')) setChallenge(null)
  }

  const card = 'mt-8 rounded-xl border border-rule bg-slate-900 p-5'
  const field =
    'w-full rounded-lg border border-rule bg-slate-950 px-3 py-2.5 outline-none focus:border-emerald-500'

  if (sent) {
    return (
      <div className={card}>
        <div className="text-lg font-semibold">Request sent</div>
        <p className="mt-2 text-sm text-slate-300">
          The commissioner will add <span className="font-semibold">{sent}</span> to the league. Once
          they do, sign in here by picking your name and entering the PIN you just chose.
        </p>
        <p className="mt-2 text-sm text-slate-400">You can change your Sleeper team name back now.</p>
        <button
          onClick={onCancel}
          className="mt-5 rounded-lg border border-rule px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold">Join the league</div>
        <div className="flex gap-1 text-[10px] font-semibold uppercase tracking-wider">
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">Sleeper</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-500" title="Coming later">
            Yahoo · ESPN soon
          </span>
        </div>
      </div>

      {!challenge ? (
        <>
          <p className="mt-1 text-xs text-slate-500">
            We check that your Sleeper account is in this season’s league. Already have a seat? Go
            back and pick your name instead.
          </p>
          <label className="mt-5 block">
            <span className="mb-1 block text-xs text-slate-400">Sleeper username</span>
            <input
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              maxLength={60}
              onChange={(e) => (setUsername(e.target.value), setError(null))}
              onKeyDown={(e) => e.key === 'Enter' && username.trim() && lookUp()}
              className={field}
            />
          </label>
          {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
          <div className="mt-5 flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg border border-rule px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Back
            </button>
            <PrimaryButton onClick={lookUp} disabled={!username.trim() || busy}>
              {busy ? 'Checking…' : 'Continue'}
            </PrimaryButton>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            Found <span className="font-semibold text-slate-300">{challenge.username}</span> in the league.
            Now prove it’s you.
          </p>
          <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
            <div className="text-xs uppercase tracking-widest text-emerald-400">Your code</div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-wider">{challenge.code}</div>
            <div className="mt-1 text-xs text-slate-400">
              Good until {new Date(challenge.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-300">{challenge.instructions}</p>

          <label className="mt-5 block">
            <span className="mb-1 block text-xs text-slate-400">Your name on the board</span>
            <input
              value={displayName}
              maxLength={24}
              onChange={(e) => (setDisplayName(e.target.value), setError(null))}
              className={field}
            />
          </label>
          <PinInput label="Choose a 4-digit PIN" value={pin} onChange={(v) => (setPin(v), setError(null))} />
          <PinInput label="Same again" value={again} onChange={(v) => (setAgain(v), setError(null))} />

          {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => (setChallenge(null), setError(null))}
              className="rounded-lg border border-rule px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Back
            </button>
            <PrimaryButton
              onClick={request}
              disabled={busy || !displayName.trim() || pin.length !== 4 || again.length !== 4}
            >
              {busy ? 'Checking Sleeper…' : 'Verify & request a seat'}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  )
}
