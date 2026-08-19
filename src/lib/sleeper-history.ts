/**
 * Turning Sleeper's season payloads into the league's history rows.
 *
 * Pure and DB-free, in the shape of `src/lib/stats.ts`: everything here takes
 * plain objects and returns plain objects, so it is unit-testable without a
 * database and without the network. `scripts/import-sleeper-history.ts` is the
 * thin part that reads files and writes rows.
 *
 * See docs/PROJECT_PLAN.md §12 for why Sleeper is the source of record from 2020.
 */

// ---------------------------------------------------------------------------
// The shapes Sleeper actually returns (only the fields used here)
// ---------------------------------------------------------------------------

export interface RawLeague {
  league_id: string
  name: string
  previous_league_id: string | null
  total_rosters: number
  roster_positions: string[]
  status?: string
  settings: { playoff_week_start?: number; playoff_teams?: number }
}

export interface RawRoster {
  roster_id: number
  owner_id: string
  co_owners: string[] | null
  settings: {
    wins: number
    losses: number
    ties: number
    /** Points are two integers: 1959 + 72/100 = 1959.72. Reading `fpts` alone truncates. */
    fpts: number
    fpts_decimal?: number
    fpts_against?: number
    fpts_against_decimal?: number
    /** Sleeper's own season-total "potential points" — used to check `optimalLineup`. */
    ppts?: number
    ppts_decimal?: number
  }
}

export interface RawMatchup {
  roster_id: number
  matchup_id: number | null
  points: number
  starters: string[] | null
  players: string[] | null
  players_points: Record<string, number> | null
}

/** A bracket game. `p` marks a placement game: 1 is the final, 3 is third place. */
export interface RawBracketGame {
  r: number
  m: number
  t1: number | null
  t2: number | null
  w: number | null
  l: number | null
  p?: number
}

/** id -> [name, position, team], from `data/sleeper/players-min.json`. */
export type PlayerMap = Record<string, [string, string, string | null]>

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/**
 * Sleeper splits a points total into two integers.
 *
 * `{ fpts: 1959, fpts_decimal: 72 }` is 1959.72. Reading `fpts` alone silently
 * truncates every score to a whole number, which looks like rounding rather than
 * a bug — and would quietly change every points-for total in the league record.
 */
export function combinePoints(whole: number | undefined, decimal: number | undefined): number {
  if (whole === undefined || whole === null) return 0
  return Number((whole + (decimal ?? 0) / 100).toFixed(2))
}

// ---------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------

/** Slots that hold a player. Everything else is a bench or reserve slot. */
const NON_STARTING = new Set(['BN', 'IR', 'TAXI'])

export function startingSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((p) => !NON_STARTING.has(p))
}

/**
 * Which positions may fill a slot.
 *
 * ⚠️ This league's shape **changed in 2022**: 2020–2021 start nine with a single
 * `FLEX`; 2022 onward start ten and add `SUPER_FLEX`, which makes a QB
 * flex-eligible. Read the season's own `roster_positions` — assuming superflex
 * throughout over-reports the optimum for two seasons, and assuming it never
 * applies under-reports it for four.
 */
export function slotEligibility(slot: string): ReadonlySet<string> {
  switch (slot) {
    case 'FLEX':
      return new Set(['RB', 'WR', 'TE'])
    case 'REC_FLEX':
      return new Set(['WR', 'TE'])
    case 'SUPER_FLEX':
      return new Set(['QB', 'RB', 'WR', 'TE'])
    case 'WRRB_FLEX':
      return new Set(['RB', 'WR'])
    case 'IDP_FLEX':
      return new Set(['DL', 'LB', 'DB'])
    default:
      return new Set([slot])
  }
}

export interface LineupCandidate {
  playerId: string
  position: string
  points: number
}

export interface OptimalLineup {
  total: number
  /** Slot index -> the player assigned to it. Absent when nothing was eligible. */
  assignment: Array<{ slot: string; playerId: string; points: number } | null>
}

