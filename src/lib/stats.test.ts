import { describe, expect, it } from 'vitest'
import {
  SPEND_COLUMNS,
  draftComplete,
  draftersByPick,
  managerPace,
  nominationStats,
  spendBlocks,
  spendCurve,
  teamSpend,
  valueVsRoom,
  type StatsInput,
  type StatsPick,
  type StatsTrade,
} from './stats'

const ROSTER = 16
const BUDGET = 200

let nextId = 1
function pick(p: Partial<StatsPick> = {}): StatsPick {
  const id = p.id ?? nextId++
  return {
    id,
    pickNo: p.pickNo ?? id,
    managerId: p.managerId ?? 1,
    nominatorId: p.nominatorId ?? p.managerId ?? 1,
    price: p.price ?? 10,
    position: p.position ?? 'RB',
    name: p.name ?? `Player ${id}`,
    rank: p.rank === undefined ? id : p.rank,
    posRank: p.posRank ?? null,
  }
}

function manager(id: number, over: Partial<StatsInput['managers'][number]> = {}) {
  return {
    id,
    displayName: `M${id}`,
    color: '#fff',
    draftSlot: id - 1,
    budget: over.budget ?? BUDGET,
    rostered: over.rostered ?? 0,
    ...over,
  }
}

function input(over: Partial<StatsInput> = {}): StatsInput {
  return {
    season: 2026,
    rosterSize: ROSTER,
    startingBudget: BUDGET,
    managers: over.managers ?? [manager(1), manager(2)],
    picks: over.picks ?? [],
    trades: over.trades ?? [],
    ...over,
  }
}

function trade(over: Partial<StatsTrade> = {}): StatsTrade {
  return {
    id: over.id ?? 1,
    createdAt: over.createdAt ?? '2026-08-14T20:00:00.000Z',
    managerAId: over.managerAId ?? 1,
    managerBId: over.managerBId ?? 2,
    players: over.players ?? [],
  }
}

describe('draftersByPick', () => {
  it('is the identity when nothing has been traded', () => {
    const picks = [pick({ id: 1, managerId: 1 }), pick({ id: 2, managerId: 2 })]
    const d = draftersByPick(picks, [])
    expect([...d.entries()]).toEqual([
      [1, 1],
      [2, 2],
    ])
  })

  it('rewinds a single trade to the original buyer', () => {
    // Pick 1 now belongs to manager 2, having been traded from 1.
    const picks = [pick({ id: 1, managerId: 2 })]
    const trades = [trade({ managerAId: 1, managerBId: 2, players: [{ pickId: 1, toManagerId: 2 }] })]
    expect(draftersByPick(picks, trades).get(1)).toBe(1)
  })

  it('rewinds a player traded twice, A -> B -> C, all the way to A', () => {
    const picks = [pick({ id: 1, managerId: 3 })]
    const trades = [
      trade({
        id: 1,
        createdAt: '2026-08-14T20:00:00.000Z',
        managerAId: 1,
        managerBId: 2,
        players: [{ pickId: 1, toManagerId: 2 }],
      }),
      trade({
        id: 2,
        createdAt: '2026-08-14T21:00:00.000Z',
        managerAId: 2,
        managerBId: 3,
        players: [{ pickId: 1, toManagerId: 3 }],
      }),
    ]
    expect(draftersByPick(picks, trades).get(1)).toBe(1)
  })

  it('walks newest-first even when the trade log arrives out of order', () => {
    const picks = [pick({ id: 1, managerId: 3 })]
    const trades = [
      trade({
        id: 2,
        createdAt: '2026-08-14T21:00:00.000Z',
        managerAId: 2,
        managerBId: 3,
        players: [{ pickId: 1, toManagerId: 3 }],
      }),
      trade({
        id: 1,
        createdAt: '2026-08-14T20:00:00.000Z',
        managerAId: 1,
        managerBId: 2,
        players: [{ pickId: 1, toManagerId: 2 }],
      }),
    ]
    expect(draftersByPick(picks, trades).get(1)).toBe(1)
  })

  it('ignores a trade naming a pick that no longer exists', () => {
    const picks = [pick({ id: 1, managerId: 1 })]
    const trades = [trade({ players: [{ pickId: 999, toManagerId: 2 }] })]
    const d = draftersByPick(picks, trades)
    expect(d.get(1)).toBe(1)
    expect(d.has(999)).toBe(false)
  })

  it('leaves a pick alone when the log disagrees with current ownership', () => {
    // Commissioner reassigned it afterwards: it is on 3, but the trade says 2.
    const picks = [pick({ id: 1, managerId: 3 })]
    const trades = [trade({ managerAId: 1, managerBId: 2, players: [{ pickId: 1, toManagerId: 2 }] })]
    expect(draftersByPick(picks, trades).get(1)).toBe(3)
  })
})

