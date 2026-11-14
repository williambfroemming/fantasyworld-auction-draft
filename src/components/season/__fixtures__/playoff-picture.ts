import type { HistoryMember } from '@/lib/history'
import type {
  BracketGame,
  BracketSide,
  BracketTeam,
  PairContext,
  PlayoffBracket,
  PlayoffPicture,
  TeamContext,
} from '@/lib/playoff-types'

/**
 * Hand-written `PlayoffPicture` fixtures for `PlayoffBracketPanel`, one per
 * stage of the 2025 bracket (docs/PLAYOFF_MODE_ROADMAP.md, step 90).
 *
 * What is real: the six seeds, their records and points for, and every playoff
 * score. They are the 2025 season as checked in step 86.
 *
 * What is invented: every odds figure, the regular-season meetings, the playoff
 * history, the titles and the prize money. They are placeholders chosen to
 * exercise each branch of the panel (a first title, a last final won and lost,
 * a pair that has never met in the playoffs, a pair that met twice this season)
 * and must not be read as league history.
 */

const GABES = 1
const BILL = 4
const MARIO = 7
const JACK = 8
const BRYAN = 9
const JUSTIN = 10

/** The ten seats, with the colours the seat order hands out (`colorForSeat`). */
export const playoffFixtureMembers: HistoryMember[] = [
  { managerId: 1, name: 'Gabes', displayName: 'Gabes', color: '#f87171' },
  { managerId: 2, name: 'Grossman', displayName: 'Grossman', color: '#38bdf8' },
  { managerId: 3, name: 'Bolek', displayName: 'Bolek', color: '#fbbf24' },
  { managerId: 4, name: 'Bill', displayName: 'Bill', color: '#c084fc' },
  { managerId: 5, name: 'Daniel', displayName: 'Daniel', color: '#4ade80' },
  { managerId: 6, name: 'Nate', displayName: 'Nate', color: '#f472b6' },
  { managerId: 7, name: 'Mario', displayName: 'Mario', color: '#818cf8' },
  { managerId: 8, name: 'Jack', displayName: 'Jack', color: '#fb923c' },
  { managerId: 9, name: 'Bryan', displayName: 'Bryan', color: '#2dd4bf' },
  { managerId: 10, name: 'Justin', displayName: 'Justin', color: '#a3e635' },
]

const TEAMS: BracketTeam[] = [
  { managerId: JACK, seed: 1, wins: 9, losses: 5, ties: 0, pointsFor: 1820.38 },
  { managerId: GABES, seed: 2, wins: 9, losses: 5, ties: 0, pointsFor: 1795.42 },
  { managerId: MARIO, seed: 3, wins: 8, losses: 6, ties: 0, pointsFor: 1976.78 },
  { managerId: JUSTIN, seed: 4, wins: 8, losses: 6, ties: 0, pointsFor: 1799.42 },
  { managerId: BILL, seed: 5, wins: 7, losses: 7, ties: 0, pointsFor: 1826.74 },
  { managerId: BRYAN, seed: 6, wins: 7, losses: 7, ties: 0, pointsFor: 1785.66 },
]

const REGULAR_SEASON_WEEKS = 14

const seedOf = (managerId: number) => TEAMS.find((t) => t.managerId === managerId)!.seed

/** A side whose team is known. `points` is null until the game is played. */
const team = (managerId: number, points: number | null = null): BracketSide => ({
  managerId,
  seed: seedOf(managerId),
  points,
  winnerOf: null,
})

/** A side still waiting on a feeder game. */
const waiting = (winnerOf: [number, number] | null): BracketSide => ({
  managerId: null,
  seed: null,
  points: null,
  winnerOf,
})

function game(id: string, round: number, a: BracketSide, b: BracketSide, placement: null | 3 = null): BracketGame {
  const known = a.managerId !== null && b.managerId !== null
  const played = known && a.points !== null && b.points !== null
  return {
    id,
    round,
    week: REGULAR_SEASON_WEEKS + round,
    placement,
    a,
    b,
    status: played ? 'played' : known ? 'pending' : 'waiting',
    winnerManagerId: played ? (a.points! > b.points! ? a.managerId : b.managerId) : null,
  }
}

