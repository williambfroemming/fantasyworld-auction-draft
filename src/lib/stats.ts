/**
 * Draft analysis — the numbers behind /stats. Pure, DB-free, unit-tested.
 *
 * Kept separate from `draft.ts` deliberately. That file opens with "these are
 * the rules the Google Sheet could not enforce — if any of this is wrong, the
 * draft is wrong", and that framing is what earns it the scrutiny it gets.
 * Nothing here can break a draft: it is reporting. Mixing the two would dilute
 * a claim worth keeping sharp. The shared primitives (`median`,
 * `MARKET_POSITIONS`) stay in `draft.ts` and are imported.
 *
 * Everything takes a `StatsInput`, which the live board and an archived season
 * both satisfy structurally — so /stats has exactly one code path for "this
 * year" and "2026", and a bug cannot hide in one of them.
 */
import { MARKET_POSITIONS, median } from './draft'

// ---------------------------------------------------------------------------
// The input seam
// ---------------------------------------------------------------------------

export interface StatsManager {
  id: number
  displayName: string
  color: string
  draftSlot: number
  /** Money left. Server-derived; already folds in any trade cash. */
  budget: number
  rostered: number
}

export interface StatsPick {
  id: number
  pickNo: number
  /** CURRENT owner — a trade moves this. For money questions use `draftersByPick`. */
  managerId: number
  nominatorId: number
  price: number
  position: string
  name: string
  /** Pool rank frozen at award time. Null = not scored. */
  rank: number | null
  posRank: number | null
}

export interface StatsTrade {
  id: number
  createdAt: string
  managerAId: number
  managerBId: number
  players: Array<{ pickId: number; toManagerId: number }>
}

export interface StatsInput {
  season: number
  rosterSize: number
  startingBudget: number
  /**
   * The season's record is complete, stated rather than inferred.
   *
   * Optional because the live draft has no such flag — it is still happening.
   * See `draftComplete`.
   */
  isFinal?: boolean
  managers: StatsManager[]
  picks: StatsPick[]
  trades: StatsTrade[]
}

// ---------------------------------------------------------------------------
// Who actually bought each player
// ---------------------------------------------------------------------------

/**
 * Map of pick id → the manager who bought them **at auction**.
 *
 * `picks.manager_id` is current ownership, and the league's rule is that a
 * traded player's salary stays with whoever bought them. No column records the
 * original buyer, and `budget_adjustments` cannot recover it either: a trade
 * writes one combined row per manager folding salary and cash together
 * (see src/server/trade-service.ts), so the two are inseparable afterwards.
 *
 * The trade log is the only source that survives, and it does carry it. Walk it
 * backwards: start from current ownership and undo each move, newest first.
 *
 * A trade whose record disagrees with current ownership — possible after a
 * commissioner reassignment — is skipped rather than applied, because a
 * half-rewound chain is worse than an un-rewound one.
 */
export function draftersByPick(picks: StatsPick[], trades: StatsTrade[]): Map<number, number> {
  const drafter = new Map<number, number>()
  for (const p of picks) drafter.set(p.id, p.managerId)

  const newestFirst = [...trades].sort((a, b) => {
    const t = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    return t !== 0 ? t : b.id - a.id
  })

  for (const trade of newestFirst) {
    for (const moved of trade.players) {
      const current = drafter.get(moved.pickId)
      if (current === undefined) continue // pick no longer exists (undone)
      if (current !== moved.toManagerId) continue // doesn't match; leave it alone
      // Rewind to the other side of this trade.
      drafter.set(
        moved.pickId,
        moved.toManagerId === trade.managerBId ? trade.managerAId : trade.managerBId,
      )
    }
  }
  return drafter
}

// ---------------------------------------------------------------------------
// View 1 — team spend by position
// ---------------------------------------------------------------------------

/**
 * Spend columns. **Not the same list as `MARKET_POSITIONS`**, on purpose.
 *
 * The market view excludes K and DEF because they go for a dollar or two and
 * would drag every league-wide median toward the floor. But this is a *budget*
 * table, and a row that doesn't add up to what a manager actually spent is a
 * lie. So K and DEF are kept, folded into OTHER.
 */
