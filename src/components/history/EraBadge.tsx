import type { Coverage } from '@/lib/history'

/**
 * The years a number covers, stated on the number.
 *
 * The most important component on these pages, and the reason it takes a
 * `Coverage` rather than a string: it **cannot be rendered without one existing**,
 * so a column of weekly-era figures cannot be dropped under an all-time heading
 * by accident.
 *
 * The league's own dashboard is what this is guarding against. It puts an
 * all-time career record (fifteen seasons) next to an all-play record (six) with
 * no marking, and its hidden records sheet disagrees with its front page about
 * the all-time high score because the two were computed over different eras.
 * Both numbers are right; neither says what it is.
 */
export function EraBadge({ coverage, className = '' }: { coverage: Coverage; className?: string }) {
  const span =
    coverage.from === null
      ? 'no seasons'
      : coverage.from === coverage.to
        ? String(coverage.from)
        : `${coverage.from}–${coverage.to}`

  return (
    <span
      className={`inline-flex items-baseline gap-1.5 whitespace-nowrap font-display text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-slate-400 ${className}`}
      title={`${coverage.label}: ${coverage.seasons.length} season${coverage.seasons.length === 1 ? '' : 's'}`}
    >
      <span>{coverage.label}</span>
      <span className="text-slate-500">·</span>
      <span className="font-mono tracking-normal tabular-nums">{span}</span>
    </span>
  )
}
