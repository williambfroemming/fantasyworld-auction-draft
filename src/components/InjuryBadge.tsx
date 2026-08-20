'use client'

import { injurySeverity } from '@/lib/sleeper'
import type { PlayerInjuryView } from '@/hooks/useDraft'

/**
 * "Is this guy hurt?" — answered on the row, without alt-tabbing (BACKLOG §1).
 *
 * ## Facts, not a verdict
 *
 * It shows Sleeper's own status and body part and stops there. `PROJECT_PLAN.md`
 * §4 keeps tiers and auction values off the board because they are one source's
 * opinion; "Questionable, hamstring" is a fact and belongs on screen, while
 * "fade him" is an opinion and does not. Severity picks a colour and a sort
 * order — it never becomes advice.
 *
 * ## Absence is not health
 *
 * This renders **nothing at all** when there is no status, and that is the
 * important case: a pool that has never had `npm run news:refresh` run against
 * it has null on every row. A green "healthy" tick would turn "we have no data"
 * into a confident wrong answer about the exact thing being asked, for 500
 * players at once. No badge means no claim.
 */
export function InjuryBadge({
  injury,
  size = 'sm',
}: {
  injury: PlayerInjuryView | null | undefined
  size?: 'sm' | 'lg'
}) {
  if (!injury?.status) return null

  const sev = injurySeverity(injury.status)
  const tint =
    sev >= 3
      ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30'
      : sev === 2
        ? 'bg-orange-500/15 text-orange-300 ring-orange-500/30'
        : 'bg-amber-500/15 text-amber-300 ring-amber-500/30'

  // Detail is the useful half — "Questionable" alone is nearly content-free,
  // while "Questionable · Knee - ACL" is the thing that changes a bid.
  const detail = [injury.bodyPart, injury.practice].filter(Boolean).join(' · ')
  const full = [injury.status, detail].filter(Boolean).join(' · ')

  return (
    <span
      title={
        full +
        (injury.notes ? ` — ${injury.notes}` : '') +
        (injury.updatedAt ? `\n(as of ${new Date(injury.updatedAt).toLocaleString()})` : '')
      }
      aria-label={`Injury: ${full}`}
      className={`shrink-0 rounded ring-1 font-bold tabular-nums ${tint} ${
        size === 'lg' ? 'px-2 py-0.5 text-xs' : 'px-1 py-px text-[10px]'
      }`}
    >
      {size === 'lg' ? full : shortLabel(injury.status)}
    </span>
  )
}

/**
 * The one- or two-letter form for a dense row.
 *
 * Falls back to the first two characters of whatever Sleeper sent rather than
 * to a fixed placeholder — an unrecognised status still shows *something*
 * specific, and the full text is in the tooltip and the drawer either way.
 */
function shortLabel(status: string): string {
  const s = status.trim().toUpperCase()
  const known: Record<string, string> = {
    QUESTIONABLE: 'Q',
    DOUBTFUL: 'D',
    OUT: 'OUT',
    IR: 'IR',
    PUP: 'PUP',
    NFI: 'NFI',
    SUS: 'SUS',
    NA: 'NA',
  }
  return known[s] ?? s.slice(0, 3)
}