describe('teamSpend', () => {
  it('rows total to what the manager spent, and OTHER catches K and DEF', () => {
    const picks = [
      pick({ managerId: 1, position: 'QB', price: 40 }),
      pick({ managerId: 1, position: 'RB', price: 30 }),
      pick({ managerId: 1, position: 'WR', price: 20 }),
      pick({ managerId: 1, position: 'TE', price: 5 }),
      pick({ managerId: 1, position: 'DEF', price: 2 }),
      pick({ managerId: 1, position: 'K', price: 1 }),
    ]
    const { rows } = teamSpend(input({ picks, managers: [manager(1, { budget: 102, rostered: 6 })] }))
    const r = rows[0]
    expect(r.byPosition).toEqual({ QB: 40, RB: 30, WR: 20, TE: 5, OTHER: 3 })
    expect(SPEND_COLUMNS.reduce((s, c) => s + r.byPosition[c], 0)).toBe(r.spent)
    expect(r.spent).toBe(98)
  })

  it('reports zero drift when spend and budget add up', () => {
    const picks = [pick({ managerId: 1, price: 50 })]
    const { rows } = teamSpend(input({ picks, managers: [manager(1, { budget: 150, rostered: 1 })] }))
    expect(rows[0].drift).toBe(0)
  })

  it('surfaces drift when money moved without a pick behind it', () => {
    // $10 of trade cash received: spent 50, budget 160, so 200 - 210 = -10.
    const picks = [pick({ managerId: 1, price: 50 })]
    const { rows } = teamSpend(input({ picks, managers: [manager(1, { budget: 160, rostered: 1 })] }))
    expect(rows[0].drift).toBe(-10)
  })

  it('attributes spend to the DRAFTER, not the current owner, across a trade', () => {
    // Manager 1 bought a $50 player and traded him to manager 2. The league's
    // rule is the salary stays with 1 — so 1's row must still show $50.
    const picks = [pick({ id: 1, managerId: 2, position: 'RB', price: 50 })]
    const trades = [trade({ managerAId: 1, managerBId: 2, players: [{ pickId: 1, toManagerId: 2 }] })]
    const { rows } = teamSpend(
      input({ picks, trades, managers: [manager(1, { budget: 150 }), manager(2)] }),
    )
    expect(rows.find((r) => r.managerId === 1)!.spent).toBe(50)
    expect(rows.find((r) => r.managerId === 2)!.spent).toBe(0)
  })

  it('scales bars off the largest single cell across the whole league', () => {
    const picks = [
      pick({ managerId: 1, position: 'RB', price: 110 }),
      pick({ managerId: 2, position: 'RB', price: 39 }),
    ]
    expect(teamSpend(input({ picks })).peak).toBe(110)
  })

  it('handles a league where nobody has drafted yet', () => {
    const { rows, totals, peak } = teamSpend(input())
    expect(rows.every((r) => r.spent === 0)).toBe(true)
    expect(totals.spent).toBe(0)
    expect(peak).toBe(1) // never 0, so a bar width never divides by zero
  })
})

describe('spendBlocks', () => {
  it('splits into exact blocks and reports the decay', () => {
    const picks = Array.from({ length: 40 }, (_, i) =>
      pick({ pickNo: i + 1, price: i < 20 ? 30 : 5 }),
    )
    const blocks = spendBlocks(picks, 20)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ fromPick: 1, toPick: 20, count: 20, avg: 30 })
    expect(blocks[1]).toMatchObject({ fromPick: 21, toPick: 40, count: 20, avg: 5 })
  })

  it('keeps a short final block rather than dropping it', () => {
    const picks = Array.from({ length: 25 }, (_, i) => pick({ pickNo: i + 1, price: 4 }))
    const blocks = spendBlocks(picks, 20)
    expect(blocks).toHaveLength(2)
    expect(blocks[1].count).toBe(5)
  })

  it('sorts by pick number regardless of input order', () => {
    const picks = [pick({ pickNo: 3, price: 1 }), pick({ pickNo: 1, price: 9 }), pick({ pickNo: 2, price: 5 })]
    expect(spendBlocks(picks, 2)[0]).toMatchObject({ fromPick: 1, toPick: 2 })
  })

  it('returns nothing for an empty draft or a nonsense block size', () => {
    expect(spendBlocks([], 20)).toEqual([])
    expect(spendBlocks([pick()], 0)).toEqual([])
  })

  it('produces one block when the block size exceeds the draft', () => {
    expect(spendBlocks([pick(), pick()], 500)).toHaveLength(1)
  })
})