export const SPEND_COLUMNS = ['QB', 'RB', 'WR', 'TE', 'OTHER'] as const
export type SpendColumn = (typeof SPEND_COLUMNS)[number]

export interface TeamSpendRow {
  managerId: number
  byPosition: Record<SpendColumn, number>
  spent: number
  unspent: number
  rostered: number
  /**
   * `startingBudget − (spent + unspent)`. Should be 0. A non-zero value means
   * money moved without a pick behind it — trade cash, or a commissioner
   * adjustment, neither of which reaches the client. Surfaced rather than
   * hidden so a row that doesn't add up says so instead of just looking wrong.
   */
  drift: number
}

export function spendColumnFor(position: string): SpendColumn {
  return (MARKET_POSITIONS as readonly string[]).includes(position)
    ? (position as SpendColumn)
    : 'OTHER'
}

export function teamSpend(input: StatsInput): {
  rows: TeamSpendRow[]
  totals: { byPosition: Record<SpendColumn, number>; spent: number; unspent: number }
  /** Largest single cell, for scaling bars on one league-wide scale. */
  peak: number
} {
  const drafter = draftersByPick(input.picks, input.trades)
  const zero = () =>
    Object.fromEntries(SPEND_COLUMNS.map((c) => [c, 0])) as Record<SpendColumn, number>

  const rows: TeamSpendRow[] = input.managers.map((m) => {
    // Attributed to the DRAFTER: this table answers "how did you allocate your
    // $200", which is a fact about the auction, not about today's roster.
    const mine = input.picks.filter((p) => drafter.get(p.id) === m.id)
    const byPosition = zero()
    for (const p of mine) byPosition[spendColumnFor(p.position)] += p.price
    const spent = mine.reduce((s, p) => s + p.price, 0)
    return {
      managerId: m.id,
      byPosition,
      spent,
      unspent: m.budget,
      rostered: m.rostered,
      drift: input.startingBudget - (spent + m.budget),
    }
  })

  const totals = { byPosition: zero(), spent: 0, unspent: 0 }
  for (const r of rows) {
    for (const c of SPEND_COLUMNS) totals.byPosition[c] += r.byPosition[c]
    totals.spent += r.spent
    totals.unspent += r.unspent
  }

  const peak = Math.max(1, ...rows.flatMap((r) => SPEND_COLUMNS.map((c) => r.byPosition[c])))
  return { rows, totals, peak }
}

// ---------------------------------------------------------------------------
// View 2 — pace
// ---------------------------------------------------------------------------

export interface SpendBlock {
  index: number
  fromPick: number
  toPick: number
  count: number
  spent: number
  avg: number
  median: number
  max: number
}

/**
 * The market's price curve across the night, in blocks of picks.
 *
 * `blockSize` defaults to two full rounds, derived from the league size rather
 * than hardcoded, so it stays sensible if the league ever changes size.
 */
export function spendBlocks(picks: StatsPick[], blockSize: number): SpendBlock[] {
  if (blockSize < 1 || picks.length === 0) return []
  const ordered = [...picks].sort((a, b) => a.pickNo - b.pickNo)
  const blocks: SpendBlock[] = []

  for (let i = 0; i < ordered.length; i += blockSize) {
    const slice = ordered.slice(i, i + blockSize)
    const prices = slice.map((p) => p.price)
    const spent = prices.reduce((s, p) => s + p, 0)
    blocks.push({
      index: blocks.length,
      fromPick: slice[0].pickNo,
      toPick: slice[slice.length - 1].pickNo,
      count: slice.length,
      spent,
      avg: spent / slice.length,
      median: median(prices),
      max: Math.max(...prices),
    })
  }
  return blocks
}

/**
 * Dollars a manager can average on each roster spot they still have to fill.
 *
 * `budget / slotsLeft`, and **0 for a full roster** rather than a divide by
 * zero — a manager at `rosterSize` has nothing left to spend it on, so the
 * honest answer is not Infinity.
 *
 * One definition, shared by the Budgets panel and /stats, so the two can never
 * quote different numbers for the same thing.
 */
