'use client'

import { useState } from 'react'
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
 *
 * ## Sorting
 *
 * Every column sorts, because the interesting question changes by reader — most
 * titles, worst luck, best lineup setter. Clicking a header sorts descending
 * first, since for almost every column here "most" is the question; a second
 * click reverses.
 *
 * A **null always sorts last, in both directions.** Nulls here mean "no record
 * for this era", not "zero" — sorting a manager with no weekly data to the top
 * of "worst lineup efficiency" would be a confident wrong answer. The client
 * boundary starts here rather than at the page so the rest of `/history` stays a
 * Server Component that ships no JavaScript.
 */

type SortKey =
  | 'name' | 'titles' | 'money' | 'record' | 'winPct' | 'avgFinish' | 'avgPts'
  | 'pf' | 'pa' | 'diff' | 'playoffs' | 'playoffRec'
  | 'allPlay' | 'allPlayPct' | 'lineup' | 'hi' | 'lo' | 'plfPF' | 'plfPA'

/** Null means "no record", never zero — so it sorts last whichever way we go. */
const VALUE: Record<SortKey, (r: LeagueSummaryRow) => number | string | null> = {
  name: (r) => r.member.displayName.toLowerCase(),
  titles: (r) => r.allTime.titles,
  money: (r) => r.allTime.moneyWon,
  record: (r) => r.allTime.wins,
  winPct: (r) => r.allTime.winPct,
  avgFinish: (r) => r.allTime.avgFinish,
  avgPts: (r) => r.allTime.avgPointsFor,
  pf: (r) => r.allTime.pointsFor,
  pa: (r) => r.allTime.pointsAgainst,
  diff: (r) => r.allTime.differential,
  playoffs: (r) => r.allTime.playoffAppearances,
  playoffRec: (r) => r.allTime.playoffWinPct,
  allPlay: (r) => r.weekly?.allPlayWins ?? null,
  allPlayPct: (r) => r.weekly?.allPlayPct ?? null,
  lineup: (r) => r.weekly?.lineupEfficiency ?? null,
  hi: (r) => r.weekly?.highScoreWeeks ?? null,
  lo: (r) => r.weekly?.lowScoreWeeks ?? null,
  plfPF: (r) => r.weekly?.playoffPointsFor ?? null,
  plfPA: (r) => r.weekly?.playoffPointsAgainst ?? null,
}

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
  sortKey,
  sort,
  onSort,
  align = 'right',
}: {
  children: React.ReactNode
  className?: string
  title?: string
  sortKey?: SortKey
  sort?: { key: SortKey; dir: 'asc' | 'desc' }
  onSort?: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortKey && sort?.key === sortKey
  return (
    <th
      scope="col"
      title={title}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`px-2.5 py-2 align-bottom font-display text-[0.62rem] font-semibold uppercase leading-tight tracking-[0.08em] ${
        active ? 'text-slate-100' : 'text-slate-400'
      } text-${align} ${className}`}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={`w-full cursor-pointer uppercase hover:text-slate-100 text-${align}`}
        >
          {children}
          <span aria-hidden className={active ? 'text-amber-400' : 'text-transparent'}>
            {' '}
            {active && sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        </button>
      ) : (
        children
      )}
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
      <Num>{w ? w.playoffPointsFor.toFixed(0) : '—'}</Num>
      <Num>{w ? w.playoffPointsAgainst.toFixed(0) : '—'}</Num>
    </tr>
  )
}

export function LeagueSummaryTable({ report }: { report: LeagueSummaryReport }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'winPct',
    dir: 'desc',
  })

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' },
    )

  const rows = [...report.rows].sort((a, b) => {
    const va = VALUE[sort.key](a)
    const vb = VALUE[sort.key](b)
    // Nulls last in both directions: "no record for this era" is not a value to
    // be ranked, and floating it to the top would be a confident wrong answer.
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : va - Number(vb)
    return sort.dir === 'desc' ? -cmp : cmp
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-slate-950" />
            <th colSpan={11} className="px-2.5 pb-1 text-left">
              <EraBadge coverage={report.allTime} />
            </th>
            <th colSpan={7} className="border-l-2 border-rule-strong px-2.5 pb-1 text-left">
              <EraBadge coverage={report.weekly} />
            </th>
          </tr>
          <tr className="border-b border-rule-strong">
            <Head className="sticky left-0 z-10 bg-slate-950" align="left" sortKey="name" sort={sort} onSort={onSort}>Member</Head>
            {/* Titles reach back further than the record beside them. */}
            <Head
              title={`Championships, ${report.titles.from}–${report.titles.to}`}
              sortKey="titles"
              sort={sort}
              onSort={onSort}
            >
              🏆
            </Head>
            <Head title="Prize money won, all placings" sortKey="money" sort={sort} onSort={onSort}>Won</Head>
            <Head title="Cumulative regular-season record" sortKey="record" sort={sort} onSort={onSort}>Record</Head>
            <Head sortKey="winPct" sort={sort} onSort={onSort}>Win %</Head>
            <Head title="Average regular-season finish" sortKey="avgFinish" sort={sort} onSort={onSort}>Avg fin</Head>
            <Head title="Average points for, per season" sortKey="avgPts" sort={sort} onSort={onSort}>Avg pts</Head>
            <Head sortKey="pf" sort={sort} onSort={onSort}>PF</Head>
            <Head sortKey="pa" sort={sort} onSort={onSort}>PA</Head>
            <Head title="Points for minus points against" sortKey="diff" sort={sort} onSort={onSort}>Diff</Head>
            <Head title="Playoff appearances" sortKey="playoffs" sort={sort} onSort={onSort}>Plfs</Head>
            <Head
              title="Playoff record. Third-place games count; the fifth-place game does not"
              sortKey="playoffRec"
              sort={sort}
              onSort={onSort}
            >
              Plf rec
            </Head>

            <Head
              className="border-l-2 border-rule-strong"
              title="Record against the whole field, every week"
              sortKey="allPlay"
              sort={sort}
              onSort={onSort}
            >
              All-play
            </Head>
            <Head sortKey="allPlayPct" sort={sort} onSort={onSort}>AP %</Head>
            <Head title="Points started as a share of the best lineup available" sortKey="lineup" sort={sort} onSort={onSort}>Lineup</Head>
            <Head title="Weeks as the league's high scorer" sortKey="hi" sort={sort} onSort={onSort}>Hi</Head>
            <Head title="Weeks as the league's low scorer" sortKey="lo" sort={sort} onSort={onSort}>Lo</Head>
            <Head title="Playoff points for" sortKey="plfPF" sort={sort} onSort={onSort}>Plf PF</Head>
            <Head title="Playoff points against" sortKey="plfPA" sort={sort} onSort={onSort}>Plf PA</Head>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <Row key={row.member.managerId} row={row} rank={i + 1} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
