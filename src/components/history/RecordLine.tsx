import { managerColor } from '@/lib/colors'
import type { HistoryMember, RecordEntry } from '@/lib/history'
import { EraBadge } from './EraBadge'

/**
 * One line of the record book, in the leader-dot style the broadsheet uses.
 *
 * `format` is passed in because the value's meaning changes by record — 234.96
 * is points, 8 is a streak, 4000 is dollars — and a component that guessed from
 * the number would eventually guess wrong.
 */
export function RecordLine({
  record,
  members,
  format,
  showEra = false,
}: {
  record: RecordEntry
  members: HistoryMember[]
  format?: (value: number) => string
  showEra?: boolean
}) {
  const who = members.find((m) => m.managerId === record.managerId)
  const against = members.find((m) => m.managerId === record.opponentManagerId)

  const when = [
    record.week === null ? null : `wk ${record.week}`,
    String(record.season),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="py-1.5">
      <div className="leaders text-sm">
        <span className="text-slate-300">{record.label}</span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="font-mono font-semibold tabular-nums">
            {record.display ?? (format ? format(record.value) : record.value.toFixed(2))}
          </span>
          {who && (
            <span className="flex items-baseline gap-1.5">
              <span aria-hidden className="h-2.5 w-1" style={{ backgroundColor: managerColor(who.color) }} />
              <span className="font-semibold">{who.displayName}</span>
            </span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 pl-0 text-[0.7rem] text-slate-500">
        <span className="font-mono tabular-nums">{when}</span>
        {against && <span>vs {against.displayName}</span>}
        {record.detail && <span>· {record.detail}</span>}
        {showEra && <EraBadge coverage={record.coverage} className="ml-auto" />}
      </div>
    </li>
  )
}
