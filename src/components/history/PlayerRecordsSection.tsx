import { EraBadge } from '@/components/history/EraBadge'
import { managerColor } from '@/lib/colors'
import type { HistoryMember } from '@/lib/history'
import type { PlayerRecordBook, PlayerRecordList } from '@/lib/player-records'
import { STAT_RECORD_UNITS } from '@/lib/player-stat-records'
import type { PositionStatRecords } from '@/lib/player-stat-records'

const VALUE: Record<string, (n: number) => string> = {
  mostWeeksStarted: (n) => String(Math.round(n)),
}
const points = (n: number) => n.toFixed(1)

function List({ list, members }: { list: PlayerRecordList; members: HistoryMember[] }) {
  if (list.entries.length === 0) return null
  const unit = STAT_RECORD_UNITS[list.key]
  const fmt = unit
    ? (n: number) => `${n.toLocaleString('en-US')} ${unit}`
    : (VALUE[list.key] ?? points)
  return (
    <div className="min-w-0">
      <h3 className="mb-1 font-display text-[0.7rem] font-bold uppercase tracking-[0.1em] text-slate-300">
        {list.label}
      </h3>
      <ol className="space-y-1.5">
        {list.entries.map((e, i) => {
          const m = members.find((x) => x.managerId === e.managerId)
          return (
            <li key={`${e.season}-${e.week}-${e.managerId}-${e.playerId ?? i}`} className="text-sm">
              <div className="leaders">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="w-3 shrink-0 font-mono text-xs text-slate-500 tabular-nums">
                    {i + 1}
                  </span>
                  <span className={i === 0 ? 'font-semibold' : 'text-slate-300'}>
                    {e.playerName ?? (m ? `${m.displayName}'s bench` : 'Bench')}
                  </span>
                  {e.position && (
                    <span className="font-mono text-[0.62rem] text-slate-600">{e.position}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums">
                  {fmt(e.value)}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 pl-5 text-[0.7rem] text-slate-500">
                {m && (
                  <span className="flex items-baseline gap-1">
                    <span
                      aria-hidden
                      className="h-2 w-1 self-center"
                      style={{ backgroundColor: managerColor(m.color) }}
                    />
                    {m.displayName}
                  </span>
                )}
                <span className="font-mono tabular-nums">
                  {e.week === null ? e.season : `wk ${e.week} · ${e.season}`}
                </span>
                {e.detail && <span>· {e.detail}</span>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * Single weeks and seasons by individual players. Rostered players only, regular season,
 * 2020 on. Season totals are listed per position and never merged into one ranking.
 */
export function PlayerRecordsSection({
  book,
  members,
  statRecords = [],
}: {
  book: PlayerRecordBook
  members: HistoryMember[]
  /** NFL stat records, one block per position. Empty draws nothing. */
  statRecords?: PositionStatRecords[]
}) {
  if (book.seasons.length === 0) return null
  return (
    <section className="mt-10 min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">Players</h2>
        <EraBadge
          coverage={{
            from: book.seasons[0],
            to: book.seasons[book.seasons.length - 1],
            seasons: book.seasons,
            label: 'Rostered players',
          }}
        />
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Regular season, counted per manager, ranked within position.
      </p>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {book.records.map((l) => (
          <List key={l.key} list={l} members={members} />
        ))}
      </div>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {book.bySeasonPosition.map((l) => (
          <List key={l.key} list={l} members={members} />
        ))}
      </div>

      {statRecords.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5 font-display text-xs font-bold uppercase tracking-[0.1em] text-slate-300">
            NFL stat records
            <EraBadge
              coverage={{
                from: book.seasons[0],
                to: book.seasons[book.seasons.length - 1],
                seasons: book.seasons,
                label: 'Stat lines',
              }}
            />
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Regular season, while rostered here, within each position. Single games count starters only.
          </p>
          <div className="space-y-2">
            {statRecords.map((p, i) => (
              <details key={p.position} open={i === 0} className="border border-rule">
                <summary className="cursor-pointer select-none px-3 py-2 font-display text-xs font-bold uppercase tracking-[0.08em]">
                  {p.position}
                </summary>
                <div className="grid gap-6 px-3 pb-3 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                  {p.lists.map((l) => (
                    <List key={l.key} list={l} members={members} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