export function perSlotLeft(budget: number, rostered: number, rosterSize: number): number {
  const slotsLeft = Math.max(0, rosterSize - rostered)
  return slotsLeft === 0 ? 0 : budget / slotsLeft
}

// ---------------------------------------------------------------------------
// View 2b — the cumulative spend curve
// ---------------------------------------------------------------------------

/** A step in a cumulative curve: after `pickNo`, this much had been spent. */
export interface CurvePoint {
  pickNo: number
  spent: number
}

export interface ManagerCurve {
  managerId: number
  /**
   * Step points, starting at `{ pickNo: 0, spent: 0 }` and gaining one entry per
   * pick this manager bought. A manager's total only changes when *they* buy, so
   * the line is flat between their own picks — that flatness is the signal, and
   * it is why these are steps rather than a smoothed line through their picks.
   */
  points: CurvePoint[]
  total: number
  /**
   * Pick number at which they had spent half their eventual total — a single
   * number for "did they buy early or late". Null if they never bought.
   */
  halfwayPick: number | null
}

export interface SpendCurveReport {
  /** Cumulative spend across the whole league, one point per pick. */
  league: CurvePoint[]
  managers: ManagerCurve[]
  /** Last pick number seen, so every curve can be drawn to a common x-max. */
  lastPick: number
  /** Highest total any one manager reached — the y-max for the per-manager panels. */
  peak: number
}

/**
 * Cumulative spend over the course of the draft, league-wide and per manager.
 *
 * This is the "who bought early" view. `spendBlocks` answers what the *market*
 * was doing in a window; this answers what a *person* was doing across the whole
 * night, and the shape is the point: a steep early curve that flattens is
 * someone who spent their budget in the first three rounds, and a flat line that
 * kicks up at the end is someone who sat on their money.
 *
 * ⚠️ Attributes to the **drafter**, via `draftersByPick`, like every other money
 * question here. Using `pick.managerId` would move a traded player's salary onto
 * their new team and redraw two managers' whole curves from the trade onward,
 * which is a silent wrong answer rather than a visible one.
 */
export function spendCurve(input: StatsInput): SpendCurveReport {
  const drafter = draftersByPick(input.picks, input.trades)
  const ordered = [...input.picks].sort((a, b) => a.pickNo - b.pickNo)
  const lastPick = ordered.length ? ordered[ordered.length - 1].pickNo : 0

  const league: CurvePoint[] = []
  let runningLeague = 0
  for (const p of ordered) {
    runningLeague += p.price
    league.push({ pickNo: p.pickNo, spent: runningLeague })
  }

  const managers = input.managers.map((m) => {
    const mine = ordered.filter((p) => drafter.get(p.id) === m.id)
    const points: CurvePoint[] = [{ pickNo: 0, spent: 0 }]
    let running = 0
    for (const p of mine) {
      running += p.price
      points.push({ pickNo: p.pickNo, spent: running })
    }
    // The first pick at which they were half-done spending. Computed against
    // their final total, so it is only meaningful once they have stopped —
    // mid-draft it simply tracks the halfway point of what they have spent so far.
    const half = running / 2
    const halfwayPick = points.find((pt) => pt.pickNo > 0 && pt.spent >= half)?.pickNo ?? null
    return { managerId: m.id, points, total: running, halfwayPick }
  })

  return {
    league,
    managers,
    lastPick,
    peak: Math.max(1, ...managers.map((m) => m.total)),
  }
}

export interface ManagerPace {
  managerId: number
  rostered: number
  spent: number
  unspent: number
  slotsLeft: number
  /**
   * Dollars per roster spot still to fill — the number to bid off.
   *
   * Deliberately not named "ahead"/"behind": those are ambiguous between
   * *spent more* and *has more left*, so the word belongs on screen next to its
   * definition, not in the data.
   */
  perSlotLeft: number
  /** perSlotLeft minus the median across managers who can still bid. */
  vsRoom: number
  /** Share of all money spent so far. */
  spentShare: number
}

