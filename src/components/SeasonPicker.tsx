'use client'

import type { SeasonSummary } from '@/server/archive-service'

/**
 * The year picker, shared by /board and /stats.
 *
 * Shown as soon as any season is on record, even before there is a second one:
 * with an archive in play, "which year am I looking at" is a real question, and
 * the current-season tab answers it.
 *
 * ## Why a dropdown rather than a strip of tabs
 *
 * It was a tab per season, which is fine at two seasons and was already six
 * wide by 2026 — a control that grows by one every August, in a header that
 * also holds the site nav and five view tabs. Everything was competing at the
 * same weight and nothing said which control was the page and which was the
 * context it was being read in.
 *
 * A `<select>` is also the honest shape: the seasons are mutually exclusive
 * and there are eventually going to be twenty of them. It costs one click on
 * the way to a past year and gives the row back to the view tabs, which are the
 * thing people actually move between.
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
    <label className="flex items-center gap-1.5">
      <span className="sr-only">Season</span>
      <select
        value={viewing === null ? 'live' : String(viewing)}
        onChange={(e) => onSelect(e.target.value === 'live' ? null : Number(e.target.value))}
        className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums text-slate-100 hover:bg-slate-800"
      >
        <option value="live">{liveSeason} · live</option>
        {past.map((s) => (
          <option key={s.season} value={s.season}>
            {s.season} · {s.picks} picks
          </option>
        ))}
      </select>
    </label>
  )
}