/**
 * The best legal lineup available from a roster.
 *
 * Slots are filled **most-restrictive first**, each taking the highest-scoring
 * eligible player not already used. That is optimal here rather than merely
 * greedy because the eligibility sets are *nested*: every strict position is a
 * subset of `FLEX`, which is a subset of `SUPER_FLEX`, and `DEF`/`K` are
 * disjoint singletons. Filling a broad slot first could strand a narrow one; the
 * reverse cannot, because anything the narrow slot takes was also available to
 * the broad one.
 *
 * Verified empirically as well as argued: the season totals this produces are
 * checked against Sleeper's own `ppts` for every manager-season.
 */
export function optimalLineup(slots: string[], candidates: LineupCandidate[]): OptimalLineup {
  const order = slots
    .map((slot, index) => ({ slot, index, width: slotEligibility(slot).size }))
    .sort((a, b) => a.width - b.width || a.index - b.index)

  const pool = [...candidates].sort((a, b) => b.points - a.points)
  const used = new Set<string>()
  const assignment: OptimalLineup['assignment'] = slots.map(() => null)
  let total = 0

  for (const { slot, index } of order) {
    const eligible = slotEligibility(slot)
    const pick = pool.find((c) => !used.has(c.playerId) && eligible.has(c.position))
    if (!pick) continue
    used.add(pick.playerId)
    assignment[index] = { slot, playerId: pick.playerId, points: pick.points }
    total += pick.points
  }

  return { total: Number(total.toFixed(2)), assignment }
}

// ---------------------------------------------------------------------------
// A week
// ---------------------------------------------------------------------------

export interface MatchupSide {
  week: number
  rosterId: number
  matchupId: number | null
  points: number
  opponentRosterId: number
  opponentPoints: number
  result: 'W' | 'L' | 'T'
}

/**
 * Pair a week's entries into two-sided rows.
 *
 * Entries sharing a `matchup_id` are one game. An entry with a null `matchup_id`
 * had no opponent that week and is dropped rather than invented — a bye in a
 * ten-team league means the data is incomplete, not that somebody played nobody.
 */
export function pairWeek(week: number, entries: RawMatchup[]): MatchupSide[] {
  const byMatchup = new Map<number, RawMatchup[]>()
  for (const e of entries) {
    if (e.matchup_id === null || e.matchup_id === undefined) continue
    const list = byMatchup.get(e.matchup_id) ?? []
    list.push(e)
    byMatchup.set(e.matchup_id, list)
  }

  const sides: MatchupSide[] = []
  for (const [, pair] of byMatchup) {
    // A matchup_id with anything other than two entries is not a game we can
    // describe, and guessing would put a fabricated result in the record.
    if (pair.length !== 2) continue
    const [a, b] = pair
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      sides.push({
        week,
        rosterId: self.roster_id,
        matchupId: self.matchup_id,
        points: Number(self.points.toFixed(2)),
        opponentRosterId: other.roster_id,
        opponentPoints: Number(other.points.toFixed(2)),
        result: self.points > other.points ? 'W' : self.points < other.points ? 'L' : 'T',
      })
    }
  }
  return sides.sort((x, y) => x.rosterId - y.rosterId)
}

export interface PlayerWeekRow {
  week: number
  rosterId: number
  playerId: string
  playerName: string | null
  position: string | null
  nflTeam: string | null
  isStarter: boolean
  slot: string | null
  points: number
}

/**
 * Every rostered player's week, with the slot the starters actually filled.
 *
 * `starters` is positional — its order matches `roster_positions` with the bench
 * removed — so the slot each starter occupied is recorded rather than inferred.
 * A `'0'` entry is an empty slot, which is a real thing that happens and is not
 * a player.
 */
export function playerWeeks(
  week: number,
  entries: RawMatchup[],
  slots: string[],
  players: PlayerMap,
): PlayerWeekRow[] {
  const rows: PlayerWeekRow[] = []
  for (const e of entries) {
    const starterSlot = new Map<string, string>()
    ;(e.starters ?? []).forEach((id, i) => {
      if (id && id !== '0') starterSlot.set(id, slots[i] ?? 'FLEX')
    })

    const seen = new Set<string>()
    const ids = new Set([...(e.players ?? []), ...starterSlot.keys()])
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const meta = players[id]
      rows.push({
        week,
        rosterId: e.roster_id,
        playerId: id,
        playerName: meta?.[0] ?? null,
        position: meta?.[1] ?? null,
        nflTeam: meta?.[2] ?? null,
        isStarter: starterSlot.has(id),
        slot: starterSlot.get(id) ?? null,
        points: Number((e.players_points?.[id] ?? 0).toFixed(2)),
      })
    }
  }
  return rows
}

