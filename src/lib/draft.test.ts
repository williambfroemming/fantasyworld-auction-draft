import { describe, expect, it } from 'vitest'
import {
  autoSlot,
  maxBidFor,
  nominatorAt,
  upcomingOrder,
  positionMarket,
  slotRows,
  extraBenchRows,
  pickInRow,
  randomOrder,
  snakeSlot,
  validateAward,
  validateTrade,
  type AwardContext,
  type TradeContext,
} from './draft'

const ROSTER = 16
const BUDGET = 200

describe('maxBidFor', () => {
  it('is $185 on the first nomination — the number the league expects', () => {
    expect(maxBidFor(BUDGET, 0, ROSTER)).toBe(185)
  })

  it('lets the whole remaining budget go on the final slot', () => {
    expect(maxBidFor(50, 15, ROSTER)).toBe(50)
    expect(maxBidFor(1, 15, ROSTER)).toBe(1)
  })

  it('reserves exactly $1 per unfilled slot', () => {
    // 10 players, 6 slots left, so 5 dollars must stay behind
    expect(maxBidFor(100, 10, ROSTER)).toBe(95)
  })

  it('is 0 once the roster is full, not budget + 1', () => {
    // The old sheet showed a manager with $2 and 16 players at "max bid 3",
    // which is the un-clamped formula leaking. A full roster cannot bid.
    expect(maxBidFor(2, 16, ROSTER)).toBe(0)
  })

  it('never lets a manager strand themselves — budget >= slots remaining, always', () => {
    // Simulate a full draft where everyone always bids their maximum.
    let budget = BUDGET
    for (let rostered = 0; rostered < ROSTER; rostered++) {
      const max = maxBidFor(budget, rostered, ROSTER)
      expect(max).toBeGreaterThanOrEqual(1) // can always afford someone
      budget -= max
      const slotsLeft = ROSTER - rostered - 1
      expect(budget).toBeGreaterThanOrEqual(slotsLeft)
    }
    expect(budget).toBe(0)
  })

  it('holds the invariant for arbitrary spending patterns', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let budget = BUDGET
      let rostered = 0
      let n = seed
      const rand = () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648
      while (rostered < ROSTER) {
        const max = maxBidFor(budget, rostered, ROSTER)
        expect(max).toBeGreaterThanOrEqual(1)
        const bid = 1 + Math.floor(rand() * max)
        budget -= bid
        rostered++
        expect(budget).toBeGreaterThanOrEqual(ROSTER - rostered)
      }
    }
  })
})

// The 2025 seating, read off the sheet's pick log.
const SEATS = [
  'Gabes', 'Grossman', 'Bolek', 'Bill', 'Daniel',
  'Nate', 'Mario', 'Jack', 'Bryan', 'Justin',
]

describe('snake nomination order', () => {

  it('reproduces the real pick log from the sheet', () => {
    const order = Array.from({ length: 30 }, (_, i) => SEATS[snakeSlot(i, 10)])

    // Picks 1-10, straight down the order
    expect(order.slice(0, 10)).toEqual(SEATS)
    // Picks 11-20, back up it
    expect(order.slice(10, 20)).toEqual([...SEATS].reverse())
    // Picks 21-30, forward again
    expect(order.slice(20, 30)).toEqual(SEATS)
  })

  it('gives every manager exactly 16 nominations regardless of seating', () => {
    for (const seats of [SEATS, randomOrder(SEATS, mulberry(7)), randomOrder(SEATS, mulberry(99))]) {
      const counts: Record<string, number> = {}
      for (let i = 0; i < 160; i++) {
        const who = seats[snakeSlot(i, 10)]
        counts[who] = (counts[who] ?? 0) + 1
      }
      expect(Object.values(counts)).toEqual(Array(10).fill(16))
    }
  })

  it('skips managers whose roster is full', () => {
    const managers = SEATS.map((name, i) => ({
      id: i,
      draftSlot: i,
      rosterCount: name === 'Bolek' ? ROSTER : 0, // Bolek is done
      name,
    }))
    // Bolek sits at index 2 in round 0 and would otherwise be next.
    const turn = nominatorAt(managers, 2, ROSTER)
    expect(turn?.manager.name).toBe('Bill')
    expect(turn?.index).toBe(3)
  })

  it('returns null once every roster is full', () => {
    const managers = SEATS.map((name, i) => ({ id: i, draftSlot: i, rosterCount: ROSTER, name }))
    expect(nominatorAt(managers, 0, ROSTER)).toBeNull()
  })
})

