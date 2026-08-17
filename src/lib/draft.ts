/**
 * Pure auction rules. No DB, no I/O, no framework — everything here is a
 * function of its arguments so it can be unit-tested in isolation.
 *
 * These are the rules the Google Sheet could not enforce. If any of this is
 * wrong, the draft is wrong, so it is tested before anything is built on it.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * The most you may bid right now, reserving $1 for each roster spot you still
 * have to fill.
 *
 *   maxBid = budget - (rosterSize - rostered - 1)
 *
 * With 16 slots and $200 that's $185 on the first nomination.
 *
 * The invariant this creates is the important part: because every unfilled slot
 * keeps a dollar in reserve, a manager's budget can never fall below the number
 * of slots they have left. Nobody can be stranded holding empty roster spots and
 * no money — which is precisely the failure the old sheet recorded as -1.
 */
export function maxBidFor(budget: number, rostered: number, rosterSize: number): number {
  if (rostered >= rosterSize) return 0
  return budget - (rosterSize - rostered - 1)
}

// ---------------------------------------------------------------------------
// Nomination order
// ---------------------------------------------------------------------------

/**
 * Which seat nominates at a given index, snaking each round.
 * Round 0 runs 0..n-1, round 1 runs n-1..0, and so on.
 */
export function snakeSlot(index: number, n: number): number {
  const round = Math.floor(index / n)
  const pos = index % n
  return round % 2 === 0 ? pos : n - 1 - pos
}

export interface Nominator {
  id: number
  draftSlot: number
  rosterCount: number
}

/**
 * The manager on the clock at `nominationIndex`, skipping anyone whose roster is
 * already full. Returns the index actually landed on so the caller can advance
 * past skipped seats.
 *
 * Managers must be passed in seat order (sorted by draftSlot). The snake pattern
 * is fixed; the seating is per-season data drawn at setup.
 *
 * ## Why there is no index cap
 *
 * This used to stop searching at `n * rosterSize + n` and return null — and that
 * **stalled the live 2026 draft with 32 picks still to make** (docs/BACKLOG.md §9).
 * The reasoning behind the cap was that 160 picks need at most 170 indices, but
 * `nominationIndex` is not a pick counter: every *skipped* seat consumes an index
 * too, and `skipNominator()` burns one with no pick behind it at all. Once nine
 * managers are full, reaching the tenth can cost ~10 indices per single pick, so
 * the 10-index margin is gone long before the draft ends. Simulation confirmed a
 * merely lumpy draft lands on exactly 170 — meaning one commissioner skip would
 * have stalled it too. The cap never had any margin.
 *
 * So the question is asked directly instead: **is anybody unfilled?** If not, the
 * draft is complete. If so, scanning forward is guaranteed to find them, because
 * any window of `2n` consecutive indices visits every seat.
 *
 * ⚠️ `2n`, not `n`. A window of `n` indices straddling a snake turn can miss a
 * seat — with n=10 starting at index 9, the seats visited are 1..9 and slot 0
 * never comes up. There is a test for exactly that.
 */
export function nominatorAt<T extends Nominator>(
  managers: T[],
  nominationIndex: number,
  rosterSize: number,
): { manager: T; index: number } | null {
  const n = managers.length
  if (n === 0) return null

  // The one true definition of a finished draft. Anything else — an index
  // bound, a pick count — is a proxy that can be wrong.
  if (managers.every((m) => m.rosterCount >= rosterSize)) return null

  const start = Math.max(0, nominationIndex)
  for (let i = start; i < start + 2 * n; i++) {
    const m = managers[snakeSlot(i, n)]
    if (m.rosterCount < rosterSize) return { manager: m, index: i }
  }
  /* c8 ignore next 2 -- unreachable: someone is unfilled and 2n visits every seat */
  return null
}

/**
 * The next `count` nominators, in order, starting at `nominationIndex`.
 *
 * Repeated calls to `nominatorAt` — never a second copy of the snake maths.
 *
 * ⚠️ **This is a projection, not a promise.** It assumes every roster stays as
 * it is right now, because who nominates in five turns genuinely depends on who
 * fills their roster before then and that has not happened yet. The consequences
 * are worth knowing precisely:
 *
 *  - While nobody is full — which is most of a draft — it is exactly right.
 *  - Once managers start filling up it drifts, because a manager who reaches
 *    `rosterSize` mid-run gets skipped and everyone behind them shuffles up.
 *  - It always self-corrects: the turn is recomputed from scratch on every read,
 *    so a wrong projection is replaced rather than accumulated.
 *
 * That is why the seat immediately ahead (`onDeck`) is carried separately and
 * treated as certain, while this is labelled as a projection wherever it is
 * shown. See docs/BACKLOG.md §5.
 */
