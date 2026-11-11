import Link from 'next/link'
import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import { managerColor } from '@/lib/colors'
import type { FaabSeason } from '@/lib/faab'
import type { HistoryMember } from '@/lib/history'

/**
 * Waiver money left, ten managers, for the season in progress. The number is always printed;
 * the bar is a second encoding of the same figure, scaled to the budget. Sorted by what is
 * left, most first, because the question this answers is "who can still make a real bid".
 *
 * Remaining counts completed claims only and includes FAAB moved in trades, so it can sit
 * above the budget (src/lib/faab.ts).
 */
export function FaabLeftPanel({ faab, members }: { faab: FaabSeason; members: HistoryMember[] }) {
  const byId = new Map(members.map((m) => [m.managerId, m]))
  const rows = [...faab.managers].sort((a, b) => b.remaining - a.remaining)
  const scale = Math.max(faab.budget, ...rows.map((r) => r.remaining))
  return (
    <section className="min-w-0">
      <h2 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
        <span className="flex items-baseline gap-2">
          FAAB left
          <GlossaryLink anchor="faab-remaining" label="FAAB left" />
        </span>
        <EraBadge
          coverage={{
            from: faab.season,
            to: faab.season,
            seasons: [faab.season],
            label: 'Waivers',
          }}
        />
      </h2>
      <ul className="space-y-1">
        {rows.map((r) => {
          const m = byId.get(r.managerId)
          return (
            <li key={r.managerId} className="flex items-center gap-3 text-sm">
              <span className="flex w-28 shrink-0 items-baseline gap-1.5 sm:w-36">
                <span
                  aria-hidden
                  className="h-2.5 w-1 shrink-0 self-center"
                  style={{ backgroundColor: m ? managerColor(m.color) : 'var(--s-400)' }}
                />
                <span className="truncate font-semibold">
                  {m?.displayName ?? `#${r.managerId}`}
                </span>
              </span>
              <span
                aria-hidden
                className="h-2 min-w-0 flex-1 bg-slate-800"
                title={`${r.remaining} of ${r.budget}`}
              >
                <span
                  className="block h-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, (r.remaining / scale) * 100))}%`,
                    backgroundColor: 'var(--mgr-sky)',
                  }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono font-semibold tabular-nums">
                ${r.remaining}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        Completed claims and FAAB traded.{' '}
        <Link
          href={`/history/waivers?season=${faab.season}`}
          className="underline underline-offset-2 hover:text-slate-300"
        >
          Every claim and lost bid
        </Link>
      </p>
    </section>
  )
}