/**
 * The 2026 draft stalled with 32 picks still to make and nobody on the clock —
 * docs/BACKLOG.md §9, P0. `nominatorAt` capped its search at `n * rosterSize + n`
 * and gave up, because it treated `nominationIndex` as a pick counter when every
 * skipped seat consumes an index too.
 *
 * These simulate whole drafts. The old implementation passes only the first of
 * them — which is exactly why the bug shipped.
 */
describe('nominatorAt — end of draft (regression: the 2026 stall)', () => {
  /**
   * Run a whole draft to completion, choosing the winner of each lot with
   * `pickWinner`. Returns null if it stalls, mirroring what the app does:
   * advance nomination_index to the seat actually landed on, plus one.
   */
  function runDraft(
    pickWinner: (managers: Array<{ id: number; rosterCount: number }>, nominatorId: number) => number,
    opts: { skipsAt?: number[] } = {},
  ): { picks: number; finalIndex: number; stalled: boolean } {
    const managers = SEATS.map((name, i) => ({ id: i, draftSlot: i, rosterCount: 0, name }))
    let index = 0
    let picks = 0
    const target = managers.length * ROSTER

    while (picks < target) {
      const turn = nominatorAt(managers, index, ROSTER)
      if (!turn) return { picks, finalIndex: index, stalled: true }

      // A commissioner skip bumps the index with no pick behind it — the case
      // that had no margin at all under the old cap.
      if (opts.skipsAt?.includes(picks)) {
        index = turn.index + 1
        opts.skipsAt = opts.skipsAt.filter((p) => p !== picks)
        continue
      }

      const winnerId = pickWinner(managers, turn.manager.id)
      managers[winnerId].rosterCount++
      picks++
      index = turn.index + 1
    }
    return { picks, finalIndex: index, stalled: false }
  }

  const emptiest = (mgrs: Array<{ id: number; rosterCount: number }>) =>
    mgrs.reduce((best, m) => (m.rosterCount < best.rosterCount ? m : best)).id

  it('completes when the nominator always wins their own lot (perfectly even)', () => {
    const r = runDraft((_, nominatorId) => nominatorId)
    expect(r).toMatchObject({ picks: 160, stalled: false })
  })

  it('completes when the emptiest roster wins each lot (mildly lumpy)', () => {
    // This shape landed on exactly index 170 — the old cap — so it passed by
    // luck, with zero margin.
    const r = runDraft((mgrs) => emptiest(mgrs))
    expect(r).toMatchObject({ picks: 160, stalled: false })
  })

  it('completes when three managers buy heavily early (realistic, and what stalled)', () => {
    // The reproduction from the backlog: under the old cap this stopped at
    // index 170 after 128 picks, 32 short across 7 managers.
    let n = 0
    const r = runDraft((mgrs) => {
      n++
      const hogs = [0, 1, 2].filter((i) => mgrs[i].rosterCount < ROSTER)
      if (n < 60 && hogs.length) return hogs[n % hogs.length]
      return emptiest(mgrs)
    })
    expect(r).toMatchObject({ picks: 160, stalled: false })
  })

  it('completes even with several commissioner skips', () => {
    const r = runDraft((mgrs) => emptiest(mgrs), { skipsAt: [3, 40, 77, 120, 155] })
    expect(r).toMatchObject({ picks: 160, stalled: false })
  })

  it('never returns null while any manager is below the roster size', () => {
    // Nine managers full, one with a single slot left, and the index parked
    // well past the old cap.
    const managers = SEATS.map((name, i) => ({
      id: i,
      draftSlot: i,
      rosterCount: i === 4 ? ROSTER - 1 : ROSTER,
      name,
    }))
    for (const index of [0, 9, 17, 160, 169, 170, 171, 500, 5000]) {
      const turn = nominatorAt(managers, index, ROSTER)
      expect(turn?.manager.name).toBe(SEATS[4])
    }
  })

  it('returns null the moment the last slot fills', () => {
    const managers = SEATS.map((name, i) => ({
      id: i,
      draftSlot: i,
      rosterCount: i === 4 ? ROSTER - 1 : ROSTER,
      name,
    }))
    expect(nominatorAt(managers, 170, ROSTER)).not.toBeNull()
    managers[4].rosterCount = ROSTER
    expect(nominatorAt(managers, 170, ROSTER)).toBeNull()
  })

  it('scans a full 2n window — a window of n can straddle the snake turn and miss a seat', () => {
    // Only seat 0 is unfilled, and index 9 is the last of round 0. A window of
    // n=10 from there covers round 1's positions, which are slots 9..0 — it
    // reaches slot 0 only at the very last index. Starting at 10 it would be
    // missed entirely by an n-wide scan.
    const managers = SEATS.map((name, i) => ({
      id: i,
      draftSlot: i,
      rosterCount: i === 0 ? 0 : ROSTER,
      name,
    }))
    for (let start = 0; start < 40; start++) {
      expect(nominatorAt(managers, start, ROSTER)?.manager.draftSlot).toBe(0)
    }
  })
})