/** Actual and best-possible points for each roster in a week. */
export function weekLineups(
  entries: RawMatchup[],
  slots: string[],
  players: PlayerMap,
): Array<{ rosterId: number; actual: number; optimal: number }> {
  return entries.map((e) => {
    const actual = (e.starters ?? []).reduce(
      (sum, id) => sum + (id && id !== '0' ? (e.players_points?.[id] ?? 0) : 0),
      0,
    )
    const candidates: LineupCandidate[] = Object.entries(e.players_points ?? {}).map(
      ([playerId, points]) => ({
        playerId,
        position: players[playerId]?.[1] ?? 'UNKNOWN',
        points,
      }),
    )
    return {
      rosterId: e.roster_id,
      actual: Number(actual.toFixed(2)),
      optimal: optimalLineup(slots, candidates).total,
    }
  })
}

// ---------------------------------------------------------------------------
// The bracket
// ---------------------------------------------------------------------------

export interface Podium {
  championRosterId: number | null
  runnerUpRosterId: number | null
  thirdRosterId: number | null
}

/**
 * Read the podium off the winners bracket.
 *
 * `p` marks a placement game: `p: 1` is the final and `p: 3` is the third-place
 * game. **Third place is played** — the bracket holds seven games (two
 * quarter-finals, two semi-finals, a fifth-place game, the final and the
 * third-place game), of which the workbook only ever recorded five. Checked
 * against `win_history` for all five overlapping seasons: fifteen placings,
 * fifteen matches.
 */
export function podiumFromBracket(bracket: RawBracketGame[]): Podium {
  const final = bracket.find((g) => g.p === 1)
  const third = bracket.find((g) => g.p === 3)
  return {
    championRosterId: final?.w ?? null,
    runnerUpRosterId: final?.l ?? null,
    thirdRosterId: third?.w ?? null,
  }
}

/** The `(week, matchup_id)` pairs that are real playoff games, not consolation. */
export function playoffGames(
  bracket: RawBracketGame[],
  playoffWeekStart: number,
): Map<number, Set<number>> {
  // Round 1 is played in `playoffWeekStart`, round 2 the week after, and so on.
  // Only games in the winners bracket count: the same weeks also contain
  // consolation games, which the league has never treated as part of its record.
  const byWeek = new Map<number, Set<number>>()
  for (const g of bracket) {
    if (g.t1 === null || g.t2 === null) continue
    const week = playoffWeekStart + (g.r - 1)
    const set = byWeek.get(week) ?? new Set<number>()
    set.add(g.t1)
    set.add(g.t2)
    byWeek.set(week, set)
  }
  return byWeek
}

/** Which bracket round a playoff week belongs to. */
export function playoffRound(week: number, playoffWeekStart: number): number {
  return week - playoffWeekStart + 1
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface StandingRow {
  rosterId: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  place: number
  potentialPoints: number
}

/**
 * Regular-season standings, ranked by record then points for.
 *
 * Sleeper stores the record but not a rank, so `place` is computed. The ordering
 * is checked against the workbook's own `reg_season_place` for every overlapping
 * season by the importer, which is what turns "the usual tiebreak" into a
 * verified one.
 */
export function standings(rosters: RawRoster[]): StandingRow[] {
  return rosters
    .map((r) => ({
      rosterId: r.roster_id,
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties ?? 0,
      pointsFor: combinePoints(r.settings.fpts, r.settings.fpts_decimal),
      pointsAgainst: combinePoints(r.settings.fpts_against, r.settings.fpts_against_decimal),
      potentialPoints: combinePoints(r.settings.ppts, r.settings.ppts_decimal),
      place: 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)
    .map((row, i) => ({ ...row, place: i + 1 }))
}