describe('spendCurve', () => {
  it('is empty but well-formed with no picks', () => {
    const r = spendCurve(input())
    expect(r.league).toEqual([])
    expect(r.lastPick).toBe(0)
    // Every manager still gets a curve, anchored at the origin, so the renderer
    // never has to special-case somebody who has not bought yet.
    expect(r.managers).toHaveLength(2)
    expect(r.managers[0].points).toEqual([{ pickNo: 0, spent: 0 }])
    expect(r.managers[0].total).toBe(0)
    expect(r.managers[0].halfwayPick).toBeNull()
  })

  it('accumulates league spend in pick order regardless of input order', () => {
    const r = spendCurve(
      input({
        picks: [
          pick({ id: 3, pickNo: 3, price: 5 }),
          pick({ id: 1, pickNo: 1, price: 50 }),
          pick({ id: 2, pickNo: 2, price: 20 }),
        ],
      }),
    )
    expect(r.league).toEqual([
      { pickNo: 1, spent: 50 },
      { pickNo: 2, spent: 70 },
      { pickNo: 3, spent: 75 },
    ])
    expect(r.lastPick).toBe(3)
  })

  it('holds a manager flat between their own picks', () => {
    const r = spendCurve(
      input({
        picks: [
          pick({ id: 1, pickNo: 1, managerId: 1, price: 40 }),
          pick({ id: 2, pickNo: 2, managerId: 2, price: 10 }),
          pick({ id: 3, pickNo: 3, managerId: 2, price: 10 }),
          pick({ id: 4, pickNo: 4, managerId: 1, price: 60 }),
        ],
      }),
    )
    const one = r.managers.find((m) => m.managerId === 1)!
    // Points only at picks 1 and 4 — nothing at 2 or 3, which is what makes the
    // drawn line flat across somebody else's buying spree.
    expect(one.points).toEqual([
      { pickNo: 0, spent: 0 },
      { pickNo: 1, spent: 40 },
      { pickNo: 4, spent: 100 },
    ])
    expect(one.total).toBe(100)
    expect(r.peak).toBe(100)
  })

  it('reports the pick at which someone was half done spending', () => {
    const r = spendCurve(
      input({
        picks: [
          // Manager 1 front-loads; manager 2 sits on their money.
          pick({ id: 1, pickNo: 1, managerId: 1, price: 90 }),
          pick({ id: 2, pickNo: 2, managerId: 2, price: 5 }),
          pick({ id: 3, pickNo: 9, managerId: 1, price: 10 }),
          pick({ id: 4, pickNo: 10, managerId: 2, price: 95 }),
        ],
      }),
    )
    expect(r.managers.find((m) => m.managerId === 1)!.halfwayPick).toBe(1)
    expect(r.managers.find((m) => m.managerId === 2)!.halfwayPick).toBe(10)
  })

  /**
   * The non-negotiable, on this view: a trade moves the player but not the
   * salary. Attributing by current ownership would redraw both curves from the
   * trade onward — a wrong answer that looks perfectly plausible.
   */
  it('attributes to the drafter, not the current owner, after a trade', () => {
    const traded = pick({ id: 1, pickNo: 1, managerId: 2, price: 70 })
    const r = spendCurve(
      input({
        picks: [traded, pick({ id: 2, pickNo: 2, managerId: 2, price: 10 })],
        trades: [trade({ players: [{ pickId: 1, toManagerId: 2 }] })],
      }),
    )
    // Manager 1 bought them and keeps the charge even though manager 2 has them.
    expect(r.managers.find((m) => m.managerId === 1)!.total).toBe(70)
    expect(r.managers.find((m) => m.managerId === 2)!.total).toBe(10)
    // The league total is unmoved by the trade either way.
    expect(r.league[r.league.length - 1].spent).toBe(80)
  })

  it('never reports a peak of zero, so the renderer cannot divide by it', () => {
    expect(spendCurve(input()).peak).toBe(1)
  })
})

