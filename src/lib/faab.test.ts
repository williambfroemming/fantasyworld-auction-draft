import { describe, expect, it } from 'vitest'
import { faabReport, type FaabTransaction, type FaabWeek } from './faab'

let n = 0
const tx = (o: Partial<FaabTransaction>): FaabTransaction => ({
  season: 2025,
  week: 3,
  transactionId: `T${++n}`,
  type: 'waiver',
  status: 'complete',
  managerId: 1,
  counterpartyManagerId: null,
  playerIdAdded: 'p1',
  playerIdDropped: null,
  addedName: 'Player One',
  addedPosition: 'WR',
  droppedName: null,
  faabBid: 10,
  faabTransferred: null,
  note: null,
  ...o,
})
const wk = (week: number, o: Partial<FaabWeek> = {}): FaabWeek => ({
  season: 2025,
  week,
  managerId: 1,
  playerId: 'p1',
  position: 'WR',
  isStarter: true,
  points: 10,
  ...o,
})
const keys = new Set(Array.from({ length: 14 }, (_, i) => `2025:${i + 1}`))
const opts = { weekKeys: keys, weeklySeasons: new Set([2025]) }
const run = (t: FaabTransaction[], w: FaabWeek[] = [], o = opts) => faabReport(t, w, o)
const mgr = (t: FaabTransaction[], id = 1, w: FaabWeek[] = []) =>
  run(t, w)[0].managers.find((m) => m.managerId === id)!

describe('money', () => {
  it('remaining is budget minus completed bids', () => {
    const m = mgr([tx({ faabBid: 12 }), tx({ playerIdAdded: 'p2', faabBid: 8 })])
    expect(m).toMatchObject({ spent: 20, remaining: 80, won: 2 })
  })

  it('a FAILED claim is never a charge: it is a losing bid', () => {
    const m = mgr([tx({ faabBid: 12 }), tx({ status: 'failed', playerIdAdded: 'p2', faabBid: 50 })])
    expect(m).toMatchObject({ spent: 12, remaining: 88, won: 1, lost: 1 })
  })

  it('FAAB moved in a trade changes remaining, for both sides', () => {
    const trade = tx({
      type: 'trade_faab',
      managerId: 2,
      counterpartyManagerId: 1,
      playerIdAdded: null,
      faabBid: null,
      faabTransferred: 8,
    })
    const t = [tx({ faabBid: 10 }), trade, tx({ managerId: 2, playerIdAdded: 'p9', faabBid: 5 })]
    expect(mgr(t, 1)).toMatchObject({ spent: 10, sent: 8, received: 0, remaining: 82 })
    expect(mgr(t, 2)).toMatchObject({ spent: 5, received: 8, sent: 0, remaining: 103 })
  })

  it('the league total is always budget times managers: trades are zero-sum', () => {
    const trade = tx({
      type: 'trade_faab',
      managerId: 2,
      counterpartyManagerId: 1,
      playerIdAdded: null,
      faabBid: null,
      faabTransferred: 15,
    })
    const t = [tx({ faabBid: 10 }), trade, tx({ managerId: 2, playerIdAdded: 'p9', faabBid: 5 })]
    const s = run(t)[0]
    const left = s.managers.reduce((a, m) => a + m.remaining, 0)
    const spent = s.managers.reduce((a, m) => a + m.spent, 0)
    expect(left + spent).toBe(200)
  })
})

describe('points a claim earned', () => {
  it('counts only weeks after the claim week, for that manager', () => {
    const w = [
      wk(3, { points: 99 }),
      wk(4, { points: 10 }),
      wk(5, { points: 12, isStarter: false }),
      wk(6, { points: 7, managerId: 2 }),
    ]
    const c = run([tx({ week: 3 })], w)[0].claims[0]
    expect(c).toMatchObject({ points: 22, pointsStarted: 10, weeksHeld: 2 })
  })

  it('a player re-acquired later is not credited to the earlier claim', () => {
    const t = [tx({ week: 3, faabBid: 20 }), tx({ type: 'free_agent', week: 8, faabBid: null })]
    const w = [wk(4), wk(5), wk(9), wk(10)]
    const c = run(t, w)[0].claims[0]
    // Weeks 9 and 10 belong to the week 8 pickup, which is not a waiver claim.
    expect(c).toMatchObject({ weeksHeld: 2, points: 20 })
  })

  it('a re-add in the claim week earns the claim nothing for that week', () => {
    const c = run([tx({ week: 5 })], [wk(5, { points: 40 }), wk(6, { points: 5 })])[0].claims[0]
    expect(c.points).toBe(5)
  })

  it('only counts weeks in the key set', () => {
    const c = run([tx({ week: 3 })], [wk(4, { points: 6 }), wk(15, { points: 50 })])[0].claims[0]
    expect(c.points).toBe(6)
  })

  it('a claim that never played a counted week is a real zero, not unknown', () => {
    const c = run([tx({ week: 14 })], [])[0].claims[0]
    expect(c).toMatchObject({ points: 0, pointsStarted: 0, weeksHeld: 0 })
  })

  it('a season with no weekly data reports null points, never 0', () => {
    const s = faabReport([tx({})], [], { ...opts, weeklySeasons: new Set() })[0]
    expect(s.hasWeekly).toBe(false)
    expect(s.claims[0].points).toBeNull()
    expect(s.managers[0].pointsPaid).toBeNull()
    expect(s.managers[0].pointsPerDollar).toBeNull()
  })
})