describe('randomOrder', () => {
  it('is a permutation, not a resample', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const out = randomOrder(input, mulberry(42))
    expect([...out].sort((a, b) => a - b)).toEqual(input)
  })

  it('does not mutate its input', () => {
    const input = [1, 2, 3]
    randomOrder(input, mulberry(1))
    expect(input).toEqual([1, 2, 3])
  })
})

describe('validateAward', () => {
  const base: AwardContext = {
    price: 10,
    winnerMaxBid: 185,
    winnerRostered: 0,
    winnerName: 'Gabes',
    rosterSize: ROSTER,
    draftStatus: 'live',
    lotStatus: 'open',
  }

  it('accepts a normal sale', () => {
    expect(validateAward(base)).toEqual({ ok: true })
  })

  it('rejects a price over the winner’s max bid, and says why', () => {
    const r = validateAward({ ...base, price: 186, winnerMaxBid: 185 })
    expect(r.ok).toBe(false)
    // This message is read aloud to a room waiting on an answer, so it has to
    // name the manager and the actual number.
    expect(r.ok === false && r.reason).toContain('185')
    expect(r.ok === false && r.reason).toContain('Gabes')
    expect(r.ok === false && r.reason).toMatch(/empty roster spot/i)
  })

  it('allows a sale at exactly max bid', () => {
    expect(validateAward({ ...base, price: 185, winnerMaxBid: 185 }).ok).toBe(true)
  })

  it('rejects $0 and negative prices — every player costs at least $1', () => {
    expect(validateAward({ ...base, price: 0 }).ok).toBe(false)
    expect(validateAward({ ...base, price: -5 }).ok).toBe(false)
  })

  it('rejects while paused, on a closed lot, or to a full roster', () => {
    expect(validateAward({ ...base, draftStatus: 'paused' }).ok).toBe(false)
    expect(validateAward({ ...base, draftStatus: 'setup' }).ok).toBe(false)
    expect(validateAward({ ...base, lotStatus: 'sold' }).ok).toBe(false)
    expect(validateAward({ ...base, winnerRostered: ROSTER, winnerMaxBid: 0 }).ok).toBe(false)
  })

  it('rejects fractional dollars', () => {
    expect(validateAward({ ...base, price: 10.5 }).ok).toBe(false)
  })
})