// Round one, played: Bill beat Justin, Bryan beat Mario.
const R1_PLAYED = [
  game('r1-g1', 1, team(JUSTIN, 129.7), team(BILL, 138.54)),
  game('r1-g2', 1, team(MARIO, 118.68), team(BRYAN, 133.12)),
]
// Semi-finals, played: Jack beat Bill, Gabes beat Bryan.
const R2_PLAYED = [
  game('r2-g1', 2, team(JACK, 135.5), team(BILL, 117.64)),
  game('r2-g2', 2, team(GABES, 142.8), team(BRYAN, 128.28)),
]

/** Invented. Titles, appearances and last finals in "earlier seasons". */
const TEAM_CONTEXT: TeamContext[] = [
  { managerId: JACK, titles: 2, playoffAppearances: 9, lastFinal: { season: 2022, won: true } },
  { managerId: GABES, titles: 0, playoffAppearances: 6, lastFinal: { season: 2019, won: false } },
  { managerId: MARIO, titles: 1, playoffAppearances: 8, lastFinal: { season: 2024, won: false } },
  { managerId: JUSTIN, titles: 3, playoffAppearances: 11, lastFinal: { season: 2023, won: true } },
  { managerId: BILL, titles: 0, playoffAppearances: 4, lastFinal: null },
  { managerId: BRYAN, titles: 1, playoffAppearances: 7, lastFinal: null },
]

const PRIZES = { champion: 2100, runnerUp: 600, third: 300 }

const bracket = (
  rounds: BracketGame[][],
  rest: Pick<PlayoffBracket, 'throughWeek' | 'currentRound' | 'alive' | 'championManagerId'>,
): PlayoffBracket => ({
  season: 2025,
  teams: TEAMS,
  byes: [JACK, GABES],
  rounds,
  ...rest,
})

/**
 * Through week 14: the field is set, round one is pending, the semi-finals wait
 * on it. The final and the third-place game carry `winnerOf: null`, the case the
 * panel has to draw without a pair to name.
 */
export const roundOnePending: PlayoffPicture = {
  bracket: bracket(
    [
      [game('r1-g1', 1, team(JUSTIN), team(BILL)), game('r1-g2', 1, team(MARIO), team(BRYAN))],
      [
        game('r2-g1', 2, team(JACK), waiting([4, 5])),
        game('r2-g2', 2, team(GABES), waiting([3, 6])),
      ],
      [
        game('r3-g1', 3, waiting(null), waiting(null)),
        game('r3-third', 3, waiting(null), waiting(null), 3),
      ],
    ],
    {
      throughWeek: 14,
      currentRound: 1,
      alive: [JACK, GABES, MARIO, JUSTIN, BILL, BRYAN],
      championManagerId: null,
    },
  ),
  odds: {
    simulations: 10000,
    gamesRemaining: 5,
    title: [
      { managerId: JACK, titlePct: 0.24 },
      { managerId: GABES, titlePct: 0.22 },
      { managerId: MARIO, titlePct: 0.21 },
      { managerId: JUSTIN, titlePct: 0.11 },
      { managerId: BILL, titlePct: 0.13 },
      { managerId: BRYAN, titlePct: 0.09 },
    ],
    games: [
      { gameId: 'r1-g1', aWinPct: 0.48 },
      { gameId: 'r1-g2', aWinPct: 0.61 },
    ],
  },
  teams: TEAM_CONTEXT,
  pairs: [
    {
      gameId: 'r1-g1',
      thisSeason: [{ week: 6, aPoints: 121.4, bPoints: 110.22 }],
      playoffMeetings: { aWins: 1, bWins: 2, last: { season: 2021, winnerManagerId: BILL } },
    },
    {
      gameId: 'r1-g2',
      thisSeason: [
        { week: 3, aPoints: 152.06, bPoints: 118.9 },
        { week: 12, aPoints: 127.34, bPoints: 131.18 },
      ],
      playoffMeetings: { aWins: 0, bWins: 0, last: null },
    },
  ],
  prizes: PRIZES,
}

