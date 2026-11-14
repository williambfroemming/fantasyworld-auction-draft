import Link from 'next/link'
import type { ReactNode } from 'react'
import type { HistoryMember } from '@/lib/history'
import { formatOdds } from '@/lib/playoff-odds'
import type {
  BracketGame,
  BracketSide,
  BracketTeam,
  PlayoffBracket,
  PlayoffPicture,
} from '@/lib/playoff-types'
import { managerColor } from '@/lib/colors'
import { GlossaryLink } from '../GlossaryLink'

/**
 * The front page's lead in weeks 15 to 17: the bracket, then a card for each
 * game being played this week.
 *
 * It draws what it is handed and derives nothing about who plays whom. The
 * pairings, the byes and the current round all come from `picture.bracket`
 * (docs/archive/PLAYOFF_MODE_ROADMAP.md, section 5), so this file cannot disagree with
 * the bracket derivation about the shape of the playoffs.
 *
 * ## Pending means pending
 *
 * A game being played this week shows the pairing and no score. Nothing on a
 * request path calls Sleeper; results arrive with the Tuesday import, and the
 * heading says so beside the week the page is true through.
 *
 * ## The odds
 *
 * ⚠️ Every percentage goes through `formatOdds`, never `toFixed`, for the
 * reason given there. A team that is out gets no number at all: elimination is
 * a fact, not a probability. `odds` is null once the bracket is decided, and
 * then nothing here prints a percentage.
 */
