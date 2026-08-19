import { managerColor } from '@/lib/colors'
import type { LeagueSummaryReport, LeagueSummaryRow } from '@/lib/history'
import { EraBadge } from './EraBadge'

/**
 * The all-time member table.
 *
 * Two column groups, divided by a heavy rule and each headed by its own
 * `EraBadge`: everything left of the rule spans every season with a record,
 * everything right of it only the seasons with week-level data. The divider is
 * the point of the layout — it is what stops a reader adding a career win total
 * to an all-play record.
 *
 * The manager column is sticky because the table is wider than any screen, and a
 * row of figures with the name scrolled off is unreadable.
 */

const pct = (n: number | null) => (n === null ? '—' : n.toFixed(3).replace(/^0/, ''))
const money = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString()}`)
const one = (n: number | null) => (n === null ? '—' : n.toFixed(1))
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`

function Num({
  children,
  className = '',
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <td title={title} className={`px-2.5 py-1.5 text-right font-mono text-xs tabular-nums ${className}`}>
      {children}
    </td>
  )
}

function Head({
  children,
  className = '',
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <th
      scope="col"
      title={title}
      className={`px-2.5 py-2 text-right align-bottom font-display text-[0.62rem] font-semibold uppercase leading-tight tracking-[0.08em] text-slate-400 ${className}`}
    >
      {children}
    </th>
  )
}

function Row({ row, rank }: { row: LeagueSummaryRow; rank: number }) {
  const { member, allTime: a, weekly: w } = row
  const color = managerColor(member.color)
  return (
    <tr className="border-t border-rule hover:bg-slate-900/60">
      <th
        scope="row"
        className="sticky left-0 z-10 bg-slate-950 px-3 py-1.5 text-left font-semibold"
      >
        <span className="flex items-baseline gap-2">
          <span className="w-4 text-right font-mono text-[0.65rem] text-slate-500 tabular-nums">{rank}</span>
          <span aria-hidden className="h-3 w-1 shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm">{member.displayName}</span>
        </span>
      </th>

      <Num className={a.titles ? 'font-semibold text-amber-400' : 'text-slate-500'}>
        {a.titles || '—'}
      </Num>
      <Num title={a.moneyUnknownSeasons.length ? `unknown for ${a.moneyUnknownSeasons.join(', ')}` : undefined}>
        {money(a.moneyWon)}
      </Num>
      <Num>{`${a.wins}-${a.losses}${a.ties ? `-${a.ties}` : ''}`}</Num>
      <Num>{pct(a.winPct)}</Num>
      <Num>{one(a.avgFinish)}</Num>
      <Num>{a.avgPointsFor === null ? '—' : a.avgPointsFor.toFixed(0)}</Num>
      <Num>{a.pointsFor.toFixed(0)}</Num>
      <Num>{a.pointsAgainst.toFixed(0)}</Num>
      <Num className={a.differential >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
        {signed(a.differential)}
      </Num>
      <Num>{a.playoffAppearances || '—'}</Num>
      <Num>{a.playoffWins + a.playoffLosses ? `${a.playoffWins}-${a.playoffLosses}` : '—'}</Num>

      {/* ---- the era divider ---- */}
      <Num className="border-l-2 border-rule-strong">
        {w ? `${w.allPlayWins}-${w.allPlayLosses}${w.allPlayTies ? `-${w.allPlayTies}` : ''}` : '—'}
      </Num>
      <Num>{w ? pct(w.allPlayPct) : '—'}</Num>
      <Num>{w?.lineupEfficiency == null ? '—' : `${(w.lineupEfficiency * 100).toFixed(1)}%`}</Num>
      <Num className={w && w.highScoreWeeks ? 'text-emerald-400' : ''}>{w?.highScoreWeeks || '—'}</Num>
      <Num className={w && w.lowScoreWeeks ? 'text-rose-400' : ''}>{w?.lowScoreWeeks || '—'}</Num>
      <Num
        className={
          w?.highLowNet == null ? 'text-slate-500' : w.highLowNet >= 0 ? 'text-emerald-400' : 'text-rose-400'
        }
      >
        {w?.highLowNet == null ? '—' : `${w.highLowNet < 0 ? '−' : ''}$${Math.abs(w.highLowNet)}`}
      </Num>
      <Num>{w ? w.playoffPointsFor.toFixed(0) : '—'}</Num>
      <Num>{w ? w.playoffPointsAgainst.toFixed(0) : '—'}</Num>
    </tr>
  )
}

export function LeagueSummaryTable({ report }: { report: LeagueSummaryReport }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-slate-950" />
            <th colSpan={11} className="px-2.5 pb-1 text-left">
              <EraBadge coverage={report.allTime} />
            </th>
            <th colSpan={8} className="border-l-2 border-rule-strong px-2.5 pb-1 text-left">
              <EraBadge coverage={report.weekly} />
            </th>
          </tr>
          <tr className="border-b border-rule-strong">
            <Head className="sticky left-0 z-10 bg-slate-950 text-left">Member</Head>
            <Head title="Championships">🏆</Head>
            <Head title="Prize money won, all placings">Won</Head>
            <Head title="Cumulative regular-season record">Record</Head>
            <Head>Win %</Head>
            <Head title="Average regular-season finish">Avg fin</Head>
            <Head title="Average points for, per season">Avg pts</Head>
            <Head>PF</Head>
            <Head>PA</Head>
            <Head title="Points for minus points against">Diff</Head>
            <Head title="Playoff appearances">Plfs</Head>
            <Head title="Playoff record. Third-place games count; the fifth-place game does not">
              Plf rec
            </Head>

            <Head className="border-l-2 border-rule-strong" title="Record against the whole field, every week">
              All-play
            </Head>
            <Head>AP %</Head>
            <Head title="Points started as a share of the best lineup available">Lineup</Head>
            <Head title="Weeks as the league's high scorer">Hi</Head>
            <Head title="Weeks as the league's low scorer">Lo</Head>
            <Head title="Net from the weekly high/low side bet">Net</Head>
            <Head title="Playoff points for">Plf PF</Head>
            <Head title="Playoff points against">Plf PA</Head>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, i) => (
            <Row key={row.member.managerId} row={row} rank={i + 1} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
