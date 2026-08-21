import { managerColor } from '@/lib/colors'
import { isPreview, type GazetteFacts, type PreviewFacts } from '@/lib/gazette'
import type { HistoryMember } from '@/lib/history'
import type { StoredIssue } from '@/server/gazette-service'

/**
 * One edition of The FantasyWorld Gazette, set as a newspaper.
 *
 * ## Everything here renders from the stored fact pack
 *
 * Not one figure below is queried live. `issue.facts` is the pack the model was
 * given at press time, and the tables are a pure function of it — which is what
 * makes it impossible for the column and the furniture beside it to disagree,
 * and what stops a Thursday stat correction silently moving a number in an issue
 * that was written on Tuesday. An issue is a printed artifact.
 *
 * ## Why it is set in columns
 *
 * Justified, hyphenated, with a hairline rule between columns. That combination
 * is most of the difference between a newspaper and a blog post; see the
 * `.newspaper` block in globals.css for the three declarations Tailwind has no
 * utilities for.
 */

const swatch = (members: HistoryMember[], name: string) => {
  const m = members.find((x) => x.displayName === name)
  return m ? managerColor(m.color) : 'transparent'
}

function Name({ members, name }: { members: HistoryMember[]; name: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span aria-hidden className="h-2.5 w-1" style={{ backgroundColor: swatch(members, name) }} />
      <span className="font-semibold">{name}</span>
    </span>
  )
}

/** A standing head, in the condensed gothic, over the heavy rule. */
function Head({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="rule-strong mb-2 pt-2 font-display text-[0.7rem] font-bold uppercase tracking-[0.16em] text-slate-400">
      {children}
    </h2>
  )
}

function Leader({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: string }) {
  return (
    <li className="py-1">
      <div className="leaders text-[0.8rem]">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono font-semibold tabular-nums">{value}</span>
      </div>
      {sub && <div className="mt-0.5 text-[0.68rem] text-slate-500">{sub}</div>}
    </li>
  )
}

/** ▲2 / ▼1 / — . Movement is the whole reason a ranking is interesting. */
function Move({ n }: { n: number | null }) {
  if (n === null) return <span className="text-slate-600">·</span>
  if (n === 0) return <span className="text-slate-600">—</span>
  return (
    <span className={n > 0 ? 'text-emerald-400' : 'text-rose-400'}>
      {n > 0 ? '▲' : '▼'}
      {Math.abs(n)}
    </span>
  )
}

export function Masthead({
  facts,
  issueTitle,
  lens,
  printedAt,
}: {
  facts: GazetteFacts | PreviewFacts
  issueTitle: string | null
  lens: string | null
  printedAt: string
}) {
  return (
    <header className="mb-6">
      <div className="rule-strong" />
      <h1 className="pt-3 text-center font-[family-name:var(--font-gazette)] text-3xl font-black tracking-tight text-slate-50 sm:text-5xl">
        The FantasyWorld Gazette
      </h1>
      {/*
        The named edition. `lens` is what Gordon actually reached for, which is
        not always the calendar's suggestion — the frame is meant to come out of
        the week's events, so what he chose is part of what the issue is.
      */}
      {issueTitle && (
        <p className="pb-3 pt-1 text-center font-[family-name:var(--font-gazette)] text-sm italic text-slate-400 sm:text-base">
          {facts.weekLabel} — &ldquo;{issueTitle}&rdquo;
        </p>
      )}
      <div className="rule-strong" />
      <div className="flex flex-wrap justify-between gap-2 border-b border-rule py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-slate-500">
        <span>
          Season {facts.season} · {facts.weekLabel}
        </span>
        {lens && <span className="text-amber-300">{lens}</span>}
        <span>Press time · {printedAt}</span>
      </div>
    </header>
  )
}

export function Column({ issue }: { issue: StoredIssue }) {
  const paragraphs = issue.columnText.split(/\n{2,}/).filter(Boolean)
  return (
    <article className="mb-8">
      <h2 className="font-[family-name:var(--font-gazette)] text-2xl font-bold leading-tight text-slate-50 sm:text-4xl">
        {issue.headline}
      </h2>
      <p className="mt-2 font-[family-name:var(--font-gazette)] text-base italic leading-snug text-slate-300 sm:text-lg">
        {issue.deck}
      </p>
      <p className="mt-3 border-y border-rule py-1 font-display text-[0.62rem] uppercase tracking-[0.18em] text-slate-500">
        By Gordon Applewhite · Staff
      </p>

      <div className="newspaper mt-4 text-[0.94rem] leading-relaxed text-slate-200 lg:columns-2 lg:gap-8 xl:columns-3">
        {paragraphs.map((p, i) => (
          <p key={i} className={`mb-4 ${i === 0 ? 'dropcap' : ''}`}>
            {p}
          </p>
        ))}
      </div>
    </article>
  )
}