describe('$0 claims', () => {
  it('have points but no points per dollar and stay out of the worst ranking', () => {
    const t = [tx({ faabBid: 0, playerIdAdded: 'free' })]
    const s = run(t, [wk(4, { playerId: 'free', points: 9 })])[0]
    expect(s.claims[0]).toMatchObject({ bid: 0, points: 9, shortfall: null })
    expect(s.managers[0]).toMatchObject({
      freeWins: 1,
      pointsFree: 9,
      pointsPaid: 0,
      pointsPerDollar: null,
    })
    expect(s.worst).toEqual([])
  })

  it('never dilute a paid rate', () => {
    const t = [tx({ faabBid: 10 }), tx({ playerIdAdded: 'free', faabBid: 0 })]
    const w = [wk(4, { points: 20 }), wk(4, { playerId: 'free', points: 50 })]
    expect(mgr(t, 1, w).pointsPerDollar).toBe(2)
  })
})

describe('worst claims are judged within a position, never across', () => {
  // Two QBs and two TEs, all at $10. QBs score a lot, TEs a little. A cross-position ranking
  // would call both TEs the worst claims; within a position the weaker of each pair is.
  const t = [
    tx({ playerIdAdded: 'qb1', addedPosition: 'QB', faabBid: 10 }),
    tx({ playerIdAdded: 'qb2', addedPosition: 'QB', faabBid: 10 }),
    tx({ playerIdAdded: 'te1', addedPosition: 'TE', faabBid: 10 }),
    tx({ playerIdAdded: 'te2', addedPosition: 'TE', faabBid: 10 }),
  ]
  const w = [
    wk(4, { playerId: 'qb1', points: 40 }),
    wk(4, { playerId: 'qb2', points: 20 }),
    wk(4, { playerId: 'te1', points: 8 }),
    wk(4, { playerId: 'te2', points: 4 }),
  ]
  const s = run(t, w)[0]
  it('ranks the weaker QB and the weaker TE as the worst of their own kind', () => {
    const by = (id: string) => s.claims.find((c) => c.playerId === id)!
    expect(by('qb2').shortfall!).toBeGreaterThan(0)
    expect(by('qb1').shortfall!).toBeLessThan(0)
    expect(by('te2').shortfall!).toBeGreaterThan(0)
    expect(by('te1').shortfall!).toBeLessThan(0)
    // The good TE is not "worse" than the good QB just because tight ends score less.
    expect(by('te1').shortfall!).toBeLessThan(by('qb2').shortfall!)
  })
  it('leaves a claim with no known position out of the ranking', () => {
    const u = run([tx({ addedPosition: null })], [wk(4)])[0]
    expect(u.claims[0].shortfall).toBeNull()
  })
})

describe('lists', () => {
  it('expensive is the highest winning bids, best first', () => {
    const s = run([
      tx({ faabBid: 5 }),
      tx({ playerIdAdded: 'p2', faabBid: 40 }),
      tx({ playerIdAdded: 'p3', faabBid: 12 }),
    ])[0]
    expect(s.expensive.map((c) => c.bid)).toEqual([40, 12, 5])
  })

  it('a lost bid names who beat it and for how much', () => {
    const s = run([
      tx({ managerId: 1, faabBid: 30 }),
      tx({
        managerId: 2,
        status: 'failed',
        faabBid: 25,
        note: 'This player was claimed by another owner.',
      }),
    ])[0]
    expect(s.lostBids).toHaveLength(1)
    expect(s.lostBids[0]).toMatchObject({
      managerId: 2,
      bid: 25,
      winnerManagerId: 1,
      winnerBid: 30,
    })
  })

  it('a lost bid with no winner on record says so', () => {
    const s = run([tx({ status: 'failed', faabBid: 4 })])[0]
    expect(s.lostBids[0]).toMatchObject({ winnerManagerId: null, winnerBid: null })
  })

  it('splits seasons and returns nothing for no transactions', () => {
    expect(run([tx({ season: 2024 }), tx({ season: 2025 })]).map((s) => s.season)).toEqual([
      2024, 2025,
    ])
    expect(run([])).toEqual([])
  })
})
