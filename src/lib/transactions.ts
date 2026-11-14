/**
 * Sleeper transactions, flattened to one row per player movement
 * (docs/archive/ANALYTICS_ROADMAP.md step 59). Pure: the importer feeds it the committed
 * `transactions-NN.json` files and writes whatever comes back.
 *
 * ## Shape of the source
 *
 * A Sleeper transaction carries `adds` and `drops`, each a map of **player id to roster id**
 * (a team defence is keyed by its team code, "MIN"), plus `roster_ids`, `settings.waiver_bid`
 * for a claim, and on a trade `waiver_budget: [{ amount, sender, receiver }]`, FAAB dollars
 * that changed hands with the players.
 *
 * ## Rules this file keeps
 *
 * - **FAILED claims are kept**, with their bid and Sleeper's own note ("This player was
 *   claimed by another owner."). Who lost the bidding is half the story, and `faabBid` on a
 *   failed claim was never spent. Anything that adds up money must filter on `status`.
 * - **FAAB moved in a trade is its own row** (`type: 'trade_faab'`), because a manager's
 *   remaining budget is bids won plus dollars sent or received in trades. Leaving it out
 *   would put 17 managers' "FAAB left" wrong. `faabTransferred` is dollars RECEIVED by
 *   `managerId` from `counterpartyManagerId`.
 * - **A trade row is one player received.** `managerId` is the receiver, `counterpartyManagerId`
 *   the sender; nothing is "dropped" by the receiver.
 * - **Rosters resolve to managers through that season's `rosters.json`**, which the caller
 *   passes as `owner`. An unknown roster throws: a guessed manager would put a bid on the
 *   wrong person's budget and look entirely plausible.
 * - **Null is unknown.** A name or position missing from the player map is null, never a
 *   placeholder; `note` is null when Sleeper gave none; a bid is null off a waiver.
 */

export type TransactionType = 'waiver' | 'free_agent' | 'trade' | 'commissioner' | 'trade_faab'

export interface RawTransaction {
  transaction_id: string
  type: string
  status: string
  leg: number
  created: number
  adds: Record<string, number> | null
  drops: Record<string, number> | null
  roster_ids: number[]
  settings: { waiver_bid?: number } | null
  metadata: { notes?: string } | null
  waiver_budget?: Array<{ amount: number; sender: number; receiver: number }> | null
}

/** `[name, position, team]`, as in `data/sleeper/players-min.json`. */
export type PlayerNames = Record<string, [string, string, string | null] | undefined>

export interface TransactionRow {
  season: number
  week: number
  transactionId: string
  /** Position of this row inside its transaction, so a trade's rows share an id. */
  line: number
  type: TransactionType
  /** Sleeper's word: `complete` or `failed`. */
  status: string
  managerId: number
  counterpartyManagerId: number | null
  playerIdAdded: string | null
  playerIdDropped: string | null
  addedName: string | null
  addedPosition: string | null
  droppedName: string | null
  droppedPosition: string | null
  /** The bid on a waiver claim, won or not. Null for everything else. */
  faabBid: number | null
  /** Dollars received in a trade (`trade_faab` rows only). */
  faabTransferred: number | null
  note: string | null
  /** ISO timestamp, from Sleeper's epoch milliseconds. */
  createdAt: string
}

const KNOWN: ReadonlySet<string> = new Set(['waiver', 'free_agent', 'trade', 'commissioner'])

export function flattenTransactions(
  season: number,
  raw: RawTransaction[],
  owner: Map<number, number>,
  names: PlayerNames = {},
): TransactionRow[] {
  const manager = (rosterId: number, id: string): number => {
    const m = owner.get(rosterId)
    if (m === undefined)
      throw new Error(`${season}: transaction ${id} names unknown roster ${rosterId}`)
    return m
  }
  const nameOf = (id: string | null) => (id ? (names[id]?.[0] ?? null) : null)
  const posOf = (id: string | null) => (id ? (names[id]?.[1] ?? null) : null)

  const rows: TransactionRow[] = []
  for (const t of raw) {
    if (!KNOWN.has(t.type))
      throw new Error(`${season}: transaction ${t.transaction_id} has unknown type "${t.type}"`)
    const base = {
      season,
      week: t.leg,
      transactionId: String(t.transaction_id),
      status: t.status,
      createdAt: new Date(t.created).toISOString(),
      note: t.metadata?.notes ?? null,
    }
    let line = 0
    const push = (
      r: Omit<
        TransactionRow,
        | keyof typeof base
        | 'line'
        | 'addedName'
        | 'addedPosition'
        | 'droppedName'
        | 'droppedPosition'
      >,
    ) =>
      rows.push({
        ...base,
        line: line++,
        ...r,
        addedName: nameOf(r.playerIdAdded),
        addedPosition: posOf(r.playerIdAdded),
        droppedName: nameOf(r.playerIdDropped),
        droppedPosition: posOf(r.playerIdDropped),
      })

    const adds = Object.entries(t.adds ?? {})
    const drops = Object.entries(t.drops ?? {})

    if (t.type === 'trade') {
      for (const [playerId, rosterId] of adds) {
        const sender = drops.find(([p]) => p === playerId)?.[1]
        push({
          type: 'trade',
          managerId: manager(rosterId, base.transactionId),
          counterpartyManagerId: sender === undefined ? null : manager(sender, base.transactionId),
          playerIdAdded: playerId,
          playerIdDropped: null,
          faabBid: null,
          faabTransferred: null,
        })
      }
      for (const w of t.waiver_budget ?? []) {
        push({
          type: 'trade_faab',
          managerId: manager(w.receiver, base.transactionId),
          counterpartyManagerId: manager(w.sender, base.transactionId),
          playerIdAdded: null,
          playerIdDropped: null,
          faabBid: null,
          faabTransferred: w.amount,
        })
      }
      continue
    }

    // Waiver, free agent, commissioner: each roster's adds are paired with its drops, in order.
    const rosters = [...new Set([...adds, ...drops].map(([, r]) => r))].sort((a, b) => a - b)
    for (const rosterId of rosters) {
      const mine = adds.filter(([, r]) => r === rosterId).map(([p]) => p)
      const gone = drops.filter(([, r]) => r === rosterId).map(([p]) => p)
      const m = manager(rosterId, base.transactionId)
      for (let i = 0; i < Math.max(mine.length, gone.length); i++) {
        push({
          type: t.type as TransactionType,
          managerId: m,
          counterpartyManagerId: null,
          playerIdAdded: mine[i] ?? null,
          playerIdDropped: gone[i] ?? null,
          faabBid: t.type === 'waiver' ? (t.settings?.waiver_bid ?? null) : null,
          faabTransferred: null,
        })
      }
    }
  }
  return rows
}