/**
 * One note per manager, in the order the preview pack lists them.
 *
 * The preview's `gameNotes` are not games — there are none yet. The prompt asks
 * for one entry per entry in ROSTERS and in the same order, which is what makes
 * the index lookup below safe and is why the two must not be reordered
 * independently.
 */
function RosterNotes({
  issue,
  facts,
  members,
}: {
  issue: StoredIssue
  facts: PreviewFacts
  members: HistoryMember[]
}) {
  if (!issue.gameNotes.length) return null
  return (
    <section className="mb-8 break-inside-avoid">
      <Head>The auction, man by man</Head>
      <ul className="divide-y divide-rule">
        {issue.gameNotes.map((note, i) => {
          const r = facts.rosters[i]
          return (
            <li key={i} className="py-2.5">
              {r && (
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[0.7rem] tabular-nums text-slate-400">
                  <Name members={members} name={r.manager} />
                  <span className="text-slate-200">${r.spent}</span>
                  <span className="text-slate-600">·</span>
                  <span>{r.players} players</span>
                  {r.topBuy && (
                    <>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-300">
                        {r.topBuy.player} ${r.topBuy.price}
                      </span>
                    </>
                  )}
                  {r.unspent > 0 && (
                    <span className="uppercase tracking-[0.1em] text-amber-300">
                      ${r.unspent} unspent
                    </span>
                  )}
                </div>
              )}
              <p className="text-[0.86rem] leading-relaxed text-slate-300">{note}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function GameNotes({ issue, members }: { issue: StoredIssue; members: HistoryMember[] }) {
  if (isPreview(issue.facts)) {
    return <RosterNotes issue={issue} facts={issue.facts} members={members} />
  }
  const games = issue.facts.games
  if (!issue.gameNotes.length) return null
  return (
    <section className="mb-8 break-inside-avoid">
      <Head>The week, game by game</Head>
      <ul className="divide-y divide-rule">
        {issue.gameNotes.map((note, i) => {
          const g = games[i]
          return (
            <li key={i} className="py-2.5">
              {g && (
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[0.7rem] tabular-nums text-slate-400">
                  {g.winner && <Name members={members} name={g.winner} />}
                  <span className="text-slate-200">{g.winnerPoints.toFixed(2)}</span>
                  <span className="text-slate-600">d.</span>
                  {g.loser && <Name members={members} name={g.loser} />}
                  <span className="text-slate-200">{g.loserPoints.toFixed(2)}</span>
                  {g.decides && (
                    <span className="uppercase tracking-[0.1em] text-amber-300">{g.decides}</span>
                  )}
                </div>
              )}
              <p className="text-[0.86rem] leading-relaxed text-slate-300">{note}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** What ten men walked out of the room with. The preview's standings table. */
function PreviewTables({ facts, members }: { facts: PreviewFacts; members: HistoryMember[] }) {
  return (
    <div className="mb-8 grid gap-8 md:grid-cols-2">
      <section className="break-inside-avoid">
        <Head>The room, when it emptied</Head>
        <table className="w-full text-[0.72rem] tabular-nums">
          <thead>
            <tr className="text-left font-display uppercase tracking-[0.1em] text-slate-500">
              <th className="pb-1 font-medium">Manager</th>
              <th className="pb-1 text-right font-medium">Spent</th>
              <th className="pb-1 text-right font-medium">Left</th>
              <th className="pb-1 text-right font-medium">Top 30</th>
              <th className="pb-1 text-right font-medium">Biggest buy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {facts.rosters.map((r) => (
              <tr key={r.manager}>
                <td className="py-1">
                  <Name members={members} name={r.manager} />
                </td>
                <td className="py-1 text-right font-mono">${r.spent}</td>
                <td
                  className={`py-1 text-right font-mono ${r.unspent > 0 ? 'text-amber-300' : 'text-slate-600'}`}
                >
                  {r.unspent > 0 ? `$${r.unspent}` : '—'}
                </td>
                <td className="py-1 text-right font-mono">{r.topThirty}</td>
                <td className="py-1 text-right font-mono text-slate-400">
                  {r.topBuy ? `${r.topBuy.player} $${r.topBuy.price}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[0.66rem] text-slate-500">
          {/*
            Unspent money is called out in amber because in an auction it is the
            one number that is unambiguously a mistake — every dollar not spent
            was a player not bought, and there is no next round to save it for.
          */}
          Each man began with ${facts.budget} and {facts.rosterSize} slots to fill. Money left over
          is money that bought nobody. &ldquo;Top 30&rdquo; counts the pool&rsquo;s thirty
          best-ranked players.
        </p>
      </section>

      <section className="break-inside-avoid">
        <Head>Where the money went</Head>
        <table className="w-full text-[0.72rem] tabular-nums">
          <thead>
            <tr className="text-left font-display uppercase tracking-[0.1em] text-slate-500">
              <th className="pb-1 font-medium">Pos</th>
              <th className="pb-1 text-right font-medium">Spent</th>
              <th className="pb-1 text-right font-medium">Share</th>
              <th className="pb-1 text-right font-medium">Bought</th>
              <th className="pb-1 text-right font-medium">Priciest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {facts.byPosition.map((p) => (
              <tr key={p.position}>
                <td className="py-1 font-mono font-semibold text-slate-300">{p.position}</td>
                <td className="py-1 text-right font-mono">${p.spent}</td>
                <td className="py-1 text-right font-mono text-slate-400">{p.share}%</td>
                <td className="py-1 text-right font-mono text-slate-400">{p.players}</td>
                <td className="py-1 text-right font-mono text-slate-400">{p.top}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[0.66rem] text-slate-500">
          ${facts.spent} of a possible ${facts.budget * facts.rosters.length} changed hands across{' '}
          {facts.picks} picks.
        </p>
      </section>
    </div>
  )
}

export function Tables({
  facts,
  members,
}: {
  facts: GazetteFacts | PreviewFacts
  members: HistoryMember[]
}) {
  if (isPreview(facts)) return <PreviewTables facts={facts} members={members} />
  return (
    <div className="mb-8 grid gap-8 md:grid-cols-2">
      <section className="break-inside-avoid">
        <Head>Standings</Head>
        <table className="w-full text-[0.72rem] tabular-nums">
          <thead>
            <tr className="text-left font-display uppercase tracking-[0.1em] text-slate-500">
              <th className="pb-1 font-medium">#</th>
              <th className="pb-1 font-medium">Manager</th>
              <th className="pb-1 text-right font-medium">W-L</th>
              <th className="pb-1 text-right font-medium">PF</th>
              <th className="pb-1 text-right font-medium">Mv</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {facts.standings.map((r) => (
              <tr key={r.manager}>
                <td className="py-1 font-mono text-slate-500">{r.place}</td>
                <td className="py-1">
                  <Name members={members} name={r.manager} />
                </td>
                <td className="py-1 text-right font-mono">{r.record}</td>
                <td className="py-1 text-right font-mono">{r.pointsFor.toFixed(0)}</td>
                <td className="py-1 text-right font-mono">
                  <Move n={r.move} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="break-inside-avoid">
        <Head>Power rankings, with receipts</Head>
        <table className="w-full text-[0.72rem] tabular-nums">
          <thead>
            <tr className="text-left font-display uppercase tracking-[0.1em] text-slate-500">
              <th className="pb-1 font-medium">#</th>
              <th className="pb-1 font-medium">Manager</th>
              <th className="pb-1 text-right font-medium">All-play</th>
              <th className="pb-1 text-right font-medium">Eff</th>
              <th className="pb-1 text-right font-medium">Mv</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {facts.powerRankings.map((r) => (
              <tr key={r.manager}>
                <td className="py-1 font-mono text-slate-500">{r.rank}</td>
                <td className="py-1">
                  <Name members={members} name={r.manager} />
                </td>
                <td className="py-1 text-right font-mono">{r.allPlayRecord}</td>
                <td className="py-1 text-right font-mono">{r.efficiencyPct.toFixed(1)}%</td>
                <td className="py-1 text-right font-mono">
                  <Move n={r.move} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[0.66rem] text-slate-500">
          Ranked on record against the whole field, points scored, and how much of the best
          available lineup was actually started. The gap between this and the standings is the
          argument.
        </p>
      </section>
    </div>
  )
}

/** A purchase, as a leader line: who, for how much, and where the board had him. */
function BuyRow({
  members,
  buy,
}: {
  members: HistoryMember[]
  buy: PreviewFacts['priciest'][number]
}) {
  return (
    <li className="py-1.5">
      <div className="leaders text-[0.8rem]">
        <span className="text-slate-300">
          {buy.player}
          <span className="text-slate-500"> {buy.position}</span>
        </span>
        <span className="font-mono font-semibold tabular-nums">${buy.price}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[0.66rem] text-slate-500">
        <Name members={members} name={buy.manager} />
        {/*
          Null rank is "unranked", never rank zero — a Sleeper-seeded pool leaves
          plenty without one, and printing 0 would read as the best player alive.
        */}
        {/*
          The position rank is the honest comparison and the overall rank is not
          — this is a superflex league, so a quarterback's overall board rank
          says more about the format than about the price. Show the within-
          position pair when the pack scored it.
        */}
        {buy.boardPositionRank && buy.pricePositionRank ? (
          <span>
            {buy.position}
            {buy.boardPositionRank} on the board · {ordinalish(buy.pricePositionRank)} priciest{' '}
            {buy.position}
          </span>
        ) : (
          <span>{buy.rank === null ? 'unranked' : `board #${buy.rank}`}</span>
        )}
      </div>
    </li>
  )
}

/** 1st, 2nd, 3rd, 4th — for "the fourth priciest quarterback in the room". */
function ordinalish(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function PreviewFurniture({ facts, members }: { facts: PreviewFacts; members: HistoryMember[] }) {
  const last = facts.lastSeason
  return (
    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      <section className="break-inside-avoid">
        <Head>The most expensive men in the league</Head>
        <ul className="divide-y divide-rule">
          {facts.priciest.slice(0, 8).map((b) => (
            <BuyRow key={`${b.manager}-${b.player}`} members={members} buy={b} />
          ))}
        </ul>
      </section>

      {(facts.bargains.length > 0 || facts.reaches.length > 0) && (
        <section className="break-inside-avoid">
          <Head>The board, and the room</Head>
          {facts.bargains.length > 0 && (
            <>
              <p className="mb-1 font-display text-[0.62rem] uppercase tracking-[0.12em] text-emerald-400">
                Went cheap
              </p>
              <ul className="mb-3 divide-y divide-rule">
                {facts.bargains.slice(0, 4).map((b) => (
                  <BuyRow key={`b-${b.player}`} members={members} buy={b} />
                ))}
              </ul>
            </>
          )}
          {facts.reaches.length > 0 && (
            <>
              <p className="mb-1 font-display text-[0.62rem] uppercase tracking-[0.12em] text-rose-400">
                Went dear
              </p>
              <ul className="divide-y divide-rule">
                {facts.reaches.slice(0, 4).map((b) => (
                  <BuyRow key={`r-${b.player}`} members={members} buy={b} />
                ))}
              </ul>
            </>
          )}
          <p className="mt-1.5 text-[0.66rem] text-slate-500">
            Price against the board <em>within a position</em> — a quarterback measured against
            other quarterbacks, never against a running back. It is what the room thought, not a
            verdict; only December gives one of those.{' '}
            {facts.marketDiscipline.scored > 0 && (
              <>
                {facts.marketDiscipline.withinThree} of {facts.marketDiscipline.scored} scored picks
                landed within three places of the board.
              </>
            )}
          </p>
        </section>
      )}

      {facts.repeats.length > 0 && (
        <section className="break-inside-avoid">
          <Head>Bought again</Head>
          <ul className="divide-y divide-rule">
            {facts.repeats.slice(0, 8).map((r) => (
              <li key={`${r.manager}-${r.player}`} className="py-1.5">
                <div className="leaders text-[0.8rem]">
                  <span className="text-slate-300">{r.player}</span>
                  <span className="font-mono text-[0.7rem] tabular-nums text-slate-400">
                    {r.prices.map((p) => `$${p}`).join(' → ')}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[0.66rem] text-slate-500">
                  <Name members={members} name={r.manager} />
                  <span>{r.seasons.join(', ')}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[0.66rem] text-slate-500">
            {/*
              Matched on `sleeper_id`, the only player key that survives a pool
              re-import. A pick with no id is left out rather than guessed at.
            */}
            The same man, buying the same player, in more than one year.
          </p>
        </section>
      )}

      {last && (
        <section className="break-inside-avoid">
          {/*
            "Regular season", stated in the heading, because `place` here is the
            regular-season table and NOT the bracket. In 2025 Jack placed first
            and Gabes won the title; a heading that said "how 2025 finished"
            would print a first place beside the wrong man's name.
          */}
          <Head>
            {last.season} — the regular season
          </Head>
          <table className="w-full text-[0.72rem] tabular-nums">
            <tbody className="divide-y divide-rule">
              {last.standings.map((s) => (
                <tr key={s.manager}>
                  <td className="py-1 font-mono text-slate-500">{s.regularSeasonPlace}</td>
                  <td className="py-1">
                    <Name members={members} name={s.manager} />
                    {s.finish && (
                      <span
                        className={`ml-1.5 font-display text-[0.58rem] uppercase tracking-[0.1em] ${
                          s.finish === 'champion' ? 'text-amber-300' : 'text-slate-400'
                        }`}
                      >
                        {s.finish === 'champion' ? 'champ' : 'runner-up'}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right font-mono">{s.record}</td>
                  <td className="py-1 text-right font-mono text-slate-400">
                    {s.pointsFor.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {last.champion && (
            <p className="mt-1.5 text-[0.66rem] text-slate-500">
              The table is the regular season; {last.champion} won the title
              {last.runnerUp && `, beating ${last.runnerUp}`}. None of it carries forward — this is
              not a keeper league.
            </p>
          )}
        </section>
      )}

      <section className="break-inside-avoid">
        <Head>Who these men are</Head>
        <ul className="divide-y divide-rule">
          {[...facts.careers]
            .sort((a, b) => b.titles - a.titles || a.manager.localeCompare(b.manager))
            .map((c) => (
              <Leader
                key={c.manager}
                label={<Name members={members} name={c.manager} />}
                value={c.record}
                sub={[
                  c.titles > 0
                    ? `${c.titles} title${c.titles === 1 ? '' : 's'}`
                    : 'no titles on record',
                  // Null drought means never won, which is not a drought of zero.
                  c.titleDrought === null
                    ? null
                    : `${c.titleDrought} season${c.titleDrought === 1 ? '' : 's'} since`,
                  `${c.seasons} seasons`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
        </ul>
      </section>

      {facts.milestones.length > 0 && (
        <section className="break-inside-avoid">
          <Head>On the doorstep</Head>
          <ul className="divide-y divide-rule">
            {facts.milestones.map((m, i) => (
              <Leader
                key={i}
                label={
                  <span>
                    <Name members={members} name={m.manager} />
                    <span className="text-slate-400"> · {m.label}</span>
                  </span>
                }
                value={m.crossed ? '✓' : `${m.away} away`}
                sub={m.coverage.label}
              />
            ))}
          </ul>
          <p className="mt-1.5 text-[0.66rem] text-slate-500">
            Career marks a man reaches this season by turning up. Nothing here has been crossed —
            the season has not started.
          </p>
        </section>
      )}

      <section className="break-inside-avoid">
        <Head>The particulars</Head>
        <ul className="divide-y divide-rule">
          {facts.city && (
            <Leader
              label="Drafted in"
              value={facts.state ? `${facts.city}, ${facts.state}` : facts.city}
            />
          )}
          {/* Null is unknown, never free, and never "no bet". */}
          {facts.buyIn !== null && <Leader label="Buy-in" value={`$${facts.buyIn}`} />}
          {facts.sideBet !== null && (
            <Leader label="Weekly side bet" value={`$${facts.sideBet}`} sub="low scorer pays high" />
          )}
          <Leader label="Players bought" value={facts.picks} />
          <Leader label="Total spend" value={`$${facts.spent}`} />
        </ul>
      </section>
    </div>
  )
}

export function Furniture({
  facts,
  members,
}: {
  facts: GazetteFacts | PreviewFacts
  members: HistoryMember[]
}) {
  if (isPreview(facts)) return <PreviewFurniture facts={facts} members={members} />
  const belt = facts.belt
  return (
    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      <section className="break-inside-avoid">
        <Head>Against the field</Head>
        <ul className="divide-y divide-rule">
          {facts.againstTheField.map((r) => (
            <Leader
              key={r.manager}
              label={<Name members={members} name={r.manager} />}
              value={`${r.record}  ·  ${r.points.toFixed(2)}`}
            />
          ))}
        </ul>
        <p className="mt-1.5 text-[0.66rem] text-slate-500">
          How everyone would have done against all nine opponents, not just the one they drew.
        </p>
      </section>

      <section className="break-inside-avoid">
        <Head>The Ledger</Head>
        <ul className="divide-y divide-rule">
          {facts.ledger.map((r) => (
            <Leader
              key={r.manager}
              label={
                <span className="inline-flex items-baseline gap-2">
                  <Name members={members} name={r.manager} />
                  {r.thisWeek && (
                    <span
                      className={`font-display text-[0.6rem] uppercase tracking-[0.1em] ${
                        r.thisWeek === 'high' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {r.thisWeek}
                    </span>
                  )}
                </span>
              }
              value={
                r.net === null ? (
                  <span className="text-slate-300">
                    {r.highWeeks}H / {r.lowWeeks}L
                  </span>
                ) : (
                  <span className={r.net < 0 ? 'text-rose-400' : r.net > 0 ? 'text-emerald-400' : ''}>
                    {r.net < 0 ? '−' : ''}${Math.abs(r.net)}
                  </span>
                )
              }
              sub={r.net === null ? undefined : `${r.highWeeks} high, ${r.lowWeeks} low`}
            />
          ))}
        </ul>
        <p className="mt-1.5 text-[0.66rem] text-slate-500">
          {facts.sideBet === null
            ? 'Counts only — no rate on record for this season, and unknown is not the same as nothing.'
            : `The low scorer pays the high scorer $${facts.sideBet}. Season to date.`}
        </p>
      </section>

      {belt && (
        <section className="break-inside-avoid">
          <Head>The Belt</Head>
          <p className="text-lg">
            <Name members={members} name={belt.manager} />
          </p>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-slate-300">{belt.reason}.</p>
          <ul className="mt-2 divide-y divide-rule">
            <Leader label="Weeks held, running" value={belt.heldFor} />
            {belt.previousHolder && <Leader label="Taken from" value={belt.previousHolder} />}
            {belt.mostWeeks && (
              <Leader
                label="Most weeks this season"
                value={`${belt.mostWeeks.manager} · ${belt.mostWeeks.weeks}`}
              />
            )}
          </ul>
        </section>
      )}

      {facts.milestones.length > 0 && (
        <section className="break-inside-avoid">
          <Head>Milestone watch</Head>
          <ul className="divide-y divide-rule">
            {facts.milestones.map((m, i) => (
              <Leader
                key={i}
                label={
                  <span>
                    <Name members={members} name={m.manager} />
                    <span className="text-slate-400"> · {m.label}</span>
                  </span>
                }
                value={m.crossed ? '✓' : `${m.away} away`}
                sub={m.coverage.label}
              />
            ))}
          </ul>
        </section>
      )}

      {facts.thisWeekInHistory.length > 0 && (
        <section className="break-inside-avoid">
          <Head>This week in history</Head>
          <ul className="divide-y divide-rule">
            {facts.thisWeekInHistory.map((h) => (
              <li key={h.season} className="py-1.5">
                <div className="text-[0.8rem] text-slate-300">{h.claim}</div>
                <div className="mt-0.5 font-mono text-[0.66rem] text-slate-500">{h.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(facts.recordBook.length > 0 || facts.rivalry.length > 0) && (
        <section className="break-inside-avoid">
          <Head>The record, and the grudges</Head>
          <ul className="divide-y divide-rule">
            {facts.recordBook.map((r, i) => (
              <li key={`r${i}`} className="py-1.5">
                <div className="text-[0.8rem] text-slate-300">
                  {r.claim}
                  {r.nearMiss && <span className="text-slate-500"> (near miss)</span>}
                </div>
                <div className="mt-0.5 font-mono text-[0.66rem] text-slate-500">{r.detail}</div>
              </li>
            ))}
            {facts.rivalry.map((r, i) => (
              <li key={`v${i}`} className="py-1.5">
                <div className="text-[0.8rem] text-slate-300">{r.claim}</div>
                <div className="mt-0.5 font-mono text-[0.66rem] text-slate-500">{r.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {facts.stats.length > 0 && (
        <section className="break-inside-avoid">
          <Head>Stat of the week</Head>
          <ul className="divide-y divide-rule">
            {facts.stats.slice(0, 4).map((s) => (
              <li key={s.id} className="py-1.5">
                <div className="text-[0.8rem] text-slate-300">{s.claim}</div>
                <div className="mt-0.5 font-mono text-[0.66rem] text-slate-500">{s.detail}</div>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[0.66rem] text-slate-500">
            Ranked by how unusual each is against its own history, so a bust and a streak can be
            weighed against each other.
          </p>
        </section>
      )}
    </div>
  )
}
