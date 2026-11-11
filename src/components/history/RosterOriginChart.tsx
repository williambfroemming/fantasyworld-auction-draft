import { StackedBar } from '@/components/charts/StackedBar'
import { CHART_INKS, INK_FAINT } from '@/components/charts/colors'
import type { HistoryMember } from '@/lib/history'
import {
  ORIGIN_LABELS,
  visibleParts,
  type OriginPart,
  type RosterOrigin,
} from '@/lib/roster-origin'

export const ORIGIN_COLORS: Record<OriginPart, string> = {
  drafted: CHART_INKS[0],
  tradedAtDraft: CHART_INKS[3],
  addedLater: CHART_INKS[1],
  unknown: INK_FAINT,
}

/**
 * How one season's started points were built, one bar per manager (src/lib/roster-origin.ts).
 * Bars are shares of that manager's own started points; the exact points are in the chart's
 * table. Parts that are empty for the whole league are left out of the bars and the legend.
 */
export function RosterOriginChart({
  origin,
  members,
}: {
  origin: RosterOrigin[]
  members: HistoryMember[]
}) {
  const parts = visibleParts(origin)
  const rows = [...origin]
    .sort((a, b) => b.drafted / (b.total || 1) - a.drafted / (a.total || 1))
    .map((o) => ({
      id: String(o.managerId),
      label: members.find((m) => m.managerId === o.managerId)?.displayName ?? String(o.managerId),
      segments: parts.map((p) => ({
        key: p,
        label: ORIGIN_LABELS[p],
        value: o[p],
        color: ORIGIN_COLORS[p],
      })),
    }))
  return (
    <StackedBar
      rows={rows}
      ariaLabel="Share of each manager's started points that came from players they drafted, traded for at the draft, or added later"
      format={{ decimals: 0, suffix: ' pts' }}
    />
  )
}
