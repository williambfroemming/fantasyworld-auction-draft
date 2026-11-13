import { describe, expect, it } from 'vitest'
import { flattenTransactions, type RawTransaction } from './transactions'

const owner = new Map([
  [1, 11],
  [2, 22],
  [3, 33],
])
const names = {
  '100': ['Alpha Back', 'RB', 'KC'],
  '200': ['Beta Wideout', 'WR', null],
  MIN: ['MIN', 'DEF', 'MIN'],
} as never
const tx = (o: Partial<RawTransaction>): RawTransaction => ({
  transaction_id: 'T1',
  type: 'waiver',
  status: 'complete',
  leg: 3,
  created: 1757459166771,
  adds: null,
  drops: null,
  roster_ids: [],
  settings: null,
  metadata: null,
  waiver_budget: [],
  ...o,
})

describe('flattenTransactions', () => {
  it('turns a waiver claim into one row with the add, the drop and the bid', () => {
    const [r] = flattenTransactions(
      2025,
      [tx({ adds: { '100': 1 }, drops: { '200': 1 }, settings: { waiver_bid: 9 } })],
      owner,
      names,
    )
    expect(r).toMatchObject({
      season: 2025,
      week: 3,
      type: 'waiver',
      status: 'complete',
      managerId: 11,
      playerIdAdded: '100',
      playerIdDropped: '200',
      addedName: 'Alpha Back',
      droppedPosition: 'WR',
      faabBid: 9,
    })
  })

  it("keeps a FAILED claim, with its bid and Sleeper's note", () => {
    const [r] = flattenTransactions(
      2025,
      [
        tx({
          status: 'failed',
          adds: { '100': 2 },
          settings: { waiver_bid: 0 },
          metadata: { notes: 'This player was claimed by another owner.' },
        }),
      ],
      owner,
      names,
    )
    expect(r).toMatchObject({
      status: 'failed',
      faabBid: 0,
      note: 'This player was claimed by another owner.',
      playerIdDropped: null,
    })
  })

  it('a $0 claim keeps a bid of 0, not null', () => {
    const [r] = flattenTransactions(
      2025,
      [tx({ adds: { '100': 1 }, settings: { waiver_bid: 0 } })],
      owner,
      names,
    )
    expect(r.faabBid).toBe(0)
  })

  it('a free-agent add carries no bid', () => {
    const [r] = flattenTransactions(
      2025,
      [tx({ type: 'free_agent', adds: { '100': 1 }, settings: null })],
      owner,
      names,
    )
    expect(r).toMatchObject({ type: 'free_agent', faabBid: null })
  })

  it('a drop-only move has no added player', () => {
    const [r] = flattenTransactions(
      2025,
      [tx({ type: 'free_agent', drops: { '200': 3 } })],
      owner,
      names,
    )
    expect(r).toMatchObject({ playerIdAdded: null, playerIdDropped: '200', managerId: 33 })
  })

  it('a two-for-one trade is several rows sharing one transaction id, receiver and sender named', () => {
    const rows = flattenTransactions(
      2025,
      [
        tx({
          type: 'trade',
          adds: { '100': 2, '200': 2, MIN: 1 },
          drops: { '100': 1, '200': 1, MIN: 2 },
          roster_ids: [1, 2],
        }),
      ],
      owner,
      names,
    )
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.transactionId))).toEqual(new Set(['T1']))
    expect(rows.map((r) => r.line)).toEqual([0, 1, 2])
    expect(rows[0]).toMatchObject({
      type: 'trade',
      managerId: 22,
      counterpartyManagerId: 11,
      playerIdAdded: '100',
      playerIdDropped: null,
    })
    expect(rows[2]).toMatchObject({
      managerId: 11,
      counterpartyManagerId: 22,
      addedPosition: 'DEF',
    })
  })

  it('FAAB moved in a trade is its own row: dollars received, from whom', () => {
    const rows = flattenTransactions(
      2025,
      [
        tx({
          type: 'trade',
          adds: { '100': 2 },
          drops: { '100': 1 },
          waiver_budget: [{ amount: 8, sender: 1, receiver: 2 }],
        }),
      ],
      owner,
      names,
    )
    expect(rows[1]).toMatchObject({
      type: 'trade_faab',
      managerId: 22,
      counterpartyManagerId: 11,
      faabTransferred: 8,
      playerIdAdded: null,
    })
  })

  it('a FAAB-only trade still yields a row', () => {
    const rows = flattenTransactions(
      2025,
      [tx({ type: 'trade', waiver_budget: [{ amount: 3, sender: 3, receiver: 1 }] })],
      owner,
      names,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'trade_faab', managerId: 11, counterpartyManagerId: 33 })
  })

  it('a commissioner move is kept as its own type', () => {
    const [r] = flattenTransactions(
      2025,
      [tx({ type: 'commissioner', adds: { '100': 2 } })],
      owner,
      names,
    )
    expect(r.type).toBe('commissioner')
  })

  it('leaves a name null rather than inventing one', () => {
    const [r] = flattenTransactions(2025, [tx({ adds: { '999': 1 } })], owner, names)
    expect(r).toMatchObject({ playerIdAdded: '999', addedName: null, addedPosition: null })
  })

  it('converts the timestamp', () => {
    const [r] = flattenTransactions(2025, [tx({ adds: { '100': 1 } })], owner, names)
    expect(r.createdAt).toBe('2025-09-09T23:06:06.771Z')
  })

  it('throws on a roster it cannot resolve, and on a type it does not know', () => {
    expect(() => flattenTransactions(2025, [tx({ adds: { '100': 9 } })], owner, names)).toThrow(
      /unknown roster 9/,
    )
    expect(() =>
      flattenTransactions(2025, [tx({ type: 'mystery', adds: { '100': 1 } })], owner, names),
    ).toThrow(/unknown type/)
  })
})

describe('flattenTransactions on the committed data', () => {
  it('rows add up to the source: every add and drop appears exactly once', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'data', 'sleeper', '2025')
    if (!existsSync(join(dir, 'transactions-01.json'))) return
    const rosters = JSON.parse(readFileSync(join(dir, 'rosters.json'), 'utf8')) as Array<{
      roster_id: number
    }>
    const own = new Map(rosters.map((r) => [r.roster_id, r.roster_id * 10]))
    let raw: RawTransaction[] = []
    for (let w = 1; w <= 17; w++) {
      raw = raw.concat(
        JSON.parse(
          readFileSync(join(dir, `transactions-${String(w).padStart(2, '0')}.json`), 'utf8'),
        ),
      )
    }
    const rows = flattenTransactions(2025, raw, own)
    const nonTrade = raw.filter((t) => t.type !== 'trade')
    const sourceMoves = nonTrade.reduce(
      (n, t) => n + Object.keys(t.adds ?? {}).length + Object.keys(t.drops ?? {}).length,
      0,
    )
    const rowMoves = rows
      .filter((r) => r.type !== 'trade' && r.type !== 'trade_faab')
      .reduce((n, r) => n + (r.playerIdAdded ? 1 : 0) + (r.playerIdDropped ? 1 : 0), 0)
    expect(rowMoves).toBe(sourceMoves)
    expect(rows.filter((r) => r.type === 'waiver' && r.status === 'failed').length).toBeGreaterThan(
      0,
    )
    // Unique key the table will use.
    const keys = rows.map((r) => `${r.transactionId}:${r.line}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
