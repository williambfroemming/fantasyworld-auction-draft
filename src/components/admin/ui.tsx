'use client'

/**
 * The admin panel's shared furniture: one card, one button, two inputs, and the
 * single `act()` every section posts through.
 *
 * `act()` lives in AdminPanel and is passed down, so there is exactly one busy
 * flag and one message line for the whole page. Two sections each holding their
 * own would let a second click land while the first is still in flight.
 */

export type ActResult = { ok: true; data?: unknown } | { ok: false; reason: string }

/**
 * Post one action to `/api/commish`.
 *
 * `ok` is the message shown on success — a string, or a function of the
 * response data for the actions that hand something back (a new PIN, a pick
 * number). `confirm`, when given, is asked first and cancelling sends nothing.
 */
export type Act = (
  body: Record<string, unknown>,
  ok: string | ((data: unknown) => string),
  confirm?: string,
) => Promise<ActResult | null>

export function Section({
  id,
  title,
  note,
  children,
}: {
  id?: string
  title: string
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-6 scroll-mt-4 rounded-xl border border-rule bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">{title}</h2>
      {note && <p className="mb-3 mt-1 text-xs text-slate-500">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

const TONES = {
  neutral: 'bg-slate-800 hover:bg-slate-700 text-slate-200',
  primary: 'bg-slate-100 hover:bg-slate-50 text-slate-900',
  go: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  warn: 'bg-amber-600 hover:bg-amber-500 text-white',
  danger: 'bg-rose-700 hover:bg-rose-600 text-white',
  ghost: 'border border-rule hover:bg-slate-800 text-slate-200',
} as const

export function Btn({
  children,
  onClick,
  disabled,
  tone = 'neutral',
  size = 'md',
  className = '',
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: keyof typeof TONES
  size?: 'sm' | 'md'
  className?: string
  type?: 'button' | 'submit'
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${pad} ${TONES[tone]} ${className}`}
    >
      {children}
    </button>
  )
}

/** Whole dollars only. Empty stays empty — callers decide whether that is null. */
export function NumberField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        inputMode="numeric"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="mt-1 w-full rounded-lg border border-rule bg-slate-950 px-3 py-2 text-center text-lg tabular-nums text-slate-100 placeholder:text-sm placeholder:text-slate-600 disabled:opacity-40"
      />
    </label>
  )
}

/**
 * Free text. Separate from NumberField on purpose: /setup used one digits-only
 * field for everything, so the "Draft city" box silently refused every letter.
 */
export function TextField({
  label,
  value,
  onChange,
  maxLength = 60,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  maxLength?: number
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-rule bg-slate-950 px-3 py-2 text-slate-100"
      />
    </label>
  )
}

/** '' → null (unknown), otherwise the number. Never '' → 0. */
export const dollarsOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v))
export const dollarsText = (v: number | null): string => (v === null ? '' : String(v))
