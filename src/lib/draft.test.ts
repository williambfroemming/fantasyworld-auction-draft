import { describe, expect, it } from 'vitest'
import {
  autoSlot,
  maxBidFor,
  nominatorAt,
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

describe('snake nomination order', () => {
  // The 2025 seating, read off the sheet's pick log.
  const SEATS = [
    'Gabes', 'Grossman', 'Bolek', 'Bill', 'Daniel',
    'Nate', 'Mario', 'Jack', 'Bryan', 'Justin',
  ]

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
