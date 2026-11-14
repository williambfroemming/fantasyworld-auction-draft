/**
 * The contract for playoff mode (docs/PLAYOFF_MODE_ROADMAP.md, section 5).
 *
 * Types only, no logic. The bracket derivation, the bracket odds, the card
 * context and the components were built in parallel against this file, so it
 * is the one place their shapes are allowed to be decided.
 */

export interface BracketTeam {
  managerId: number
  seed: number            // 1-based
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

export interface BracketSide {
  managerId: number | null       // null until the feeder game is played
  seed: number | null
  points: number | null          // null until played
  /** Set when managerId is null: the seeds whose game decides this side. */
  winnerOf: [number, number] | null
}

export interface BracketGame {
  id: string                     // stable, e.g. "r2-g1"
  round: number                  // 1-based
  week: number                   // regularSeasonWeeks + round
  placement: null | 3            // null = championship path, 3 = third-place game
  a: BracketSide
  b: BracketSide
  status: 'played' | 'pending' | 'waiting'   // waiting = a side is still unknown
  winnerManagerId: number | null
}

export interface PlayoffBracket {
  season: number
  teams: BracketTeam[]           // seed order
  byes: number[]                 // managerIds with a first-round bye
  rounds: BracketGame[][]        // index 0 = round one
  /** Last week with results on record: a playoff week, or the last regular week. */
  throughWeek: number
  /** First round with a game not yet played. Null when the bracket is decided. */
  currentRound: number | null
  alive: number[]                // managerIds still able to win the title
  championManagerId: number | null
}

export interface BracketOdds {
  simulations: number
  /** Games left on the championship path. Passed to formatOdds(). */
  gamesRemaining: number
  title: Array<{ managerId: number; titlePct: number }>          // alive teams only
  games: Array<{ gameId: string; aWinPct: number }>              // pending games only
}

export interface TeamContext {
  managerId: number
  titles: number                 // counted by display name, as page.tsx does
  playoffAppearances: number
  /**
   * The manager's most recent championship game in a completed earlier season.
   * Null when there is none on record: the runner-up is only known from 2011,
   * so null is "none on record", never "has never played in one".
   */
  lastFinal: { season: number; won: boolean } | null
}

export interface PairContext {
  gameId: string
  /** This season's regular-season meetings, from a's side. */
  thisSeason: Array<{ week: number; aPoints: number; bPoints: number }>
  /** All-time playoff meetings that count toward records. */
  playoffMeetings: { aWins: number; bWins: number; last: { season: number; winnerManagerId: number } | null }
}

export interface PlayoffPicture {
  bracket: PlayoffBracket
  odds: BracketOdds | null
  teams: TeamContext[]
  pairs: PairContext[]           // current-round games with both teams known
  prizes: { champion: number | null; runnerUp: number | null; third: number | null }
}
