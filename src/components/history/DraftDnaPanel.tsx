import { GlossaryLink } from '../GlossaryLink'
import { SPEND_SEGMENTS_BY_POSITION } from '@/lib/colors'
import type { DraftDna, DraftDnaCareer, DraftDnaSeason } from '@/lib/draft-dna'
import type { SpendColumn } from '@/lib/stats'

/**
 * How one manager drafts, one auction per row.
 *
 * A **table plus a bar**, rather than one or the other. The bar answers the
 * question at a glance — is this a barbell or an even spread — and the columns
 * answer it precisely, which is what someone reaches for once they have decided
 * to argue about it. Everything here is a share rather than a dollar figure on
 * purpose: the point of the section is *shape*, and the money totals are already
 * in the season table directly above it.
 *
 * `—` throughout for unknown. A season with no points on record has no verdict,
 * and 0 would read as "broke even".
 */
export function DraftDnaPanel({ dna }: { dna: DraftDna }) {
  if (dna.seasons.length === 0) {
    return <p className="py-2 text-sm text-slate-500">No auctions on record yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule">
            <th className="px-2 py-1.5 text-left font-display text-[0.6rem] uppercase tracking-[0.08em] text-slate-400">
              Season
            </th>
            <th className="min-w-[9rem] px-2 py-1.5 text-left font-display text-[0.6rem] uppercase tracking-[0.08em] text-slate-400">
              Where the money went
            </th>
            {(
              [
                ['Spent', 'Total paid at that auction'],
                ['Top 3', 'Share of their spend in their three priciest buys'],
                ['$1s', 'Picks bought at the minimum'],
                ['Half by', 'How far into the draft they had spent half their money'],
                ['+/−', 'Places their picks beat the price they paid, summed'],
              ] as const
            ).map(([h, title]) => (
              <th
                key={h}
                title={title}
                className="px-2 py-1.5 text-right font-display text-[0.6rem] uppercase tracking-[0.08em] text-slate-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dna.seasons.map((s) => (
            <Row key={s.season} row={s} />
          ))}
        </tbody>
        <tfoot>
          <Row row={dna.career} spent={dna.seasons.reduce((s, x) => s + x.spent, 0)} />
        </tfoot>
      </table>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {SPEND_SEGMENTS_BY_POSITION.map((seg) => (
          <li key={seg.key} className="flex items-center gap-1 text-[0.65rem] text-slate-500">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-[1px]"
              style={{ backgroundColor: seg.hex }}
            />
            {seg.label}
          </li>
        ))}
        <li className="ml-auto">
          <GlossaryLink anchor="draft-dna" label="draft DNA" />
        </li>
      </ul>
    </div>
  )
}

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`)

/**
 * One season, or the career line.
 *
 * The career row is the same shape rather than a bespoke summary because the
 * only interesting thing about it is how each season sits against it, and that
 * comparison is easiest when the columns line up exactly.
 */
function Row({ row, spent }: { row: DraftDnaSeason | DraftDnaCareer; spent?: number }) {
  const career = !('season' in row)
  return (
    <tr className={career ? 'border-t-2 border-rule-strong' : 'border-b border-rule/60'}>
      <td
        className={`px-2 py-1.5 font-mono tabular-nums ${career ? 'text-slate-400' : ''}`}
      >
        {career ? `${row.seasons} yrs` : row.season}
      </td>
      <td className="px-2 py-1.5">
        <SplitBar
          spend={row.positionSpend}
          total={career ? (spent ?? 0) : (row as DraftDnaSeason).spent}
        />
      </td>
      {/* A real total on the career row, not an em dash. Everywhere else in the
          app "—" means unknown, and the sum of five auctions is known. */}
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-400">
        ${career ? (spent ?? 0).toLocaleString() : (row as DraftDnaSeason).spent}
      </td>
      <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">
        {pct(row.topThreeShare)}
      </td>
      {/* A real 0, not an em dash: "they never took a minimum-bid flier" is a
          fact about how they draft, and "—" is reserved for unknown. */}
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-400">
        {row.dollarPicks}
      </td>
      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-400">
        {pct(row.halfwayFraction)}
      </td>
      <td
        className={`px-2 py-1.5 text-right font-mono font-semibold tabular-nums ${
          row.placesGained === null
            ? 'text-slate-600'
            : row.placesGained > 0
              ? 'text-emerald-400'
              : row.placesGained < 0
                ? 'text-rose-400'
                : 'text-slate-400'
        }`}
      >
        {row.placesGained === null
          ? '—'
          : `${row.placesGained > 0 ? '+' : ''}${row.placesGained}`}
      </td>
    </tr>
  )
}

/**
 * Proportion, not magnitude — each bar fills its own width. It says how the
 * money was split, not how much of it there was; the Spent column answers that,
 * and scaling these against a career peak would flatten a cheap season into a
 * sliver for no gain.
 *
 * ## The tooltip is CSS, not `title`
 *
 * A native `title` waits about a second before appearing, which is far longer
 * than anyone holds a cursor over a 6px sliver — the dollars would effectively
 * not be there. A `group-hover` span shows instantly, can be styled to match
 * the page, and still needs no JavaScript, so this stays a Server Component.
 * `title` is kept alongside it for touch and for anyone tabbing through.
 *
 * ⚠️ It hangs **below** the bar, not above. The table sits in an
 * `overflow-x-auto` wrapper so a narrow screen can scroll it sideways, and CSS
 * gives you no way to keep `overflow-y` visible while `overflow-x` is auto —
 * the used value becomes auto too, so that wrapper clips vertically. Above the
 * first row, the tooltip cleared the wrapper's top edge by six pixels, which is
 * a rendering accident rather than a layout. Below, every row has the next row
 * under it and the last has the legend, so there is always room.
 */
function SplitBar({
  spend,
  total,
}: {
  spend: Record<SpendColumn, number>
  total: number
}) {
  if (total <= 0) return <div className="h-3" />

  return (
    // `overflow-visible` so the tooltip can escape the bar; the rounded ends
    // are on the segments themselves via first/last-child instead.
    <div className="relative flex h-3 gap-px rounded-full">
      {SPEND_SEGMENTS_BY_POSITION.map((seg) => {
        const dollars = spend[seg.key as SpendColumn] ?? 0
        if (dollars === 0) return null
        const pct = (dollars / total) * 100
        return (
          <span
            key={seg.key}
            className="group relative h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${pct}%`, backgroundColor: seg.hex }}
            title={`${seg.label} $${dollars} — ${Math.round(pct)}%`}
          >
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute top-full left-1/2 z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-rule-strong bg-slate-950 px-1.5 py-1 font-mono text-[0.65rem] tabular-nums text-slate-100 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100"
            >
              <span style={{ color: seg.hex }}>{seg.label}</span> ${dollars} ·{' '}
              {Math.round(pct)}%
            </span>
          </span>
        )
      })}
    </div>
  )
}