export function PlayoffBracketPanel({
  picture,
  members,
}: {
  picture: PlayoffPicture
  members: HistoryMember[]
}) {
  const { bracket, prizes } = picture
  const byId = new Map(members.map((m) => [m.managerId, m]))
  const teams = new Map(bracket.teams.map((t) => [t.managerId, t]))
  const name = (managerId: number) => byId.get(managerId)?.displayName ?? `#${managerId}`
  const color = (managerId: number) => managerColor(byId.get(managerId)?.color ?? '#888')

  const decided = bracket.currentRound === null
  const champion = decided ? bracket.championManagerId : null
  // No odds once the bracket is decided, whatever was passed in.
  const odds = decided ? null : picture.odds
  const pct = (p: number) => (odds ? formatOdds(p, odds.gamesRemaining) : null)
  const byeTitle = (id: number) => {
    const row = bracket.alive.includes(id) ? odds?.title.find((t) => t.managerId === id) : undefined
    return row ? pct(row.titlePct) : null
  }

  const current =
    bracket.currentRound === null
      ? []
      : (bracket.rounds[bracket.currentRound - 1] ?? [])
          .filter((g) => g.status === 'pending' && g.a.managerId !== null && g.b.managerId !== null)
          // The championship path first, the third-place game after it.
          .sort((x, y) => (x.placement ?? 0) - (y.placement ?? 0))

  const stakes = [
    prizes.champion !== null && `champion ${money(prizes.champion)}`,
    prizes.runnerUp !== null && `runner-up ${money(prizes.runnerUp)}`,
    prizes.third !== null && `third place ${money(prizes.third)}`,
  ].filter((s): s is string => s !== false)

  const chip = (managerId: number) => (
    <span aria-hidden className="h-3 w-1 shrink-0 self-center" style={{ backgroundColor: color(managerId) }} />
  )

  const teamLink = (managerId: number) => (
    <Link href={`/history/members/${managerId}`} className="min-w-0 truncate hover:text-amber-300">
      {name(managerId)}
    </Link>
  )

  /** One side of a game in the bracket: a team, or what the side is waiting on. */
  const sideRow = (game: BracketGame, side: BracketSide) => {
    if (side.managerId === null) {
      return (
        <div className="flex items-baseline gap-2 px-2 py-1.5 text-sm text-slate-500">
          <span className="w-4 shrink-0" />
          <span className="italic">{waitingLabel(bracket, game, side)}</span>
        </div>
      )
    }
    const lost = game.status === 'played' && game.winnerManagerId !== side.managerId
    const won = game.status === 'played' && game.winnerManagerId === side.managerId
    return (
      <div className={`flex items-baseline gap-2 px-2 py-1.5 text-sm ${lost ? 'opacity-50' : ''}`}>
        <span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-slate-500">
          {side.seed ?? ''}
        </span>
        {chip(side.managerId)}
        <span className={`flex min-w-0 flex-1 ${won ? 'font-bold' : 'font-semibold'}`}>
          {teamLink(side.managerId)}
        </span>
        {/* A score only on a played game. A pending game has none to show. */}
        {game.status === 'played' && side.points !== null && (
          <span className={`font-mono text-xs tabular-nums ${won ? 'font-semibold' : 'text-slate-400'}`}>
            {side.points.toFixed(2)}
          </span>
        )}
      </div>
    )
  }

  return (
    <section>
      {/* The lead heading takes the type scale of `SeasonSoFarPanel`'s lead. */}
      <div className="mb-8">
        <p className="font-display text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
          {bracket.season} season
        </p>
        <h2 className="mt-3 font-display text-[clamp(2.5rem,9vw,6rem)] leading-[0.86] font-bold tracking-[-0.02em] text-slate-50">
          The playoffs
        </h2>
        <p className="mt-5 text-sm text-slate-400">
          Through week {bracket.throughWeek}.{' '}
          {decided ? 'Every game has been played.' : 'Results arrive with Tuesday’s update.'}
        </p>
        {champion !== null && (
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Champion
            </span>
            <Link
              href={`/history/members/${champion}`}
              className="flex items-baseline gap-2 font-display text-3xl font-bold text-slate-50 hover:text-amber-300"
            >
              <span aria-hidden className="h-6 w-1.5 shrink-0 self-center" style={{ backgroundColor: color(champion) }} />
              {name(champion)}
            </Link>
          </p>
        )}
        {/* A prize not on record is not printed; with none on record there is no line. */}
        {stakes.length > 0 && (
          <p className="mt-2 text-sm text-slate-400">Prize money: {stakes.join(' · ')}.</p>
        )}
      </div>

      {/* One column per round on a wide screen, stacked on a phone. */}
      <div className="grid gap-x-6 gap-y-8 md:grid-cols-3">
        {bracket.rounds.map((games, i) => {
          const round = i + 1
          const week = games[0]?.week
          return (
            <div key={round} className="min-w-0">
              <h3 className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2 font-display text-sm font-bold uppercase tracking-[0.1em]">
                {roundName(round, bracket.rounds.length)}
                {week !== undefined && (
                  <span className="text-xs font-normal normal-case tracking-normal text-slate-400">
                    Week {week}
                  </span>
                )}
              </h3>
              <ul className="space-y-3">
                {games.map((g) => (
                  <li
                    key={g.id}
                    className={`border ${g.status === 'pending' ? 'border-rule-strong' : 'border-rule'}`}
                  >
                    <p className="flex items-baseline justify-between gap-2 border-b border-rule px-2 py-1 font-display text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
                      <span>{gameName(g, bracket.rounds.length)}</span>
                      <span className={g.status === 'pending' ? 'font-semibold text-amber-300' : ''}>
                        {STATUS_LABEL[g.status]}
                      </span>
                    </p>
                    <div className="divide-y divide-rule">
                      {sideRow(g, g.a)}
                      {sideRow(g, g.b)}
                    </div>
                  </li>
                ))}
                {round === 1 && bracket.byes.length > 0 && (
                  <li className="border border-rule">
                    <p className="flex items-baseline justify-between gap-2 border-b border-rule px-2 py-1 font-display text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
                      <span>First-round bye</span>
                      <span>No game</span>
                    </p>
                    <div className="divide-y divide-rule">
                      {bracket.byes.map((managerId) => (
                        <div key={managerId} className="flex items-baseline gap-2 px-2 py-1.5 text-sm">
                          <span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-slate-500">
                            {teams.get(managerId)?.seed ?? ''}
                          </span>
                          {chip(managerId)}
                          <span className="flex min-w-0 flex-1 font-semibold">{teamLink(managerId)}</span>
                          {/*
                            A bye team has no game this week and so no card, which
                            would leave the two favourites as the only teams alive
                            with no title figure anywhere on the page.
                          */}
                          <span className="text-xs text-slate-400">
                            {bracket.currentRound === 1 && byeTitle(managerId)
                              ? `Bye · title ${byeTitle(managerId)}`
                              : 'Bye'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </li>
                )}
              </ul>
            </div>
          )
        })}
      </div>

      {current.length > 0 && (
        <div className="mt-12">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
            <h3 className="flex items-baseline gap-2 font-display text-sm font-bold uppercase tracking-[0.1em]">
              This week’s games
              <GlossaryLink anchor="bracket-odds" label="win probability and title odds" />
            </h3>
            <p className="text-xs text-slate-400">
              Week {current[0].week} · no scores until Tuesday’s update
            </p>
          </div>
          <div className="grid items-start gap-6 md:grid-cols-2">
            {current.map((g) => {
              const a = g.a.managerId!
              const b = g.b.managerId!
              const third = g.placement === 3
              const win = odds?.games.find((x) => x.gameId === g.id)
              const pair = picture.pairs.find((p) => p.gameId === g.id)
              const context = (id: number) => picture.teams.find((t) => t.managerId === id)

              /** Title odds only for a team still able to win it. */
              const title = (id: number) => {
                if (third || !bracket.alive.includes(id)) return null
                const row = odds?.title.find((t) => t.managerId === id)
                return row ? pct(row.titlePct) : null
              }
              const lastFinal = (id: number) => {
                const last = context(id)?.lastFinal
                return last ? `${last.won ? 'Won' : 'Lost'}, ${last.season}` : null
              }
              const count = (n: number | undefined) => (n === undefined ? null : String(n))

              // A row with nothing on either side is not drawn.
              const rows: Array<[label: string, a: ReactNode, b: ReactNode]> = [
                ['Seed', g.a.seed, g.b.seed],
                ['Record', record(teams.get(a)), record(teams.get(b))],
                ['Points per game', perGame(teams.get(a)), perGame(teams.get(b))],
                [
                  'Win probability',
                  win ? pct(win.aWinPct) : null,
                  win ? pct(1 - win.aWinPct) : null,
                ],
                ['Title odds', title(a), title(b)],
                ...(third
                  ? []
                  : ([
                      ['Titles', count(context(a)?.titles), count(context(b)?.titles)],
                      [
                        'Past playoff appearances',
                        count(context(a)?.playoffAppearances),
                        count(context(b)?.playoffAppearances),
                      ],
                      ['Last final', lastFinal(a), lastFinal(b)],
                    ] satisfies Array<[string, ReactNode, ReactNode]>)),
              ]
              const drawn = rows.filter(([, x, y]) => x !== null || y !== null)
              const firstTitle = third ? [] : [a, b].filter((id) => context(id)?.titles === 0)

              return (
                <article key={g.id} className="min-w-0 border border-rule-strong">
                  <p className="flex items-baseline justify-between gap-2 border-b border-rule px-3 py-1.5 font-display text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
                    <span>
                      {gameName(g, bracket.rounds.length)} · week {g.week}
                    </span>
                    <span className="font-semibold text-amber-300">Pending</span>
                  </p>
                  <table className="w-full table-fixed border-collapse text-sm">
                    <caption className="sr-only">
                      {name(a)} against {name(b)}, {gameName(g, bracket.rounds.length).toLowerCase()}, week{' '}
                      {g.week}: one row per figure, one column per team.
                    </caption>
                    <thead>
                      <tr className="border-b border-rule">
                        <td className="w-[38%] px-3 py-2" />
                        {[a, b].map((id) => (
                          <th
                            key={id}
                            scope="col"
                            className={`px-3 py-2 text-right font-display font-bold ${third ? 'text-base' : 'text-lg'}`}
                          >
                            <span className="flex items-baseline justify-end gap-2">
                              {chip(id)}
                              {teamLink(id)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drawn.map(([label, x, y]) => (
                        <tr key={label} className="border-t border-rule">
                          <th scope="row" className="px-3 py-1.5 text-left text-xs font-normal text-slate-400">
                            {label}
                          </th>
                          <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">{x}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">{y}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* The win probability again, as a bar. The numbers are in the table. */}
                  {win && (
                    <div aria-hidden className="flex h-1.5 border-t border-rule">
                      <span style={{ width: `${(win.aWinPct * 100).toFixed(1)}%`, backgroundColor: color(a) }} />
                      <span className="flex-1" style={{ backgroundColor: color(b) }} />
                    </div>
                  )}
                  {(firstTitle.length > 0 || pair) && (
                    <ul className="space-y-1 border-t border-rule px-3 py-2.5 text-xs text-slate-400">
                      {firstTitle.map((id) => (
                        <li key={id}>
                          <span className="font-semibold text-slate-300">{name(id)}:</span> would be a first
                          title.
                        </li>
                      ))}
                      {pair && (
                        <li>
                          <span className="font-semibold text-slate-300">This season:</span>{' '}
                          {pair.thisSeason.length === 0
                            ? 'did not meet in the regular season.'
                            : pair.thisSeason
                                .map(
                                  (m) =>
                                    `week ${m.week}, ${name(a)} ${m.aPoints.toFixed(2)}, ${name(b)} ${m.bPoints.toFixed(2)}`,
                                )
                                .join('; ') + '.'}
                        </li>
                      )}
                      {pair && (
                        <li>
                          <span className="font-semibold text-slate-300">
                            {picture.playoffMeetingsSince === null
                              ? 'Playoff meetings:'
                              : `Playoff meetings since ${picture.playoffMeetingsSince}:`}
                          </span>{' '}
                          {pair.playoffMeetings.aWins + pair.playoffMeetings.bWins === 0
                            ? 'none on record.'
                            : `${name(a)} ${pair.playoffMeetings.aWins}, ${name(b)} ${pair.playoffMeetings.bWins}.`}
                          {pair.playoffMeetings.last &&
                            ` Last met in ${pair.playoffMeetings.last.season}, ${name(pair.playoffMeetings.last.winnerManagerId)} won.`}
                        </li>
                      )}
                    </ul>
                  )}
                </article>
              )
            })}
          </div>
          {odds && (
            <p className="mt-3 border-t border-rule pt-3 text-xs text-slate-500">
              {odds.simulations.toLocaleString('en-US')} simulations of the games left, from each
              team’s regular-season scoring.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

const STATUS_LABEL: Record<BracketGame['status'], string> = {
  played: 'Played',
  pending: 'Pending',
  waiting: 'Not set',
}

const ROUND_WORDS = ['one', 'two', 'three', 'four', 'five']

/** The column heading: the last round is the final, the one before it the semi-finals. */
function roundName(round: number, rounds: number) {
  if (round === rounds) return 'Final'
  if (round === rounds - 1) return 'Semi-finals'
  return `Round ${ROUND_WORDS[round - 1] ?? round}`
}

/** One game's label. The last round holds two games, so each is named for what it decides. */
function gameName(game: BracketGame, rounds: number) {
  if (game.placement === 3) return 'Third-place game'
  if (game.round === rounds) return 'Championship'
  if (game.round === rounds - 1) return 'Semi-final'
  return `Round ${ROUND_WORDS[game.round - 1] ?? game.round}`
}

/**
 * What to print on a side with no team yet.
 *
 * ⚠️ `winnerOf` is printed as a pairing only when the bracket really holds an
 * earlier championship-path game between those two seeds. Before the
 * semi-finals are set, the final's `winnerOf` is not a game anybody plays, and
 * "winner of 1 v 4" would be a confident wrong line. The third-place game is
 * never a "winner of": its sides are the semi-final losers.
 */
function waitingLabel(bracket: PlayoffBracket, game: BracketGame, side: BracketSide) {
  const rounds = bracket.rounds.length
  if (game.placement === 3) return rounds > 1 ? 'Semi-final loser' : 'To be decided'
  if (side.winnerOf) {
    const [lo, hi] = [...side.winnerOf].sort((x, y) => x - y)
    const feeder = bracket.rounds
      .slice(0, game.round - 1)
      .flat()
      .some(
        (g) =>
          g.placement === null &&
          g.a.seed !== null &&
          g.b.seed !== null &&
          Math.min(g.a.seed, g.b.seed) === lo &&
          Math.max(g.a.seed, g.b.seed) === hi,
      )
    if (feeder) return `Winner of ${lo} v ${hi}`
  }
  if (game.round === rounds && rounds > 1) return 'Semi-final winner'
  return 'To be decided'
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`

const record = (t: BracketTeam | undefined) =>
  t ? `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}` : null

/** Regular-season points per game. Null, not zero, for a team with no games. */
function perGame(t: BracketTeam | undefined) {
  if (!t) return null
  const games = t.wins + t.losses + t.ties
  return games > 0 ? (t.pointsFor / games).toFixed(1) : null
}
