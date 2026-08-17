'use client'

import type { SeasonSummary } from '@/server/archive-service'

/**
 * The year picker, shared by /board and /stats.
 *
 * Shown as soon as any season is on record, even before there is a second one:
 * with an archive in play, "which year am I looking at" is a real question, and
 * the current-season tab answers it.
 */
export function SeasonPicker({
  liveSeason,
  seasons,
  viewing,
  onSelect,
}: {
  liveSeason: number
  seasons: SeasonSummary[]
  /** null = the season being drafted now. */
  viewing: number | null
  onSelect: (season: number | null) => void
}) {
  if (seasons.length === 0) return null
  const past = seasons.filter((s) => !s.isCurrent)

  return (
    <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
      <SeasonTab
        label={`${liveSeason}`}
        sub="live"
        active={viewing === null}
        onClick={() => onSelect(null)}
      />
      {past.map((s) => (
        <SeasonTab
          key={s.season}
          label={`${s.season}`}
          sub={`${s.picks} picks`}
          active={viewing === s.season}
          onClick={() => onSelect(s.season)}
        />
      ))}
    </div>
  )
}

function SeasonTab({
  label,
  sub,
  active,
  onClick,
}: {
  label: string
  sub: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-left leading-tight ${
        active ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
      }`}
    >
      <span className="block text-xs font-semibold tabular-nums">{label}</span>
      <span className="block text-[10px] opacity-70">{sub}</span>
    </button>
  )
}
