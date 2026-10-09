import Link from 'next/link'
import type { HistoryMember } from '@/lib/history'
import { formatOdds, type PlayoffOdds } from '@/lib/playoff-odds'
import type { SeasonSoFar } from '@/lib/season-so-far'
import { MIN_SAMPLE, recordCell, type RecordPaths } from '@/lib/record-paths'
import { managerColor } from '@/lib/colors'

/**
 * Who is getting in: the rest of the regular season, simulated.
 *
 * Sorted by playoff odds, which is the only question the panel answers. The
 * record sits beside it because odds without the record read as an opinion;
 * the remaining schedule sits beside it because that is the half of the answer
 * the record cannot show.
 *
 * ⚠️ The percentages go through `formatOdds`, never `toFixed`. A simulation is
 * a sample of likely seasons, not every possible one, so ">99%" is as far as it
 * is allowed to go while a game remains — see the note there.
 */
export function PlayoffOddsPanel({
  odds,
  report,
  paths,
  members,
}: {
  odds: PlayoffOdds
  report: SeasonSoFar
  /** History for the "Since" column. Null draws no column. */
  paths: RecordPaths | null
  members: HistoryMember[]
}) {
  const since = paths && paths.seasons.length ? paths.seasons[0] : null
  const byId = new Map(members.map((m) => [m.managerId, m]))
  const record = new Map(report.rows.map((r) => [r.managerId, r]))
  const pct = (p: number) => formatOdds(p, odds.remainingWeeks)

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">Playoff odds</h2>
        {since !== null && (
          <Link href="/history/by-week" className="text-xs text-amber-300 hover:underline">
            How have teams at this record done? →
          </Link>
        )}
        <p className="text-xs text-slate-400">
          {odds.remainingWeeks === 0
            ? 'Regular season complete.'
            : `${odds.remainingWeeks} week${odds.remainingWeeks === 1 ? '' : 's'} left · top ${odds.playoffTeams} get in${
                odds.byes ? `, top ${odds.byes} get a bye` : ''
              }`}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Playoff odds through week {odds.throughWeek}: record, projected wins, strength of the
            remaining schedule, bye odds and playoff odds, one row per manager.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
              <th scope="col" className="px-2 py-2 text-left font-display">Manager</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Record</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Proj W</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Rem SOS</th>
              {since !== null && (
                <th
                  scope="col"
                  className="px-2 py-2 text-right font-display"
                  title={`Teams with this record after week ${odds.throughWeek} since ${since}: how many made the playoffs`}
                >
                  Since {since}
                </th>
              )}
              {odds.byes > 0 && (
                <th scope="col" className="border-l border-rule px-2 py-2 text-right font-display">Bye</th>
              )}
              <th scope="col" className="w-2/5 px-2 py-2 text-left font-display sm:w-1/3">Playoffs</th>
            </tr>
          </thead>
          <tbody>
            {odds.rows.map((r) => {
              const m = byId.get(r.managerId)
              const rec = record.get(r.managerId)
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
                    {rec ? `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''}` : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.projectedWins.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.remainingSos === null ? <span className="text-slate-600">—</span> : r.remainingSos.toFixed(1)}
                  </td>
                  {since !== null && (
                    <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                      <HistoryCount
                        cell={
                          rec && !rec.ties && paths
                            ? recordCell(paths, odds.throughWeek, rec.wins, rec.losses)
                            : undefined
                        }
                      />
                    </td>
                  )}
                  {odds.byes > 0 && (
                    <td className="border-l border-rule px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                      {pct(r.byePct)}
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums font-semibold">
                        {pct(r.playoffPct)}
                      </span>
                      <span aria-hidden className="h-1.5 flex-1 bg-slate-500/15">
                        <span
                          className="block h-full bg-amber-400/80"
                          style={{ width: `${(r.playoffPct * 100).toFixed(1)}%` }}
                        />
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 border-t border-rule pt-3 text-xs text-slate-400">
        The rest of the regular season played {odds.simulations.toLocaleString('en-US')} times
        against the real schedule. Each team scores around its average so far, pulled toward the
        league average while the sample is small, and seeds by wins then points for.{' '}
        <strong className="text-slate-300">Rem SOS</strong> is the expected weekly score of the
        opponents still to play — higher is harder. The median game is not counted: it does not
        decide a seed.
        {since !== null && (
          <>
            {' '}
            <strong className="text-slate-300">Since {since}</strong> is how many teams with the same
            record after the same week made it — grey under {MIN_SAMPLE} teams.
          </>
        )}
      </p>
    </section>
  )
}

/**
 * "6/15" — made it over teams. Grey below `MIN_SAMPLE`, and a dot when nobody
 * has ever been here: a record with no history is news, not a zero.
 */
function HistoryCount({ cell }: { cell: ReturnType<typeof recordCell> }) {
  if (!cell || cell.teams === 0) return <span className="text-slate-600">·</span>
  return (
    <span className={cell.teams < MIN_SAMPLE ? 'text-slate-500' : 'text-slate-300'}>
      {cell.made}/{cell.teams}
    </span>
  )
}
