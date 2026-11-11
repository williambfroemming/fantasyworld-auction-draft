'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'

export interface FilterPreset {
  label: string
  from: number
  to: number
}

/**
 * Pick the years a page of charts covers.
 *
 * The window lives in the URL (`?from=2020&to=2025`), so a filtered view can be linked and
 * survives a reload, and the server recomputes every chart for it. The full range carries no
 * parameters at all. Choosing a From later than the To drags the To up to match (and a To
 * earlier than the From drags the From down), so the window is never empty or reversed.
 */
export function ChartFilter({
  seasons,
  from,
  to,
  presets,
}: {
  /** Every season that can be chosen, ascending. */
  seasons: number[]
  /** The window currently shown. */
  from: number
  to: number
  presets: FilterPreset[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const first = seasons[0]
  const last = seasons[seasons.length - 1]

  function go(nextFrom: number, nextTo: number) {
    const lo = Math.min(nextFrom, nextTo)
    const hi = Math.max(nextFrom, nextTo)
    const url = lo === first && hi === last ? pathname : `${pathname}?from=${lo}&to=${hi}`
    start(() => router.push(url, { scroll: false }))
  }

  const select =
    'border border-rule bg-transparent px-2 py-1 font-mono text-xs text-slate-200 disabled:opacity-60'

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule pb-3 ${
        pending ? 'opacity-60' : ''
      }`}
      aria-busy={pending}
    >
      <span className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-slate-400">
        Years
      </span>
      <label className="flex items-center gap-1.5 text-xs text-slate-400">
        From
        <select
          className={select}
          value={from}
          onChange={(e) => go(Number(e.target.value), Math.max(Number(e.target.value), to))}
          aria-label="First year to show"
        >
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-slate-400">
        To
        <select
          className={select}
          value={to}
          onChange={(e) => go(Math.min(Number(e.target.value), from), Number(e.target.value))}
          aria-label="Last year to show"
        >
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <span className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = p.from === from && p.to === to
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => go(p.from, p.to)}
              aria-pressed={active}
              className={`border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition ${
                active
                  ? 'border-slate-400 bg-slate-800 text-slate-100'
                  : 'border-rule text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </span>
    </div>
  )
}
