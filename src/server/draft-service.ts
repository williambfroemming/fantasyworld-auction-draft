/**
 * The auction engine.
 *
 * Every mutation here is expressed as a single SQL statement whose WHERE clause
 * contains the entire rule set. That is the design, not an optimization:
 *
 *  - Neon's HTTP driver has no interactive transactions, so `SELECT … FOR UPDATE`
 *    is unavailable. Read docs/PROJECT_PLAN.md §4 before "fixing" this.
 *  - A conditional UPDATE is atomic on its own. Postgres serializes concurrent
 *    UPDATEs to the same row, so ten simultaneous bids produce exactly one
 *    winner with no lost updates and no lock held across a network round trip.
 *  - "Zero rows affected" is the rejection signal. The reason is worked out
 *    afterwards, for the error message only — never to decide the outcome.
 */
import { getSql } from './sql'
import { fingerprint } from '@/lib/version'
import { nominatorAt } from '@/lib/draft'

export interface StateManager {
  id: number
  name: string
  displayName: string
  color: string
  draftSlot: number
  isCommish: boolean
  hasPin: boolean
  budget: number
  rostered: number
  maxBid: number
}

export interface StateLot {
  id: number
  playerId: string
  playerName: string
  playerTeam: string | null
  playerPosition: string
  playerByeWeek: number | null
  nominatorId: number
  highBid: number
  highBidderId: number
  endsAt: string
  pausedRemainingMs: number | null
  version: number
}