describe('managerPace', () => {
  it('reports dollars per remaining slot', () => {
    const rows = managerPace(input({ managers: [manager(1, { budget: 60, rostered: 12 })] }))
    expect(rows[0].slotsLeft).toBe(4)
    expect(rows[0].perSlotLeft).toBe(15)
  })

  it('never divides by zero on a full roster', () => {
    const rows = managerPace(input({ managers: [manager(1, { budget: 7, rostered: ROSTER })] }))
    expect(rows[0].perSlotLeft).toBe(0)
    expect(Number.isFinite(rows[0].perSlotLeft)).toBe(true)
  })

  it('excludes full rosters from the room comparison — their money is dead', () => {
    // Two active managers at $10/slot; one full manager sitting on a pile.
    const managers = [
      manager(1, { budget: 60, rostered: 10 }), // 10/slot
      manager(2, { budget: 60, rostered: 10 }), // 10/slot
      manager(3, { budget: 500, rostered: ROSTER }), // full, must not skew
    ]
    const rows = managerPace(input({ managers }))
    expect(rows[0].vsRoom).toBe(0)
    expect(rows[1].vsRoom).toBe(0)
    expect(rows[2].vsRoom).toBe(0)
  })

  it('spends share sums to one across the league', () => {
    const picks = [pick({ managerId: 1, price: 30 }), pick({ managerId: 2, price: 70 })]
    const rows = managerPace(input({ picks }))
    expect(rows.reduce((s, r) => s + r.spentShare, 0)).toBeCloseTo(1)
  })

  it('reports zero share rather than NaN before anyone has spent', () => {
    expect(managerPace(input()).every((r) => r.spentShare === 0)).toBe(true)
  })
})

describe('nominationStats', () => {
  it('counts what each manager put up and what they won', () => {
    const picks = [
      pick({ nominatorId: 1, managerId: 1, price: 10 }),
      pick({ nominatorId: 1, managerId: 2, price: 40 }),
      pick({ nominatorId: 1, managerId: 2, price: 20 }),
    ]
    const [m1] = nominationStats(input({ picks }))
    expect(m1).toMatchObject({ nominated: 3, wonOwn: 1, spentOnOwn: 10, drivenToRivals: 60 })
    expect(m1.winPct).toBeCloseTo(1 / 3)
  })

  it('is zero, not NaN, for a manager who never nominated', () => {
    const [, m2] = nominationStats(input({ picks: [pick({ nominatorId: 1 })] }))
    expect(m2.winPct).toBe(0)
    expect(Number.isNaN(m2.winPct)).toBe(false)
  })

  it('judges by the drafter, so a later trade cannot rewrite who won their own nomination', () => {
    // Manager 1 nominated and bought him, then traded him to 2.
    const picks = [pick({ id: 1, nominatorId: 1, managerId: 2, price: 25 })]
    const trades = [trade({ managerAId: 1, managerBId: 2, players: [{ pickId: 1, toManagerId: 2 }] })]
    const [m1] = nominationStats(input({ picks, trades }))
    expect(m1).toMatchObject({ nominated: 1, wonOwn: 1, drivenToRivals: 0 })
  })
})

describe('draftComplete', () => {
  it('is false while anyone is short of a full roster', () => {
    const managers = [manager(1, { rostered: ROSTER }), manager(2, { rostered: ROSTER - 1 })]
    expect(draftComplete(input({ managers }))).toBe(false)
  })

  it('is true the moment the last slot fills', () => {
    const managers = [manager(1, { rostered: ROSTER }), manager(2, { rostered: ROSTER })]
    expect(draftComplete(input({ managers }))).toBe(true)
  })

  it('is false for an empty league rather than vacuously true', () => {
    expect(draftComplete(input({ managers: [] }))).toBe(false)
  })
})

