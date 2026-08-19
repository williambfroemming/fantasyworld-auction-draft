import { managerColor } from '@/lib/colors'
import type { HistoryMember, SeasonReview } from '@/lib/history'
import type { BestPickup } from '@/server/history-service'

/**
 * One season at a glance.
 *
 * A standings-era season yields a champion, a regular-season winner and nothing
 * else — and the card says so rather than leaving blank rows that read as
 * missing data. "Not recorded that way" and "we lost it" are different claims.
 */

function Who({ id, members }: { id: number | null; members: HistoryMember[] }) {
  const m = members.find((x) => x.managerId === id)
  if (!m) return <span className="text-slate-500">—</span>
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-1 shrink-0 self-center"
        style={{ backgroundColor: managerColor(m.color) }}
      />
      <span className="font-semibold text-slate-300">{m.displayName}</span>
    </span>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="leaders text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="shrink-0">{children}</span>
    </div>
  )
}

export function SeasonReviewCard({
  review,
  members,
  pickups = [],
}: {
  review: SeasonReview
  members: HistoryMember[]
  /** Best players nobody rostered in week 1. Empty before the weekly era. */
  pickups?: BestPickup[]
}) {
  const r = review
  const place = (v: number | null) => <Who id={v} members={members} />
  const score = (
    entry: SeasonReview['highestScore'],
    suffix?: (e: NonNullable<SeasonReview['highestScore']>) => string,
  ) =>
    entry ? (
      <span className="flex items-baseline gap-2">
        <span className="font-mono font-semibold tabular-nums">{entry.value.toFixed(2)}</span>
        <Who id={entry.managerId} members={members} />
        {suffix && <span className="text-[0.7rem] text-slate-500">{suffix(entry)}</span>}
      </span>
    ) : (
      <span className="text-slate-500">—</span>
    )

  return (
    <section className="border border-rule p-3">
      <header className="mb-2 flex items-baseline justify-between gap-2 border-b border-rule-strong pb-1.5">
        <h3 className="font-display text-base font-bold tracking-[0.06em]">{r.season}</h3>
        {r.city && (
          <span className="text-[0.7rem] uppercase tracking-[0.1em] text-slate-500">
            {r.city}
            {r.state ? `, ${r.state}` : ''}
          </span>
        )}
      </header>

      {/*
        A legacy season has a champion and literally nothing else. Rendering the
        other three rows as em-dashes filled the card with absence and made a
        complete record look like a broken one.
      */}
      <div className="space-y-0.5">
        <Line label="🏆 Champion">{place(r.champion)}</Line>
        {r.dataTier !== 'legacy' && (
          <>
            <Line label="🥈 Runner-up">{place(r.runnerUp)}</Line>
            <Line label="🥉 Third">{place(r.third)}</Line>
            <Line label="👑 Regular season">{place(r.regularSeasonWinner)}</Line>
          </>
        )}
      </div>

      {r.dataTier === 'weekly' ? (
        <div className="mt-2 space-y-0.5 border-t border-rule pt-2">
          <Line label="⚡ Highest score">{score(r.highestScore, (e) => `wk ${e.week}`)}</Line>
          <Line label="💩 Lowest score">{score(r.lowestScore, (e) => `wk ${e.week}`)}</Line>
          <Line label="💣 Biggest blowout">{score(r.biggestBlowout, (e) => `wk ${e.week}`)}</Line>
          <Line label="😰 Closest game">{score(r.closestGame, (e) => `wk ${e.week}`)}</Line>
          <Line label="📈 Most consistent">
            {r.mostConsistent ? (
              <span className="flex items-baseline gap-2">
                <Who id={r.mostConsistent.managerId} members={members} />
                <span className="font-mono text-[0.7rem] text-slate-500 tabular-nums">
                  σ {r.mostConsistent.stdev.toFixed(1)}
                </span>
              </span>
            ) : (
              <span className="text-slate-500">—</span>
            )}
          </Line>
          <Line label="🎰 Most volatile">
            {r.mostVolatile ? (
              <span className="flex items-baseline gap-2">
                <Who id={r.mostVolatile.managerId} members={members} />
                <span className="font-mono text-[0.7rem] text-slate-500 tabular-nums">
                  σ {r.mostVolatile.stdev.toFixed(1)}
                </span>
              </span>
            ) : (
              <span className="text-slate-500">—</span>
            )}
          </Line>
        </div>
      ) : null}

      {/*
        The waiver wire's greatest hits. "Not on a week-1 roster" means NOBODY
        in the league had them at kickoff — a player dropped by one team and
        claimed by another is a trade of sorts; a player nobody owned is a find.
        Ranked by points STARTED, because points on your bench won nothing.
      */}
      {pickups.length > 0 && (
        <div className="mt-2 border-t border-rule pt-2">
          <h4 className="mb-1 font-display text-[0.6rem] uppercase tracking-[0.12em] text-slate-500">
            Best pickups
          </h4>
          <ul className="space-y-1">
            {pickups.map((p) => (
              <li key={p.playerId}>
                <div className="leaders text-[0.8rem]">
                  <span className="text-slate-300">
                    {p.playerName}
                    {p.position && (
                      <span className="ml-1 font-mono text-[0.62rem] text-slate-600">
                        {p.position}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono font-semibold tabular-nums">
                    {p.pointsStarted.toFixed(0)}
                  </span>
                </div>
                {/*
                  One owner is the common case and reads as a single line. Two or
                  more is the interesting one — whoever found them and whoever
                  cashed in are rarely the same person — so each share is shown
                  rather than the player being credited to one manager.
                */}
                <ul className="pl-2 text-[0.68rem] text-slate-500">
                  {p.owners.map((o) => (
                    <li key={o.managerId} className="flex items-baseline gap-1.5">
                      <Who id={o.managerId} members={members} />
                      <span className="font-mono tabular-nums">
                        {o.pointsStarted.toFixed(0)} pts · {o.weeksStarted} start
                        {o.weeksStarted === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