/**
 * Through week 15: round one has scores, its losers are out, the semi-finals are
 * pending. The final still waits, here with a `winnerOf` that names no game in
 * the bracket, so the panel must not print it as a pairing.
 */
export const semiFinalsPending: PlayoffPicture = {
  bracket: bracket(
    [
      R1_PLAYED,
      [game('r2-g1', 2, team(JACK), team(BILL)), game('r2-g2', 2, team(GABES), team(BRYAN))],
      [
        game('r3-g1', 3, waiting([1, 4]), waiting([2, 3])),
        game('r3-third', 3, waiting(null), waiting(null), 3),
      ],
    ],
    { throughWeek: 15, currentRound: 2, alive: [JACK, GABES, BILL, BRYAN], championManagerId: null },
  ),
  odds: {
    simulations: 10000,
    gamesRemaining: 3,
    title: [
      { managerId: JACK, titlePct: 0.29 },
      { managerId: GABES, titlePct: 0.27 },
      { managerId: BILL, titlePct: 0.25 },
      { managerId: BRYAN, titlePct: 0.19 },
    ],
    games: [
      { gameId: 'r2-g1', aWinPct: 0.52 },
      { gameId: 'r2-g2', aWinPct: 0.57 },
    ],
  },
  teams: TEAM_CONTEXT,
  pairs: [
    {
      gameId: 'r2-g1',
      thisSeason: [{ week: 9, aPoints: 141.92, bPoints: 139.5 }],
      playoffMeetings: { aWins: 0, bWins: 0, last: null },
    },
    {
      gameId: 'r2-g2',
      thisSeason: [],
      playoffMeetings: { aWins: 2, bWins: 0, last: { season: 2018, winnerManagerId: GABES } },
    },
  ],
  prizes: PRIZES,
}

const FINAL_PAIRS: PairContext[] = [
  {
    gameId: 'r3-g1',
    thisSeason: [{ week: 4, aPoints: 133.08, bPoints: 140.66 }],
    playoffMeetings: { aWins: 1, bWins: 0, last: { season: 2022, winnerManagerId: JACK } },
  },
  {
    gameId: 'r3-third',
    thisSeason: [{ week: 11, aPoints: 126.3, bPoints: 109.84 }],
    playoffMeetings: { aWins: 0, bWins: 0, last: null },
  },
]

/**
 * Through week 16: the final and the third-place game are both pending. The
 * prizes are all null, which is what the 2025 season actually has on record, so
 * the stakes line prints no dollars.
 */
export const finalPending: PlayoffPicture = {
  bracket: bracket(
    [
      R1_PLAYED,
      R2_PLAYED,
      [game('r3-g1', 3, team(JACK), team(GABES)), game('r3-third', 3, team(BILL), team(BRYAN), 3)],
    ],
    { throughWeek: 16, currentRound: 3, alive: [JACK, GABES], championManagerId: null },
  ),
  odds: {
    simulations: 10000,
    gamesRemaining: 1,
    title: [
      { managerId: JACK, titlePct: 0.53 },
      { managerId: GABES, titlePct: 0.47 },
    ],
    games: [
      { gameId: 'r3-g1', aWinPct: 0.53 },
      { gameId: 'r3-third', aWinPct: 0.55 },
    ],
  },
  teams: TEAM_CONTEXT,
  pairs: FINAL_PAIRS,
  prizes: { champion: null, runnerUp: null, third: null },
}

/**
 * Through week 17: every game played, Gabes the champion, no odds. This is the
 * `?through=17` preview and the hours between the final import and the champion
 * being set. One prize is on record and two are not.
 */
export const decidedNoOdds: PlayoffPicture = {
  bracket: bracket(
    [
      R1_PLAYED,
      R2_PLAYED,
      [
        game('r3-g1', 3, team(JACK, 95.9), team(GABES, 127.28)),
        game('r3-third', 3, team(BILL, 135.06), team(BRYAN, 90.74), 3),
      ],
    ],
    { throughWeek: 17, currentRound: null, alive: [GABES], championManagerId: GABES },
  ),
  odds: null,
  teams: TEAM_CONTEXT,
  pairs: [],
  prizes: { champion: 2100, runnerUp: null, third: null },
}