export function upcomingOrder<T extends Nominator>(
  managers: T[],
  nominationIndex: number,
  rosterSize: number,
  count: number,
): Array<{ manager: T; index: number }> {
  const out: Array<{ manager: T; index: number }> = []
  let i = nominationIndex
  for (let k = 0; k < count; k++) {
    const turn = nominatorAt(managers, i, rosterSize)
    if (!turn) break // draft complete — nothing further to project
    out.push(turn)
    i = turn.index + 1
  }
  return out
}

/** Fisher-Yates. Returns a new array of ids in their freshly drawn seat order. */
export function randomOrder<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ---------------------------------------------------------------------------
// Award validation
// ---------------------------------------------------------------------------

export type RuleResult = { ok: true } | { ok: false; reason: string }

export interface AwardContext {
  /** The hammer price the nominator typed in. */
  price: number
  /** The winning manager's live max bid, from manager_totals. */
  winnerMaxBid: number
  winnerRostered: number
  winnerName: string
  rosterSize: number
  draftStatus: 'setup' | 'live' | 'paused' | 'done'
  lotStatus: 'open' | 'sold' | 'void'
}

/**
 * Can this player be awarded to this manager at this price?
 *
 * The bidding itself happens out loud in the room — the app never sees it. This
 * is the one moment the app gets to enforce anything, so it is also the moment
 * the -1 bug from the old sheet would slip back in. The authoritative check is
 * the WHERE clause of the award statement; this runs client-side so the button
 * can be disabled *with the reason on screen* before someone types a number
 * that a room of ten people already agreed on and then has to re-run the bidding.
 */