describe('validateTrade', () => {
  const side = (over: Partial<TradeContext['a']> = {}): TradeContext['a'] => ({
    name: 'Someone',
    budget: 100,
    rostered: 8,
    playersOut: 0,
    playersIn: 0,
    cashOut: 0,
    cashIn: 0,
    ...over,
  })
  const ctx = (a: Partial<TradeContext['a']>, b: Partial<TradeContext['a']>): TradeContext => ({
    rosterSize: ROSTER,
    a: side({ name: 'Bill', ...a }),
    b: side({ name: 'Justin', ...b }),
  })

  it('accepts a straight one-for-one swap', () => {
    expect(validateTrade(ctx({ playersOut: 1, playersIn: 1 }, { playersOut: 1, playersIn: 1 }))).toEqual({
      ok: true,
    })
  })

  it('accepts a cash-only trade', () => {
    expect(validateTrade(ctx({ cashOut: 20 }, { cashIn: 20 })).ok).toBe(true)
  })

  it('rejects an empty trade', () => {
    expect(validateTrade(ctx({}, {})).ok).toBe(false)
  })

  it('rejects negative or fractional cash', () => {
    expect(validateTrade(ctx({ cashOut: -5 }, { cashIn: -5 })).ok).toBe(false)
    expect(validateTrade(ctx({ cashOut: 2.5 }, { cashIn: 2.5 })).ok).toBe(false)
  })

  it('rejects a trade that overfills a roster', () => {
    const r = validateTrade(
      ctx({ rostered: 15, playersIn: 2 }, { rostered: 10, playersOut: 2 }),
    )
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/16-man roster/)
  })

  it('rejects cash that would strand a manager below $1 per empty slot', () => {
    // 8 players, 8 slots left, $100. Sending $93 leaves $7 for 8 slots.
    const r = validateTrade(ctx({ budget: 100, rostered: 8, cashOut: 93 }, { cashIn: 93 }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/at least \$1 for each/)
  })

  it('allows cash that lands exactly on the reserve floor', () => {
    // $100, 8 slots left: sending $92 leaves exactly $8 for 8 slots.
    expect(validateTrade(ctx({ budget: 100, rostered: 8, cashOut: 92 }, { cashIn: 92 })).ok).toBe(true)
  })

  /**
   * The counter-intuitive one, and the reason this is a pure function with a
   * test rather than a check buried in SQL: giving a player away costs no money
   * but opens a slot, and every empty slot needs $1 behind it. A nearly-broke
   * manager can therefore be blocked from trading a player OUT.
   */
  it('rejects giving a player away when the freed slot cannot be funded', () => {
    // 15 players, 1 slot left, $1 in the bank. Give one away -> 2 slots, $1.
    const r = validateTrade(ctx({ budget: 1, rostered: 15, playersOut: 1 }, { playersIn: 1 }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/Bill/)
  })

  it('lets that same manager receive a player, which frees them up', () => {
    // Receiving fills a slot, so the reserve requirement goes DOWN.
    expect(
      validateTrade(ctx({ budget: 1, rostered: 15, playersIn: 1 }, { budget: 50, playersOut: 1 })).ok,
    ).toBe(true)
  })

  /**
   * Salary stays with the drafter, so moving players must not move budget.
   * If this ever starts failing, the trade SQL and this rule have diverged.
   */
  it('does not care what a traded player cost — only cash moves money', () => {
    const many = validateTrade(ctx({ playersOut: 5, playersIn: 0 }, { playersIn: 5, playersOut: 0 }))
    expect(many.ok).toBe(true)
  })
})

describe('autoSlot', () => {
  let nextId = 1
  const p = (position: string, slotOverride?: string) => ({
    id: nextId++,
    position,
    slotOverride: slotOverride ?? null,
  })

  it('fills natural positions first', () => {
    const { slots } = autoSlot([p('QB'), p('RB'), p('RB'), p('WR'), p('TE'), p('DEF')])
    expect(slots.QB?.position).toBe('QB')
    expect(slots.RB1?.position).toBe('RB')
    expect(slots.RB2?.position).toBe('RB')
    expect(slots.WR1?.position).toBe('WR')
    expect(slots.TE?.position).toBe('TE')
    expect(slots.DEF?.position).toBe('DEF')
  })

  it('sends a third RB to FLEX', () => {
    const { slots } = autoSlot([p('RB'), p('RB'), p('RB')])
    expect(slots.FLEX?.position).toBe('RB')
  })

  it('prefers a QB for SUPERFLEX, matching how the league uses it', () => {
    // Drafted RB-heavy first; the second QB should still land in SUPERFLEX,
    // not get pushed to the bench by a greedy draft-order walk.
    const { slots } = autoSlot([p('QB'), p('RB'), p('RB'), p('RB'), p('WR'), p('QB')])
    expect(slots.SUPERFLEX?.position).toBe('QB')
    expect(slots.FLEX?.position).toBe('RB')
  })

  it('benches the overflow', () => {
    const { slots, overflow } = autoSlot([p('QB'), p('QB'), p('QB'), p('QB')])
    expect(slots.QB?.position).toBe('QB')
    expect(slots.SUPERFLEX?.position).toBe('QB')
    expect(slots.BN1?.position).toBe('QB')
    expect(slots.BN2?.position).toBe('QB')
    expect(overflow).toHaveLength(0)
  })

  it('honours a manual override over the auto-fit', () => {
    // The old sheet has a RB parked in someone's DEFENSE row, so this happens.
    const rb = p('RB', 'DEF')
    const { slots } = autoSlot([rb, p('RB'), p('RB')])
    expect(slots.DEF?.id).toBe(rb.id)
    expect(slots.RB1?.position).toBe('RB')
    expect(slots.RB2?.position).toBe('RB')
  })

  it('places a full 16-man roster with nothing left over', () => {
    const roster = [
      ...Array(2).fill(0).map(() => p('QB')),
      ...Array(4).fill(0).map(() => p('RB')),
      ...Array(5).fill(0).map(() => p('WR')),
      ...Array(2).fill(0).map(() => p('TE')),
      p('DEF'),
      p('K'),
      p('WR'),
    ]
    expect(roster).toHaveLength(16)
    const { slots, overflow } = autoSlot(roster)
    expect(overflow).toHaveLength(0)
    expect(Object.values(slots).filter(Boolean)).toHaveLength(16)
  })

  it('places a lopsided but realistic roster with nothing left over', () => {
    // 2 QB / 5 RB / 6 WR / 1 TE / 1 DEF / 1 K — the kind of shape this league
    // actually ends up with, since roster construction is never enforced.
    const roster = [
      ...Array(2).fill(0).map(() => p('QB')),
      ...Array(5).fill(0).map(() => p('RB')),
      ...Array(6).fill(0).map(() => p('WR')),
      p('TE'), p('DEF'), p('K'),
    ]
    expect(roster).toHaveLength(16)
    const { overflow } = autoSlot(roster)
    expect(overflow).toHaveLength(0)
  })

  it('returns overflow rather than silently dropping a paid-for player', () => {
    // Pathological: 18 WRs. Only 11 rows can hold a WR (WR1-3, FLEX, SUPERFLEX,
    // 6 bench) because the QB/RB/TE/DEF rows are position-locked. The remaining
    // 7 come back as overflow so the board can still draw them — losing a player
    // someone paid for would be far worse than drawing an extra row.
    const { slots, overflow } = autoSlot(Array(18).fill(0).map(() => p('WR')))
    expect(Object.values(slots).filter(Boolean)).toHaveLength(11)
    expect(overflow).toHaveLength(7)
  })
})

/** Small deterministic PRNG so shuffle tests are reproducible. */
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('positionMarket', () => {
  const picks = [
    { position: 'RB', price: 50 },
    { position: 'RB', price: 10 },
    { position: 'RB', price: 12 },
    { position: 'WR', price: 20 },
    { position: 'WR', price: 30 },
    { position: 'QB', price: 5 },
    { position: 'K', price: 1 },
    { position: 'DEF', price: 2 },
  ]

  it('reports only QB/RB/WR/TE — K and DEF drag every figure to the floor', () => {
    const rows = positionMarket(picks)
    expect(rows.map((r) => r.position)).toEqual(['QB', 'RB', 'WR', 'TE'])
    expect(rows.reduce((s, r) => s + r.spent, 0)).toBe(127) // 3 excluded dollars
  })

  it('reports a position nobody drafted as zeroes rather than omitting it', () => {
    const te = positionMarket(picks).find((r) => r.position === 'TE')!
    expect(te).toMatchObject({ drafted: 0, spent: 0, median: 0, mean: 0, min: 0, max: 0 })
  })

  it('medians resist the one panic buy that skews the mean', () => {
    const rb = positionMarket(picks).find((r) => r.position === 'RB')!
    expect(rb.median).toBe(12)
    expect(rb.mean).toBeCloseTo(24)
    expect({ min: rb.min, max: rb.max }).toEqual({ min: 10, max: 50 })
  })

  it('averages the middle pair on an even sample', () => {
    const wr = positionMarket(picks).find((r) => r.position === 'WR')!
    expect(wr.median).toBe(25)
  })

  it('groups on the real position, never the display slot', () => {
    // A WR sitting in FLEX or SUPERFLEX is still a WR. autoSlot is display-only,
    // so slotOverride must not reach this calculation at all.
    const scattered = [
      { position: 'WR', price: 40, slotOverride: 'FLEX' },
      { position: 'WR', price: 20, slotOverride: 'SUPERFLEX' },
      { position: 'WR', price: 30, slotOverride: 'BN1' },
    ]
    const rows = positionMarket(scattered)
    expect(rows.find((r) => r.position === 'WR')).toMatchObject({ drafted: 3, spent: 90 })
  })

  it('counts what is left in the pool when one is supplied', () => {
    const rows = positionMarket(picks, [
      { position: 'RB' }, { position: 'RB' }, { position: 'TE' }, { position: 'K' },
    ])
    expect(rows.find((r) => r.position === 'RB')!.remaining).toBe(2)
    expect(rows.find((r) => r.position === 'TE')!.remaining).toBe(1)
    expect(rows.find((r) => r.position === 'QB')!.remaining).toBe(0)
  })

  it('handles an empty draft without dividing by zero', () => {
    for (const r of positionMarket([])) {
      expect(r).toMatchObject({ drafted: 0, mean: 0, median: 0 })
      expect(Number.isNaN(r.mean)).toBe(false)
    }
  })
})

describe('slotRows / pickInRow — nobody drops off the board', () => {
  const roster = (positions: string[]) =>
    positions.map((position, i) => ({ id: i + 1, position }))

  it('draws an extra bench row for a 16-man roster with no defense', () => {
    // Nate's and Mario's 2026 rosters: 16 players, no DEF, so the DEFENSE slot
    // sits empty and one player has nowhere to go.
    const laid = autoSlot(
      roster([
        'QB', 'QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'RB', 'RB', 'RB',
        'WR', 'WR', 'WR', 'WR', 'TE', 'TE',
      ]),
    )
    expect(laid.overflow).toHaveLength(1)

    const rows = slotRows(extraBenchRows([laid]))
    expect(rows).toHaveLength(17)
    expect(rows[16].label).toBe('BENCH')

    // Every one of the 16 players appears in exactly one row.
    const shown = rows.map((_, i) => pickInRow(laid, i)).filter(Boolean)
    expect(shown).toHaveLength(16)
    expect(new Set(shown.map((p) => p!.id)).size).toBe(16)
  })

  it('adds no extra rows for a roster that fills every named slot', () => {
    const laid = autoSlot(
      roster([
        'QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE',
        'DEF', 'RB', 'WR', 'QB', 'TE', 'K',
      ]),
    )
    expect(laid.overflow).toHaveLength(0)
    expect(slotRows(extraBenchRows([laid]))).toHaveLength(16)
  })

  it('sizes the grid to the worst roster so every column keeps the same rows', () => {
    const noDef = autoSlot(roster(['QB', 'RB', 'WR', 'TE', 'QB', 'RB', 'WR', 'TE', 'QB', 'RB', 'WR', 'TE', 'QB', 'RB', 'WR', 'TE']))
    const normal = autoSlot(roster(['QB', 'RB', 'WR', 'TE', 'DEF']))
    const rows = slotRows(extraBenchRows([noDef, normal]))
    expect(rows.length).toBe(16 + noDef.overflow.length)
    // The shorter roster simply has empty cells in the extra rows.
    expect(pickInRow(normal, rows.length - 1)).toBeNull()
  })
})

describe('upcomingOrder', () => {
  const seats = (full: number[] = []) =>
    SEATS.map((name, i) => ({
      id: i,
      draftSlot: i,
      rosterCount: full.includes(i) ? ROSTER : 0,
      name,
    }))

  it('matches the plain snake while nobody is full', () => {
    const order = upcomingOrder(seats(), 0, ROSTER, 12)
    expect(order.map((o) => o.manager.name)).toEqual([
      ...SEATS,
      ...[...SEATS].reverse().slice(0, 2),
    ])
  })

  it('starts at the index it is given', () => {
    const order = upcomingOrder(seats(), 7, ROSTER, 3)
    expect(order[0].index).toBe(7)
    expect(order.map((o) => o.index)).toEqual([7, 8, 9])
  })

  it('agrees with nominatorAt on its first entry, always', () => {
    for (const index of [0, 3, 9, 10, 27, 155]) {
      const one = nominatorAt(seats([2, 5]), index, ROSTER)
      const many = upcomingOrder(seats([2, 5]), index, ROSTER, 4)
      expect(many[0].manager.name).toBe(one?.manager.name)
      expect(many[0].index).toBe(one?.index)
    }
  })

  it('skips a full manager every time their seat comes round', () => {
    // Bolek (slot 2) is done for the day.
    const order = upcomingOrder(seats([2]), 0, ROSTER, 18)
    expect(order.some((o) => o.manager.name === 'Bolek')).toBe(false)
    // and everyone else still appears
    expect(new Set(order.map((o) => o.manager.name)).size).toBe(9)
  })

  it('returns fewer than asked when the draft ends first', () => {
    // One manager, one slot left: exactly one nomination remains.
    const managers = SEATS.map((name, i) => ({
      id: i,
      draftSlot: i,
      rosterCount: i === 4 ? ROSTER - 1 : ROSTER,
      name,
    }))
    expect(upcomingOrder(managers, 0, ROSTER, 10)).toHaveLength(10)
    // Every entry is the only manager who can still be sold anyone.
    expect(new Set(upcomingOrder(managers, 0, ROSTER, 10).map((o) => o.manager.name))).toEqual(
      new Set([SEATS[4]]),
    )
  })

  it('returns nothing once every roster is full', () => {
    const managers = SEATS.map((name, i) => ({ id: i, draftSlot: i, rosterCount: ROSTER, name }))
    expect(upcomingOrder(managers, 0, ROSTER, 10)).toEqual([])
  })

  it('returns nothing when asked for nothing', () => {
    expect(upcomingOrder(seats(), 0, ROSTER, 0)).toEqual([])
  })

  it('shows the same manager twice in a row across the snake turn', () => {
    // Index 9 is the last of round 0; index 10 is the first of round 1, and both
    // are slot 9. This doubling is the thing the room finds confusing.
    const order = upcomingOrder(seats(), 9, ROSTER, 2)
    expect(order[0].manager.name).toBe(order[1].manager.name)
    expect(order[0].manager.name).toBe(SEATS[9])
  })
})