export interface DraftState {
  version: string
  serverNow: number
  draft: {
    status: 'setup' | 'live' | 'paused' | 'done'
    nominationIndex: number
    timerSeconds: number
    softCloseSeconds: number
    rosterSize: number
    startingBudget: number
  }
  lot: StateLot | null
  onTheClock: { managerId: number; index: number } | null
  managers: StateManager[]
  recentPicks: Array<{
    pickNo: number
    playerName: string
    playerPosition: string
    managerId: number
    price: number
  }>
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/**
 * Award any lot whose clock has run out.
 *
 * One statement, so it is safe to call from every polling client at once: the
 * UPDATE inside the CTE is the gate, and only the caller whose UPDATE actually
 * matched a row gets to insert the pick. Everyone else sees zero rows.
 *
 * Doing this on read is what removes the need for a cron with sub-second
 * resolution. It also means a lot settles the instant *anyone* looks, even if
 * the room walked away mid-auction.
 */
export async function settleExpiredLots(): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    WITH won AS (
      UPDATE lots SET status = 'sold'
      WHERE status = 'open'
        AND paused_remaining_ms IS NULL
        AND now() >= ends_at
      RETURNING *
    ), numbered AS (
      SELECT
        (SELECT COALESCE(MAX(pick_no), 0) FROM picks) + 1 AS pick_no,
        won.player_id, won.high_bidder_id, won.nominator_id, won.high_bid
      FROM won
    )
    INSERT INTO picks (pick_no, player_id, manager_id, nominator_id, price)
    SELECT pick_no, player_id, high_bidder_id, nominator_id, high_bid FROM numbered
    ON CONFLICT (player_id) DO NOTHING
    RETURNING id`
  return rows.length > 0
}

/**
 * Self-heal a lot marked sold that somehow has no pick — possible only if the
 * process died between statements in an older code path. Cheap, idempotent, and
 * far preferable to a manager silently losing a player they paid for.
 */
export async function repairOrphanedLots(): Promise<number> {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO picks (pick_no, player_id, manager_id, nominator_id, price)
    SELECT
      (SELECT COALESCE(MAX(pick_no), 0) FROM picks) + 1,
      l.player_id, l.high_bidder_id, l.nominator_id, l.high_bid
    FROM lots l
    WHERE l.status = 'sold'
      AND NOT EXISTS (SELECT 1 FROM picks p WHERE p.player_id = l.player_id)
    LIMIT 1
    ON CONFLICT (player_id) DO NOTHING
    RETURNING id`
  return rows.length
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export async function getState(): Promise<DraftState> {
  const sql = getSql()

  const [settings] = await sql`SELECT * FROM draft WHERE id = 1`
  if (!settings) throw new Error('Draft is not initialized — run `npm run db:seed`.')

  const [mgrRows, lotRows, pickRows, pickCount] = await Promise.all([
    sql`SELECT m.id, m.name, m.display_name, m.color, m.draft_slot, m.is_commish,
               (m.pin_hash IS NOT NULL) AS has_pin,
               t.budget, t.rostered, t.max_bid
        FROM managers m JOIN manager_totals t ON t.id = m.id
        ORDER BY m.draft_slot`,
    sql`SELECT l.*, p.name AS player_name, p.team AS player_team,
               p.position AS player_position, p.bye_week AS player_bye_week
        FROM lots l JOIN players p ON p.id = l.player_id
        WHERE l.status = 'open' LIMIT 1`,
    sql`SELECT pk.pick_no, pk.manager_id, pk.price, p.name AS player_name, p.position
        FROM picks pk JOIN players p ON p.id = pk.player_id
        ORDER BY pk.pick_no DESC LIMIT 12`,
    sql`SELECT count(*)::int AS n FROM picks`,
  ])

  const managers: StateManager[] = mgrRows.map((m) => ({
    id: m.id,
    name: m.name,
    displayName: m.display_name,
    color: m.color,
    draftSlot: m.draft_slot,
    isCommish: m.is_commish,
    hasPin: m.has_pin,
    budget: Number(m.budget),
    rostered: Number(m.rostered),
    maxBid: Number(m.max_bid),
  }))

  const l = lotRows[0]
  const lot: StateLot | null = l
    ? {
        id: l.id,
        playerId: l.player_id,
        playerName: l.player_name,
        playerTeam: l.player_team,
        playerPosition: l.player_position,
        playerByeWeek: l.player_bye_week,
        nominatorId: l.nominator_id,
        highBid: l.high_bid,
        highBidderId: l.high_bidder_id,
        endsAt: new Date(l.ends_at).toISOString(),
        pausedRemainingMs: l.paused_remaining_ms,
        version: l.version,
      }
    : null

  // Whose turn it is — recomputed each read so a manager who just filled their
  // roster is skipped immediately rather than at the next write.
  const turn = nominatorAt(
    managers.map((m) => ({ id: m.id, draftSlot: m.draftSlot, rosterCount: m.rostered })),
    settings.nomination_index,
    settings.roster_size,
  )

  return {
    version: fingerprint({
      rev: settings.rev,
      lotId: lot?.id ?? null,
      lotVersion: lot?.version ?? null,
      pickCount: pickCount[0].n,
      draftStatus: settings.status,
    }),
    serverNow: Date.now(),
    draft: {
      status: settings.status,
      nominationIndex: settings.nomination_index,
      timerSeconds: settings.timer_seconds,
      softCloseSeconds: settings.soft_close_seconds,
      rosterSize: settings.roster_size,
      startingBudget: settings.starting_budget,
    },
    lot,
    onTheClock: turn ? { managerId: turn.manager.id, index: turn.index } : null,
    managers,
    recentPicks: pickRows.map((p) => ({
      pickNo: p.pick_no,
      playerName: p.player_name,
      playerPosition: p.position,
      managerId: p.manager_id,
      price: Number(p.price),
    })),
  }
}

// ---------------------------------------------------------------------------
// Nominate
// ---------------------------------------------------------------------------

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; reason: string }

export async function nominate(
  managerId: number,
  playerId: string,
  openingBid: number,
): Promise<ActionResult<{ lotId: number }>> {
  const sql = getSql()

  if (!Number.isInteger(openingBid) || openingBid < 1) {
    return { ok: false, reason: 'Opening bid must be a whole dollar of at least $1' }
  }

  const state = await getState()
  if (state.draft.status !== 'live') {
    return { ok: false, reason: state.draft.status === 'paused' ? 'Draft is paused' : 'Draft is not live' }
  }
  if (state.lot) return { ok: false, reason: 'Bidding is still open on another player' }
  if (state.onTheClock?.managerId !== managerId) {
    const who = state.managers.find((m) => m.id === state.onTheClock?.managerId)
    return { ok: false, reason: `It's ${who?.displayName ?? 'someone else'}'s turn to nominate` }
  }

  // Single guarded insert: no other open lot, player not already drafted, and
  // the opening bid within this manager's live max. Racing nominations lose.
  const rows = await sql`
    INSERT INTO lots (player_id, nominator_id, high_bid, high_bidder_id, ends_at)
    SELECT ${playerId}, ${managerId}, ${openingBid}, ${managerId},
           now() + make_interval(secs => ${state.draft.timerSeconds})
    WHERE NOT EXISTS (SELECT 1 FROM lots WHERE status = 'open')
      AND NOT EXISTS (SELECT 1 FROM picks WHERE player_id = ${playerId})
      AND EXISTS (SELECT 1 FROM players WHERE id = ${playerId})
      AND ${openingBid} <= (SELECT max_bid FROM manager_totals WHERE id = ${managerId})
    RETURNING id`

  if (rows.length === 0) {
    const mgr = state.managers.find((m) => m.id === managerId)
    if (mgr && openingBid > mgr.maxBid) {
      return { ok: false, reason: `Over your max bid of $${mgr.maxBid}` }
    }
    return { ok: false, reason: 'That player is already drafted or bidding just opened elsewhere' }
  }

  const lotId = rows[0].id as number
  await sql`INSERT INTO bids (lot_id, manager_id, amount) VALUES (${lotId}, ${managerId}, ${openingBid})`
  await sql`UPDATE draft SET nomination_index = ${state.onTheClock.index + 1} WHERE id = 1`

  return { ok: true, data: { lotId } }
}