export function managerPace(input: StatsInput): ManagerPace[] {
  const drafter = draftersByPick(input.picks, input.trades)
  const leagueSpent = input.picks.reduce((s, p) => s + p.price, 0)

  const base = input.managers.map((m) => {
    const spent = input.picks
      .filter((p) => drafter.get(p.id) === m.id)
      .reduce((s, p) => s + p.price, 0)
    const slotsLeft = Math.max(0, input.rosterSize - m.rostered)
    return {
      managerId: m.id,
      rostered: m.rostered,
      spent,
      unspent: m.budget,
      slotsLeft,
      perSlotLeft: perSlotLeft(m.budget, m.rostered, input.rosterSize),
      spentShare: leagueSpent === 0 ? 0 : spent / leagueSpent,
    }
  })

  // The room = managers who can still bid. Someone at 16 has dead money and
  // must not drag the comparison, the same rule the nomination order and the
  // Budgets panel already apply.
  const active = base.filter((b) => b.slotsLeft > 0)
  const roomMedian = active.length ? median(active.map((b) => b.perSlotLeft)) : 0

  return base.map((b) => ({
    ...b,
    vsRoom: b.slotsLeft === 0 ? 0 : b.perSlotLeft - roomMedian,
  }))
}

// ---------------------------------------------------------------------------
// View 3 — nominations
// ---------------------------------------------------------------------------

export interface NominationRow {
  managerId: number
  nominated: number
  /** Nominations this manager bought themselves. */
  wonOwn: number
  /** 0..1. Zero when they never nominated — never NaN. */
  winPct: number
  spentOnOwn: number
  /** Dollars rivals paid on players this manager put up. */
  drivenToRivals: number
}

/**
 * What each manager's nominations did.
 *
 * Compared against the **drafter**, not the current owner: otherwise a trade in
 * November retroactively rewrites who won their own nomination back in August.
 *
 * Nomination *counts* are near-equal by construction — the snake gives everyone
 * roughly `rosterSize` turns — so the count is context and the interesting
 * columns are the win rate and the money driven elsewhere.
 */
export function nominationStats(input: StatsInput): NominationRow[] {
  const drafter = draftersByPick(input.picks, input.trades)

  return input.managers.map((m) => {
    const put = input.picks.filter((p) => p.nominatorId === m.id)
    const own = put.filter((p) => drafter.get(p.id) === m.id)
    return {
      managerId: m.id,
      nominated: put.length,
      wonOwn: own.length,
      winPct: put.length === 0 ? 0 : own.length / put.length,
      spentOnOwn: own.reduce((s, p) => s + p.price, 0),
      drivenToRivals: put
        .filter((p) => drafter.get(p.id) !== m.id)
        .reduce((s, p) => s + p.price, 0),
    }
  })
}

// ---------------------------------------------------------------------------
// View 4 — bargains and overpays
// ---------------------------------------------------------------------------

/**
 * Is the draft finished?
 *
 * For a live draft the test is the same one `nominatorAt` uses — is anybody
 * unfilled? — rather than `draft.status === 'done'`, because the status flag is
 * set by hand and can lag.
 *
 * ⚠️ A finished season says so directly, and that has to win. "Is every roster
 * full?" is a fine question about a draft in progress and the wrong question
 * about a season that ended years ago: 2022's record is one pick short and
 * always will be, because the pick is missing from the source and cannot be
 * recovered. Without `isFinal` that season is reported as still drafting,
 * forever, which gates the Value view and shows a live panel on a dead year.
 */
export function draftComplete(input: StatsInput): boolean {
  if (input.isFinal === true) return true
  return (
    input.managers.length > 0 && input.managers.every((m) => m.rostered >= input.rosterSize)
  )
}

export interface ValuedPick {
  pickId: number
  name: string
  position: string
  rank: number
  posRank: number | null
  price: number
  /** What the room paid for nearby-ranked players at the same position. */
  benchmark: number
  /** price − benchmark. Positive = paid over the room. */
  delta: number
  /**
   * price / benchmark, or null when the benchmark is under $2. Prices bottom out
   * at $1 with a big mass there, so a ratio against a $1 benchmark ($6 = 600%)
   * is noise wearing a percentage sign.
   */
  ratio: number | null
  managerId: number
}