describe('valueVsRoom', () => {
  /** n same-position picks priced by a function of their index. */
  const ladder = (position: string, n: number, price: (i: number) => number, managerId = 1) =>
    Array.from({ length: n }, (_, i) =>
      pick({ position, rank: i + 1, price: price(i), managerId, name: `${position}${i + 1}` }),
    )

  it('finds a planted outlier as the top overpay', () => {
    const picks = ladder('RB', 12, (i) => (i === 5 ? 60 : 20))
    const { scored } = valueVsRoom(input({ picks }))
    expect(scored[0].name).toBe('RB6')
    expect(scored[0].benchmark).toBe(20)
    expect(scored[0].delta).toBe(40)
  })

  it('finds the cheapest of a like-priced group as the top bargain', () => {
    const picks = ladder('RB', 12, (i) => (i === 5 ? 2 : 20))
    const { scored } = valueVsRoom(input({ picks }))
    expect(scored[scored.length - 1].name).toBe('RB6')
    expect(scored[scored.length - 1].delta).toBe(-18)
  })

  it('does NOT flag every QB as an overpay in a superflex-shaped draft', () => {
    // The regression this whole function is shaped around. QBs cost far more
    // than their overall rank implies in this league; a cross-position
    // comparison would brand all of them overpays and every WR a bargain.
    const picks = [
      ...ladder('QB', 10, () => 40), // uniformly expensive
      ...ladder('WR', 10, () => 8), // uniformly cheap
    ]
    const { scored } = valueVsRoom(input({ picks }))
    // Every price matches its own position's market exactly, so nothing is
    // over or under. Cross-position comparison would produce huge deltas.
    expect(scored.every((s) => s.delta === 0)).toBe(true)
    const byPos = (p: string) => scored.filter((s) => s.position === p).reduce((a, s) => a + s.delta, 0)
    expect(byPos('QB')).toBe(0)
    expect(byPos('WR')).toBe(0)
  })

  it('compares against neighbours by rank, not a flat positional median', () => {
    // Steep linear decay 50, 46, 42 … A flat positional median would brand
    // every top RB an overpay and every bottom RB a bargain; local neighbours
    // put the interior of the ladder on zero.
    const picks = ladder('RB', 14, (i) => 50 - i * 4)
    const { scored } = valueVsRoom(input({ picks }))
    const interior = scored.filter((s) => s.rank > 3 && s.rank < 12)
    expect(Math.max(...interior.map((s) => Math.abs(s.delta)))).toBeLessThanOrEqual(2)
  })

  it('is biased at the very top and bottom of a position, by construction', () => {
    // Documented, not accidental: the highest-ranked player at a position has
    // nobody above them, so their window is taken entirely from below and a
    // decaying market makes them look like an overpay. Real prices are lumpy
    // enough that this stays small — against the actual 2026 draft the top
    // overpays were not the rank-1 players — but on a perfectly monotone ladder
    // it is unavoidable, and it is the one place this metric flatters nobody.
    const picks = ladder('RB', 14, (i) => 50 - i * 4)
    const { scored } = valueVsRoom(input({ picks }))
    const top = scored.find((s) => s.rank === 1)!
    const bottom = scored.find((s) => s.rank === 14)!
    expect(top.delta).toBeGreaterThan(0)
    expect(bottom.delta).toBeLessThan(0)
  })

  it('never benchmarks a pick against itself', () => {
    const picks = ladder('RB', 8, (i) => (i === 0 ? 100 : 10))
    const { scored } = valueVsRoom(input({ picks }))
    const top = scored.find((s) => s.name === 'RB1')!
    expect(top.benchmark).toBe(10) // not 100
  })

  it('still scores the rank-1 pick, taking its window from below', () => {
    const picks = ladder('RB', 8, () => 10)
    const { scored } = valueVsRoom(input({ picks }))
    expect(scored.some((s) => s.name === 'RB1')).toBe(true)
  })

  it('leaves a pick unscored when it has no rank', () => {
    const picks = [...ladder('RB', 8, () => 10), pick({ position: 'RB', rank: null, price: 99 })]
    const { scored, unscored } = valueVsRoom(input({ picks }))
    expect(unscored).toBe(1)
    expect(scored.some((s) => s.price === 99)).toBe(false)
  })

  it('leaves a position unscored when too few of them were drafted', () => {
    const picks = ladder('TE', 2, () => 5)
    const { scored, unscored } = valueVsRoom(input({ picks }), { minNeighbours: 3 })
    expect(scored).toHaveLength(0)
    expect(unscored).toBe(2)
  })

  it('suppresses the ratio against a sub-$2 benchmark', () => {
    const picks = ladder('RB', 10, (i) => (i === 5 ? 6 : 1))
    const { scored } = valueVsRoom(input({ picks }))
    expect(scored[0].price).toBe(6)
    expect(scored[0].benchmark).toBe(1)
    expect(scored[0].ratio).toBeNull() // 600% would be meaningless
  })

  it('reports a ratio when the benchmark is meaningful', () => {
    const picks = ladder('RB', 10, (i) => (i === 5 ? 40 : 20))
    expect(valueVsRoom(input({ picks })).scored[0].ratio).toBeCloseTo(2)
  })

  it('rolls up per manager by the drafter', () => {
    const picks = [
      ...ladder('RB', 10, (i) => (i === 5 ? 60 : 20), 1),
      ...ladder('WR', 10, () => 15, 2),
    ]
    const { byManager } = valueVsRoom(input({ picks }))
    expect(byManager.find((b) => b.managerId === 1)!.delta).toBe(40)
    expect(byManager.find((b) => b.managerId === 2)!.delta).toBe(0)
  })

  it('excludes K and DEF, whose dollar deltas are noise', () => {
    const picks = [...ladder('K', 8, () => 1), ...ladder('DEF', 8, () => 2)]
    expect(valueVsRoom(input({ picks })).scored).toHaveLength(0)
  })
})