export function validateAward(c: AwardContext): RuleResult {
  if (c.draftStatus === 'paused') return { ok: false, reason: 'Draft is paused' }
  if (c.draftStatus !== 'live') return { ok: false, reason: 'Draft is not live' }
  if (c.lotStatus !== 'open') return { ok: false, reason: 'This player has already been awarded' }
  if (!Number.isInteger(c.price)) return { ok: false, reason: 'Price must be a whole dollar' }
  if (c.price < 1) return { ok: false, reason: 'Every player costs at least $1' }
  if (c.winnerRostered >= c.rosterSize) {
    return { ok: false, reason: `${c.winnerName}'s roster is full` }
  }
  if (c.price > c.winnerMaxBid) {
    return {
      ok: false,
      reason:
        `$${c.price} is over ${c.winnerName}'s max bid of $${c.winnerMaxBid} — ` +
        'they must keep $1 for each empty roster spot',
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Trade validation
// ---------------------------------------------------------------------------

/**
 * One side of a proposed trade, as it stands *before* the trade is applied.
 *
 * `playersOut`/`playersIn` are counts, not prices, because the league's rule is
 * that a traded player's salary stays charged to whoever bought them at auction.
 * Moving a player therefore changes this manager's roster count but not their
 * budget; only `cashOut`/`cashIn` move money.
 */
export interface TradeSide {
  name: string
  budget: number
  rostered: number
  playersOut: number
  playersIn: number
  cashOut: number
  cashIn: number
}

export interface TradeContext {
  rosterSize: number
  a: TradeSide
  b: TradeSide
}

/**
 * Both sides must still be solvent afterwards.
 *
 * This is the same invariant the auction enforces — every empty roster spot
 * keeps $1 in reserve — applied to a transaction that can move players and cash
 * in both directions at once. Giving a player away is not free: it opens a slot
 * that now needs a dollar behind it, so a broke manager can be blocked from
 * trading a player out even though nothing appears to leave their wallet.
 */
export function validateTrade(c: TradeContext): RuleResult {
  for (const side of [c.a, c.b]) {
    if (!Number.isInteger(side.cashOut) || side.cashOut < 0) {
      return { ok: false, reason: 'Cash must be a whole dollar amount of $0 or more' }
    }
  }
  if (c.a.playersOut + c.b.playersOut + c.a.cashOut + c.b.cashOut === 0) {
    return { ok: false, reason: 'A trade has to move at least one player or dollar' }
  }

  for (const side of [c.a, c.b]) {
    const rostered = side.rostered - side.playersOut + side.playersIn
    const budget = side.budget - side.cashOut + side.cashIn

    if (rostered > c.rosterSize) {
      return {
        ok: false,
        reason: `${side.name} would end up with ${rostered} players, over the ${c.rosterSize}-man roster`,
      }
    }
    // Reserve $1 per empty slot — the invariant that keeps anyone from being
    // stranded holding roster spots they cannot fill.
    const reserve = c.rosterSize - rostered
    if (budget < reserve) {
      return {
        ok: false,
        reason:
          `${side.name} would be left with $${budget} and ${reserve} spots to fill — ` +
          'they need at least $1 for each',
      }
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Roster slotting — DISPLAY ONLY
// ---------------------------------------------------------------------------

/**
 * The 16 rows of the League board, matching the old sheet's grid exactly.
 *
 * IMPORTANT: this is presentation. Nothing here may be reachable from a bidding
 * path. The league deliberately does not enforce roster shape — a manager can
 * buy a 5th QB if they want one, and the board just draws it on the bench.
 */
export const SLOTS = [
  { key: 'QB', label: 'QB', accepts: ['QB'] },
  { key: 'RB1', label: 'RB', accepts: ['RB'] },
  { key: 'RB2', label: 'RB', accepts: ['RB'] },
  { key: 'WR1', label: 'WR', accepts: ['WR'] },
  { key: 'WR2', label: 'WR', accepts: ['WR'] },
  { key: 'WR3', label: 'WR', accepts: ['WR'] },
  { key: 'TE', label: 'TE', accepts: ['TE'] },
  { key: 'FLEX', label: 'FLEX', accepts: ['RB', 'WR', 'TE'] },
  { key: 'SUPERFLEX', label: 'SUPERFLEX', accepts: ['QB', 'RB', 'WR', 'TE'] },
  { key: 'DEF', label: 'DEFENSE', accepts: ['DEF'] },
  { key: 'BN1', label: 'BENCH', accepts: null },
  { key: 'BN2', label: 'BENCH', accepts: null },
  { key: 'BN3', label: 'BENCH', accepts: null },
  { key: 'BN4', label: 'BENCH', accepts: null },
  { key: 'BN5', label: 'BENCH', accepts: null },
  { key: 'BN6', label: 'BENCH', accepts: null },
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  accepts: readonly Position[] | null
}>

export type SlotKey = (typeof SLOTS)[number]['key']

export interface SlottablePick {
  id: number
  position: string
  /** Manual placement from dragging on the board. Wins over auto-fit. */
  slotOverride?: string | null
}

const BENCH_KEYS: string[] = SLOTS.filter((s) => s.accepts === null).map((s) => s.key)

/**
 * Lay a roster out into the 16 grid rows.
 *
 * Four passes, so a greedy walk in draft order can't waste a premium slot:
 *   1. honour manual overrides
 *   2. fill natural position slots (QB->QB, RB->RB, ...)
 *   3. FLEX, then SUPERFLEX from what's left (SUPERFLEX prefers a QB, which is
 *      how the league actually uses it — the old sheet's SUPERFLEX row is all QBs)
 *   4. everything else to the bench, in draft order
 *
 * Anything that still doesn't fit comes back in `overflow` rather than being
 * dropped — a roster over 16 shouldn't be reachable, but silently losing a
 * player someone paid for would be much worse than drawing an extra row.
 */
export function autoSlot<T extends SlottablePick>(
  picks: T[],
): { slots: Record<string, T | null>; overflow: T[] } {
  const slots: Record<string, T | null> = Object.fromEntries(SLOTS.map((s) => [s.key, null]))
  const remaining: T[] = []

  // 1. manual overrides
  for (const p of picks) {
    if (p.slotOverride && p.slotOverride in slots && slots[p.slotOverride] === null) {
      slots[p.slotOverride] = p
    } else {
      remaining.push(p)
    }
  }

  const take = (pred: (p: T) => boolean): T | undefined => {
    const i = remaining.findIndex(pred)
    return i === -1 ? undefined : remaining.splice(i, 1)[0]
  }

  // 2. natural position slots
  for (const slot of SLOTS) {
    if (slots[slot.key] !== null) continue
    const accepts = slot.accepts as readonly string[] | null
    if (accepts === null || accepts.length !== 1) continue
    const hit = take((p) => p.position === accepts[0])
    if (hit) slots[slot.key] = hit
  }

  // 3. FLEX then SUPERFLEX
  for (const key of ['FLEX', 'SUPERFLEX'] as const) {
    if (slots[key] !== null) continue
    const accepts = SLOTS.find((s) => s.key === key)!.accepts as readonly string[]
    const hit =
      (key === 'SUPERFLEX' ? take((p) => p.position === 'QB') : undefined) ??
      take((p) => accepts.includes(p.position))
    if (hit) slots[key] = hit
  }

  // 4. bench, in draft order
  for (const key of BENCH_KEYS) {
    if (slots[key] !== null) continue
    const hit = remaining.shift()
    if (!hit) break
    slots[key] = hit
  }

  return { slots, overflow: remaining }
}

export interface SlotRow {
  key: string
  label: string
}

/**
 * The rows to draw for a set of rosters — the 16 fixed slots plus however many
 * extra bench rows are needed so that **no drafted player is invisible**.
 *
 * The 16 rows assume a roster shaped like the sheet's: one of each position, a
 * FLEX, a SUPERFLEX, a DEFENSE, and six bench. A manager who skips the defense
 * entirely still has 16 players, but one of them has nowhere to go — the DEF row
 * stays empty and `autoSlot` hands the leftover back in `overflow`. Both Nate and
 * Mario finished 2026 without a defense, so both had a player they had paid for
 * that the board simply did not draw.
 *
 * Rather than force a player into a slot they don't belong in — which would make
 * the grid lie about roster shape — the board grows a bench row. `extraBench` is
 * the largest overflow across the managers being shown, so every column keeps the
 * same rows and the grid stays a grid.
 */
export function slotRows(extraBench: number): SlotRow[] {
  return [
    ...SLOTS.map((s) => ({ key: s.key, label: s.label })),
    ...Array.from({ length: Math.max(0, extraBench) }, (_, i) => ({
      key: `BNX${i + 1}`,
      label: 'BENCH',
    })),
  ]
}

/** How many extra bench rows a set of laid-out rosters needs between them. */
export function extraBenchRows(laid: Array<{ overflow: unknown[] }>): number {
  return laid.reduce((max, l) => Math.max(max, l.overflow.length), 0)
}

/**
 * The pick in a given row of `slotRows()`. Rows past the fixed 16 read from
 * `overflow`, in draft order.
 */
export function pickInRow<T>(
  laid: { slots: Record<string, T | null>; overflow: T[] } | undefined,
  rowIndex: number,
): T | null {
  if (!laid) return null
  if (rowIndex < SLOTS.length) return laid.slots[SLOTS[rowIndex].key] ?? null
  return laid.overflow[rowIndex - SLOTS.length] ?? null
}

// ---------------------------------------------------------------------------
// Market — what has been drafted at each position, and for how much
// ---------------------------------------------------------------------------

/**
 * The positions the market view reports on.
 *
 * **K and DEF are excluded deliberately.** They go for a dollar or two, nobody's
 * strategy turns on them, and including them drags every league-wide number
 * toward the floor. Four positions, not six.
 */
export const MARKET_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
export type MarketPosition = (typeof MARKET_POSITIONS)[number]

export interface MarketRow {
  position: MarketPosition
  drafted: number
  spent: number
  /** Median beats mean here — see the note on `positionMarket`. */
  median: number
  mean: number
  min: number
  max: number
  /** Still in the pool at this position, if a pool was supplied. */
  remaining: number
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

/**
 * Count and price every drafted player, grouped by position.
 *
 * ⚠️ **Groups on the player's real position, never on their board slot.**
 * `autoSlot()` and `slotOverride` are display-only, and a player shown in FLEX,
 * SUPERFLEX or BENCH still *is* a WR. Grouping by grid row would scatter one
 * position across three buckets and let a presentation concern leak into a number
 * people make bidding decisions on.
 *
 * **Median is reported alongside the mean and leads the UI.** Positional spend is
 * a small, skewed sample — one $70 panic buy drags an average far enough to
 * mislead, which is exactly the situation medians exist for.
 */
export function positionMarket(
  picks: Array<{ position: string; price: number }>,
  pool: Array<{ position: string }> = [],
): MarketRow[] {
  return MARKET_POSITIONS.map((position) => {
    const prices = picks.filter((p) => p.position === position).map((p) => p.price)
    return {
      position,
      drafted: prices.length,
      spent: prices.reduce((s, p) => s + p, 0),
      median: median(prices),
      mean: prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : 0,
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      remaining: pool.filter((p) => p.position === position).length,
    }
  })
}

/** Position counts for the info strip. Never used to restrict anything. */
export function positionCounts(picks: SlottablePick[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of picks) counts[p.position] = (counts[p.position] ?? 0) + 1
  return counts
}