// ---------------------------------------------------------------------------
// Bid — the one that has to be right
// ---------------------------------------------------------------------------

export async function placeBid(
  managerId: number,
  lotId: number,
  amount: number,
): Promise<ActionResult<{ highBid: number; endsAt: string }>> {
  const sql = getSql()

  if (!Number.isInteger(amount)) return { ok: false, reason: 'Bid must be a whole dollar' }

  const [settings] = await sql`SELECT status, soft_close_seconds FROM draft WHERE id = 1`
  if (settings?.status !== 'live') {
    return { ok: false, reason: settings?.status === 'paused' ? 'Draft is paused' : 'Draft is not live' }
  }

  // Everything that makes a bid legal is in this WHERE clause, including the
  // max-bid rule via manager_totals — so it is enforced inside the database and
  // a stale or hostile client cannot get around it.
  //
  // Soft close: GREATEST() means a bid outside the final N seconds leaves the
  // clock alone, while a bid inside it pushes the end back out to exactly N.
  const rows = await sql`
    UPDATE lots SET
      high_bid = ${amount},
      high_bidder_id = ${managerId},
      version = version + 1,
      ends_at = GREATEST(ends_at, now() + make_interval(secs => ${settings.soft_close_seconds}))
    WHERE id = ${lotId}
      AND status = 'open'
      AND paused_remaining_ms IS NULL
      AND now() < ends_at
      AND ${amount} > high_bid
      AND ${amount} <= (SELECT max_bid FROM manager_totals WHERE id = ${managerId})
    RETURNING high_bid, ends_at`

  if (rows.length === 0) return { ok: false, reason: await explainRejectedBid(managerId, lotId, amount) }

  await sql`INSERT INTO bids (lot_id, manager_id, amount) VALUES (${lotId}, ${managerId}, ${amount})`
  return {
    ok: true,
    data: { highBid: rows[0].high_bid, endsAt: new Date(rows[0].ends_at).toISOString() },
  }
}

/**
 * Work out why a bid failed, for the message only.
 *
 * Deliberately runs *after* the fact. Checking first and then updating would be
 * a race; this way the database decides the outcome and we only narrate it.
 */
async function explainRejectedBid(managerId: number, lotId: number, amount: number): Promise<string> {
  const sql = getSql()
  const [lot] = await sql`SELECT status, high_bid, ends_at, paused_remaining_ms FROM lots WHERE id = ${lotId}`
  if (!lot) return 'That auction no longer exists'
  if (lot.paused_remaining_ms !== null) return 'Draft is paused'
  // Expiry is checked BEFORE status. A lot that ran out of time may already have
  // been settled by another client's poll between the failed UPDATE and this
  // read, and "Time expired" is the truthful, useful message either way —
  // "Bidding closed" would make a normal timeout look like something odd.
  if (new Date(lot.ends_at).getTime() <= Date.now()) return 'Time expired'
  if (lot.status !== 'open') return 'Bidding closed on this player'
  if (amount <= lot.high_bid) return `Must beat the current bid of $${lot.high_bid}`

  const [totals] = await sql`SELECT budget, rostered, max_bid FROM manager_totals WHERE id = ${managerId}`
  if (!totals) return 'Unknown manager'
  if (Number(totals.max_bid) <= 0) return 'Your roster is full'
  if (amount > Number(totals.max_bid)) {
    return `Over your max bid of $${totals.max_bid} — you must keep $1 for each empty roster spot`
  }
  return 'Someone outbid you'
}