export interface ValueReport {
  scored: ValuedPick[]
  /** Picks with no rank, or too few same-position neighbours to compare. */
  unscored: number
  byManager: Array<{ managerId: number; delta: number; scored: number }>
}

/**
 * Score every pick against what this room paid for comparable players.
 *
 * ## The benchmark is the league's own bidding, deliberately
 *
 * No third-party auction values are used — the league stripped tiers and
 * auction values from the board precisely so no outside number anchors the room
 * (PROGRESS_LOG step 9b). The consequence is worth stating plainly wherever this
 * is displayed: it can only find who paid more than *this room* did for a
 * comparable player. If everybody overpaid for running backs, nothing here will
 * say so.
 *
 * ## Why the comparison is within-position
 *
 * ⚠️ Comparing a price against nearby players by **overall** rank is
 * systematically biased and was measured to be so against the real 2026 draft:
 * every one of the top overpays came out a QB and every bargain a WR. That is
 * not insight, it is the metric rediscovering that this is a superflex league,
 * where QBs are worth far more than their overall rank implies. Comparing
 * within a position removes it.
 *
 * A flat per-position median does not work either: price still decays steeply
 * with rank inside a position, so it would brand every QB1 an overpay. Hence
 * nearest-neighbours *within* the position.
 *
 * ## The one bias that remains, knowingly
 *
 * The highest-ranked player at a position has nobody above them, so their
 * window is taken entirely from below and a decaying market makes them look
 * slightly expensive; the last-ranked player gets the mirror image. Dropping
 * them instead would remove exactly the players the room argues about most, so
 * they are scored and the bias is documented rather than hidden. On the real
 * 2026 draft it is small enough that no rank-1 player reached the top overpays.
 */
export function valueVsRoom(
  input: StatsInput,
  opts: { window?: number; minNeighbours?: number } = {},
): ValueReport {
  const windowSize = opts.window ?? 6
  const minNeighbours = opts.minNeighbours ?? 3
  const drafter = draftersByPick(input.picks, input.trades)

  const scored: ValuedPick[] = []
  let unscored = 0

  for (const position of MARKET_POSITIONS) {
    const group = input.picks
      .filter((p) => p.position === position)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))

    // Sorted by overall rank rather than posRank so a null posRank never drops
    // a pick; posRank is carried for display only.
    const ranked = group.filter((p) => p.rank !== null)
    unscored += group.length - ranked.length

    ranked.forEach((p, i) => {
      const half = Math.floor(windowSize / 2)
      // Asymmetric at the ends: a rank-1 player has no one above them, so take
      // the window entirely from below rather than comparing against nothing.
      let lo = i - half
      let hi = i + half + 1
      if (lo < 0) {
        hi = Math.min(ranked.length, hi - lo)
        lo = 0
      }
      if (hi > ranked.length) {
        lo = Math.max(0, lo - (hi - ranked.length))
        hi = ranked.length
      }
      const neighbours = ranked.slice(lo, hi).filter((x) => x.id !== p.id)

      if (neighbours.length < minNeighbours) {
        unscored++
        return
      }
      const benchmark = median(neighbours.map((x) => x.price))
      scored.push({
        pickId: p.id,
        name: p.name,
        position: p.position,
        rank: p.rank as number,
        posRank: p.posRank,
        price: p.price,
        benchmark,
        delta: p.price - benchmark,
        ratio: benchmark < 2 ? null : p.price / benchmark,
        managerId: drafter.get(p.id) ?? p.managerId,
      })
    })
  }

  // Ranked by absolute dollars, never by ratio — see ValuedPick.ratio.
  scored.sort((a, b) => b.delta - a.delta)

  const byManager = input.managers.map((m) => {
    const mine = scored.filter((s) => s.managerId === m.id)
    return {
      managerId: m.id,
      delta: mine.reduce((s, v) => s + v.delta, 0),
      scored: mine.length,
    }
  })

  return { scored, unscored, byManager }
}
