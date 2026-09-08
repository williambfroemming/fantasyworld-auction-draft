import Link from 'next/link'
import type { HistoryMember } from '@/lib/history'
import type { SeasonSoFar } from '@/lib/season-so-far'
import { managerColor } from '@/lib/colors'

/**
 * The season in progress: the record, and then the columns that argue with it.
 *
 * ## The order of the columns is the argument
 *
 * Record first, because that is what everyone already knows and it is the thing
 * the rest is read *against*. Then all-play and versus-median, which are the
 * same season scored without a schedule; then luck and strength of schedule,
 * which explain the gap between the two; then efficiency, which is the only
 * column about decisions rather than outcomes.
 *
 * The rows are sorted by **all-play**, not by record. A table sorted by record
 * is the table Sleeper already shows, and re-sorting it here would quietly make
 * the honest columns decoration. The record is still drawn first; it is just not
 * what decides who is at the top.
 *
 * ## Everything says "through week N"
 *
 * ⚠️ Not a caption — a heading, and one that comes from the data rather than
 * from this file. Every number here is a rate over a partial season, which is
 * the bug that took "best regular-season record" off a 12-2 and gave it to a
 * 1-0. `throughWeek` rides on the report specifically so this component cannot
 * render without it.
 */
export function SeasonSoFarPanel({
  report,
  members,
  lead,
}: {
  report: SeasonSoFar
  members: HistoryMember[]
  /**
   * Drawn as the front page's lead rather than a panel within it.
   *
   * From the first completed week until a champion is crowned, this **replaces**
   * the reigning-champion monument at the top of `/`. The monument is right for
   * ten months of the year and wrong for the four that matter: a front page
   * still leading with last season's winner in November is showing the reader
   * the one thing about the league that cannot change until January.
   *
   * The champion is not deleted, only demoted — he keeps his place in the
   * ribbon directly below, and reclaims the lead automatically the moment the
   * new season has a champion of its own.
   */
  lead?: boolean
}) {
  const byId = new Map(members.map((m) => [m.managerId, m]))
  const pct = (n: number) => n.toFixed(3).replace(/^0/, '')
  /** Signed, because the sign is the entire content of a luck column. */
  const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))

  return (
    <section>
      {/*
        Two headings for two jobs. As the lead it takes the monument's type
        scale and rhythm so the top of the page does not visibly downgrade when
        the season starts; as a panel it is a section head like any other.

        Both say the week. The qualifier is never the optional half — see the
        note on `throughWeek` in the file header.
      */}
      {lead ? (
        <div className="mb-8">
          <p className="font-display text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
            {report.season} season
          </p>
          <h2 className="mt-3 font-display text-[clamp(2.5rem,9vw,6rem)] leading-[0.86] font-bold tracking-[-0.02em] text-slate-50">
            Through week {report.throughWeek}
          </h2>
          {/*
            The ONLY line allowed to appear under the heading, and only when it
            is not zero. It is a caveat about the figures rather than an
            explanation of them: a skipped week means these totals are counted
            over fewer games than the week number implies, which the reader
            cannot infer from anything else on the page. Everything that merely
            explained a column has been removed -- the glossary is one click
            away in the nav and at the foot of this page.
          */}
          {report.incompleteWeeks > 0 && (
            <p className="mt-5 text-sm text-slate-400">
              {report.incompleteWeeks} week{report.incompleteWeeks === 1 ? '' : 's'} not counted —
              the whole field did not play.
            </p>
          )}
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
          <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">
            {report.season} · through week {report.throughWeek}
          </h2>
          <p className="text-xs text-slate-400">
            Sorted by all-play, not by record.
            {report.incompleteWeeks > 0 && (
              <>
                {' '}
                {report.incompleteWeeks} week{report.incompleteWeeks === 1 ? '' : 's'} skipped —
                the whole field did not play.
              </>
            )}
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            The {report.season} season through week {report.throughWeek}: record, all-play
            record, record against the weekly league median, luck, strength of schedule and
            lineup efficiency, one row per manager.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
              <th scope="col" className="px-2 py-2 text-left font-display">Manager</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Record</th>
              <th scope="col" className="px-2 py-2 text-right font-display">PF</th>
              <th scope="col" className="border-l border-rule px-2 py-2 text-right font-display">All-play</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Pct</th>
              <th scope="col" className="px-2 py-2 text-right font-display">vs Median</th>
              <th scope="col" className="border-l border-rule px-2 py-2 text-right font-display">Luck</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Opp PPG</th>
              <th scope="col" className="border-l border-rule px-2 py-2 text-right font-display">Eff</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Hi/Lo</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => {
              const m = byId.get(r.managerId)
              return (
                <tr key={r.managerId} className="border-t border-rule even:bg-slate-500/[0.04]">
                  <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                    <Link
                      href={`/history/members/${r.managerId}`}
                      className="flex items-baseline gap-2 hover:text-amber-300"
                    >
                      <span
                        aria-hidden
                        className="h-3 w-1 shrink-0"
                        style={{ backgroundColor: managerColor(m?.color ?? '#888') }}
                      />
                      {m?.displayName ?? `#${r.managerId}`}
                    </Link>
                  </th>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {r.wins}-{r.losses}
                    {r.ties ? `-${r.ties}` : ''}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.pointsFor.toFixed(0)}
                  </td>
                  <td className="border-l border-rule px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {r.allPlayWins}-{r.allPlayLosses}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {pct(r.allPlayPct)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {r.medianWins}-{r.medianLosses}
                  </td>
                  {/*
                    The only coloured column, deliberately. Luck is the one
                    number here that has a good and a bad direction; every other
                    column is just a ranking, and tinting those would make the
                    table look like it was scoring people on six axes.
                  */}
                  <td
                    className={`border-l border-rule px-2 py-1.5 text-right font-mono text-xs tabular-nums ${
                      r.luck > 0.5 ? 'text-emerald-400' : r.luck < -0.5 ? 'text-rose-400' : 'text-slate-400'
                    }`}
                  >
                    {signed(r.luck)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.strengthOfSchedule.toFixed(1)}
                  </td>
                  {/*
                    An em dash, never 100%. A manager with no lineup on record
                    has not been proven perfect; he is unmeasured — the same rule
                    the injury badge follows for a null status.
                  */}
                  <td className="border-l border-rule px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {r.efficiency === null ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      `${(r.efficiency * 100).toFixed(0)}%`
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.highWeeks}/{r.lowWeeks}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/*
        The one piece of prose kept, and the distinction is worth stating: it
        defines the columns whose *names* do not define them. "Record" and "PF"
        need nothing; "Luck" and "Eff" are meaningless without a sentence, and a
        table with a column nobody can read is worse than a table with a
        footnote. The standfirst that used to sit under the heading went because
        it explained the page's argument rather than its columns — the argument
        is made by the sort order, not by being described.
      */}
      <p className="mt-3 border-t border-rule pt-3 text-xs text-slate-400">
        <strong className="text-slate-300">All-play</strong> is your record against every
        manager every week — the season without a schedule.{' '}
        <strong className="text-slate-300">Luck</strong> is wins minus what that all-play rate
        expected, so a positive number is a kind schedule rather than a good team.{' '}
        <strong className="text-slate-300">Eff</strong> is points started over points startable.{' '}
        <strong className="text-slate-300">Hi/Lo</strong> counts weeks as the league&rsquo;s top
        and bottom scorer
        {report.sideBet === null
          ? '.'
          : `, which is $${report.sideBet} a week between those two.`}
      </p>
    </section>
  )
}
