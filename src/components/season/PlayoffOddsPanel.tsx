import Link from 'next/link'
import type { HistoryMember } from '@/lib/history'
import { formatOdds, type PlayoffOdds } from '@/lib/playoff-odds'
import type { SeasonSoFar } from '@/lib/season-so-far'
import { MIN_SAMPLE, recordCell, type RecordPaths } from '@/lib/record-paths'
import { managerColor } from '@/lib/colors'
import { GlossaryLink } from '../GlossaryLink'
import { ColumnKey } from '../ColumnKey'

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
  // The leverage column only exists while a game remains to be played.
  const hasLeverage = odds.rows.some((r) => r.leverage !== null)

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
        <h2 className="flex items-baseline gap-2 font-display text-sm font-bold uppercase tracking-[0.1em]">
          Playoff odds
          <GlossaryLink anchor="playoff-odds" label="playoff odds" />
        </h2>
        {since !== null && (
          <Link href="/history/by-week" className="text-xs text-amber-300 hover:underline">
            Past teams at each record →
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
            remaining schedule, bye odds, title odds, what their next game is worth, the spread of
            seeds they could land in, and playoff odds, one row per manager.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
              <th scope="col" className="px-2 py-2 text-left font-display">Manager</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Record</th>
              <th scope="col" className="px-2 py-2 text-right font-display">Proj W</th>
              <th
                scope="col"
                className="px-2 py-2 text-right font-display"
                title="Remaining strength of schedule: the expected weekly score of opponents still to play"
              >
                Rem SOS
              </th>
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
              <th scope="col" className="border-l border-rule px-2 py-2 text-right font-display">Title</th>
              {hasLeverage && (
                <th
                  scope="col"
                  className="px-2 py-2 text-right font-display"
                  title="Playoff odds if they win their next game / if they lose it"
                >
                  If W / L
                </th>
              )}
              <th scope="col" className="px-2 py-2 text-left font-display" title="Share of simulations finishing in each seed, first to last">
                Seeds
              </th>
              <th scope="col" className="w-2/5 px-2 py-2 text-left font-display sm:w-1/4">Playoffs</th>
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
                  <td className="border-l border-rule px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {pct(r.titlePct)}
                  </td>
                  {hasLeverage && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                      {r.leverage ? (
                        <>
                          <span className="text-emerald-400">{pct(r.leverage.ifWin)}</span>
                          <span className="text-slate-600"> / </span>
                          <span className="text-rose-400">{pct(r.leverage.ifLose)}</span>
                        </>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <SeedStrip seedPct={r.seedPct} playoffTeams={odds.playoffTeams} byes={odds.byes} pct={pct} />
                  </td>
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

      {/*
        A key, not an essay. How the simulation works, why the bracket is fixed
        and why If W / L overstates a game are in the glossary, behind the `?`.
      */}
      <ColumnKey
        lead={`${odds.simulations.toLocaleString('en-US')} simulations of the remaining schedule`}
        items={[
          ['Rem SOS', 'opponents’ average score, higher is harder'],
          since !== null && [`Since ${since}`, 'teams at this record who made it'],
          hasLeverage && ['If W / L', 'odds after a win or loss next week'],
          ['Seeds', 'chance of each seed, 1st to last'],
        ]}
      />
    </section>
  )
}

/** 1 -> 1st, 2 -> 2nd … */
const ordinal = (n: number) =>
  `${n}${['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? 'th'}`

/**
 * One thin cell per seed, shaded by how likely that seed is. The playoff seeds are amber
 * (the byes outlined), the rest grey, so the eye sees at once how much of a team's weight
 * sits above the cut line. Shade is the square root of the share, so a 5% seed is still
 * visible next to a 40% one. The numbers are in the label, not only the colour.
 */
function SeedStrip({
  seedPct,
  playoffTeams,
  byes,
  pct,
}: {
  seedPct: number[]
  playoffTeams: number
  byes: number
  pct: (p: number) => string
}) {
  const label = `Seed odds: ${seedPct.map((p, i) => `${ordinal(i + 1)} ${pct(p)}`).join(', ')}`
  return (
    <span role="img" aria-label={label} title={label} className="flex h-3 w-24 gap-px">
      {seedPct.map((p, i) => (
        <span
          key={i}
          className={`h-full flex-1 ${i < byes ? 'outline outline-1 -outline-offset-1 outline-amber-300/70' : ''}`}
          style={{
            backgroundColor: i < playoffTeams ? 'var(--a-400)' : 'var(--s-500)',
            opacity: p === 0 ? 0.08 : 0.15 + 0.85 * Math.sqrt(p),
          }}
        />
      ))}
    </span>
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
