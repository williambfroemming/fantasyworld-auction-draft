/**
 * The auction engine.
 *
 * The bidding itself happens out loud, in the room. The app's job is narrower
 * than it looks: put a player on the block, then record who won them and for how
 * much — and refuse to record a result that would break a budget.
 *
 * Every mutation here is expressed as a single SQL statement whose WHERE clause
 * contains the entire rule set. That is the design, not an optimization:
 *
 *  - Neon's HTTP driver has no interactive transactions, so `SELECT … FOR UPDATE`
 *    is unavailable. Read docs/PROJECT_PLAN.md §4 before "fixing" this.
 *  - A conditional UPDATE is atomic on its own, and a statement whose CTEs both
 *    update the lot and insert the pick cannot half-apply.
 *  - "Zero rows affected" is the rejection signal. The reason is worked out
 *    afterwards, for the error message only — never to decide the outcome.
 *
 * ## Seasons
 *
 * `picks` and `lots` accumulate across years — 160 rows per season, kept
 * forever, so the league can browse past drafts. EVERY query in here therefore
 * filters on `draft.season`. An unscoped read of `picks` is a bug even when it
 * looks harmless: it makes last year's players undraftable, last year's spend
 * count against this year's budget, or last year's pick count leak into the
 * polling fingerprint. See docs/BACKLOG.md §2.
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

/**
 * The player currently on the block. There is no deadline and no standing bid —
 * an open lot is just "the room is bidding on this right now".
 */
export interface StateLot {
  id: number
  playerId: string
  playerName: string
  playerTeam: string | null
  playerPosition: string
  playerByeWeek: number | null
  nominatorId: number
}

export interface DraftState {
  version: string
  draft: {
    /** The year being drafted. Past years are read-only, at /board?season=. */
    season: number
    status: 'setup' | 'live' | 'paused' | 'done'
    nominationIndex: number
    rosterSize: number
    startingBudget: number
  }
  lot: StateLot | null
  onTheClock: { managerId: number; index: number } | null
  /**
   * Who nominates after the current nominator — one seat ahead, no further.
   *
   * The snake turn is the confusing part: at the end of a round the same manager
   * nominates twice in a row, which reliably produces "wait, isn't it my turn?"
   * in the room. One name settles that. Looking several seats ahead would be
   * guesswork, because who nominates later depends on who fills their roster
   * before then.
   *
   * Null when the draft is over, or when the current nominator is the only
   * manager still unfilled and therefore also next.
   */
  onDeck: { managerId: number; index: number } | null
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
// State
// ---------------------------------------------------------------------------

export async function getState(): Promise<DraftState> {
  const sql = getSql()

  const [settings] = await sql`SELECT * FROM draft WHERE id = 1`
  if (!settings) throw new Error('Draft is not initialized — run `npm run db:seed`.')

  const season = settings.season as number

  const [mgrRows, lotRows, pickRows, pickCount] = await Promise.all([
    sql`SELECT m.id, m.name, m.display_name, m.color, m.draft_slot, m.is_commish,
               (m.pin_hash IS NOT NULL) AS has_pin,
               t.budget, t.rostered, t.max_bid
        FROM managers m JOIN manager_totals t ON t.id = m.id
        ORDER BY m.draft_slot`,
    // The open lot is joined to `players` rather than read from a snapshot:
    // this is the live pool by definition, and the lot panel wants today's
    // team and bye week.
    sql`SELECT l.id, l.player_id, l.nominator_id,
               p.name AS player_name, p.team AS player_team,
               p.position AS player_position, p.bye_week AS player_bye_week
        FROM lots l JOIN players p ON p.id = l.player_id
        WHERE l.status = 'open' AND l.season = ${season} LIMIT 1`,
    // Read from the pick's own snapshot, not a join — same rows the archive
    // shows, so the ticker and the history can never disagree.
    sql`SELECT pk.pick_no, pk.manager_id, pk.price,
               pk.player_name, pk.player_position AS position
        FROM picks pk
        WHERE pk.season = ${season}
        ORDER BY pk.pick_no DESC LIMIT 12`,
    sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`,
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
      }
    : null

  // Whose turn it is — recomputed each read so a manager who just filled their
  // roster is skipped immediately rather than at the next write.
  const seats = managers.map((m) => ({
    id: m.id,
    draftSlot: m.draftSlot,
    rosterCount: m.rostered,
  }))
  const turn = nominatorAt(seats, settings.nomination_index, settings.roster_size)

  // On deck is the same function called one index later — never a second copy of
  // the snake maths, which is how a displayed order and an enforced order drift
  // apart. Note this can change without a nomination happening: if whoever wins
  // the current lot thereby fills their 16th slot they get skipped, and on-deck
  // moves on. The turn is recomputed on every read, so that corrects itself on
  // the next poll rather than needing to be handled.
  const next = turn ? nominatorAt(seats, turn.index + 1, settings.roster_size) : null

  return {
    version: fingerprint({
      season,
      rev: settings.rev,
      lotId: lot?.id ?? null,
      pickCount: pickCount[0].n,
      draftStatus: settings.status,
    }),
    draft: {
      season,
      status: settings.status,
      nominationIndex: settings.nomination_index,
      rosterSize: settings.roster_size,
      startingBudget: settings.starting_budget,
    },
    lot,
    onTheClock: turn ? { managerId: turn.manager.id, index: turn.index } : null,
    onDeck: next ? { managerId: next.manager.id, index: next.index } : null,
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

/**
 * Put a player on the block.
 *
 * No opening bid: the price is whatever the room lands on, and it is recorded
 * once, at the end, by `awardLot`. Nomination is purely "everyone look at this
 * player now" plus advancing the snake.
 */
export async function nominate(
  managerId: number,
  playerId: string,
): Promise<ActionResult<{ lotId: number }>> {
  const sql = getSql()

  const state = await getState()
  if (state.draft.status !== 'live') {
    return {
      ok: false,
      reason: state.draft.status === 'paused' ? 'Draft is paused' : 'Draft is not live',
    }
  }
  if (state.lot) return { ok: false, reason: `${state.lot.playerName} is still on the block` }
  if (state.onTheClock?.managerId !== managerId) {
    const who = state.managers.find((m) => m.id === state.onTheClock?.managerId)
    return { ok: false, reason: `It's ${who?.displayName ?? 'someone else'}'s turn to nominate` }
  }

  // Single guarded insert: no other open lot and the player is not already
  // drafted. Two people hitting Nominate in the same instant — which happens
  // when the order is disputed — produces one lot, not two.
  //
  // "Already drafted" means drafted THIS season. Without that filter every
  // player taken in a previous year would be permanently unavailable, which
  // would turn a 10-person redraft league into an accidental keeper league.
  const season = state.draft.season
  const rows = await sql`
    INSERT INTO lots (season, player_id, nominator_id)
    SELECT ${season}, ${playerId}, ${managerId}
    WHERE NOT EXISTS (SELECT 1 FROM lots WHERE status = 'open' AND season = ${season})
      AND NOT EXISTS (SELECT 1 FROM picks WHERE player_id = ${playerId} AND season = ${season})
      AND EXISTS (SELECT 1 FROM players WHERE id = ${playerId})
    RETURNING id`

  if (rows.length === 0) {
    return { ok: false, reason: 'That player is already drafted, or another lot just opened' }
  }

  await sql`UPDATE draft SET nomination_index = ${state.onTheClock.index + 1} WHERE id = 1`
  return { ok: true, data: { lotId: rows[0].id as number } }
}

// ---------------------------------------------------------------------------
// Award — the one that has to be right
// ---------------------------------------------------------------------------

/**
 * Record the result of the verbal auction: this manager won this player at this
 * price.
 *
 * This is the only moment the app can enforce anything, so the whole rule set
 * lives in the WHERE clause — including the max-bid check against
 * `manager_totals`, which means it is enforced *inside the database* and a stale
 * or hostile client cannot get around it.
 *
 * The lot update and the pick insert are one statement. Two statements would
 * leave a window where a lot reads 'sold' with no pick behind it, i.e. a manager
 * who won a player and does not have them.
 *
 * `callerId` must be the nominator or the commissioner. Anyone else typing the
 * price is how a lot gets awarded to the wrong person while ten people talk over
 * each other.
 */
export async function awardLot(
  callerId: number,
  lotId: number,
  winnerId: number,
  price: number,
): Promise<ActionResult<{ pickNo: number }>> {
  const sql = getSql()

  if (!Number.isInteger(price)) return { ok: false, reason: 'Price must be a whole dollar' }
  if (price < 1) return { ok: false, reason: 'Every player costs at least $1' }

  const [settings] = await sql`SELECT season, status FROM draft WHERE id = 1`
  if (settings?.status !== 'live') {
    return {
      ok: false,
      reason: settings?.status === 'paused' ? 'Draft is paused' : 'Draft is not live',
    }
  }
  const season = settings.season as number

  const [lot] = await sql`SELECT nominator_id, status, season FROM lots WHERE id = ${lotId}`
  if (!lot) return { ok: false, reason: 'That lot no longer exists' }
  if (lot.status !== 'open') return { ok: false, reason: 'This player has already been awarded' }
  if (Number(lot.season) !== season) {
    return { ok: false, reason: `That lot belongs to the ${lot.season} draft` }
  }

  const [caller] = await sql`SELECT is_commish FROM managers WHERE id = ${callerId}`
  if (lot.nominator_id !== callerId && !caller?.is_commish) {
    return { ok: false, reason: 'Only the nominator or the commissioner can record the sale' }
  }

  // The player's name/team/position are copied onto the pick here, at award
  // time. That snapshot is what the archive renders from years later, when the
  // pool has been re-imported and this player may have changed team, changed
  // position, or left `players` entirely. See docs/BACKLOG.md §2.
  const rows = await sql`
    WITH sold AS (
      UPDATE lots
      SET status = 'sold', sold_price = ${price}, winner_id = ${winnerId}
      WHERE id = ${lotId}
        AND status = 'open'
        AND ${price} <= (SELECT max_bid FROM manager_totals WHERE id = ${winnerId})
        AND NOT EXISTS (
          SELECT 1 FROM picks pk
          WHERE pk.player_id = lots.player_id AND pk.season = ${season})
      RETURNING player_id, nominator_id
    )
    INSERT INTO picks (season, pick_no, player_id, player_name, player_team,
                       player_position, manager_id, nominator_id, price)
    SELECT ${season},
           (SELECT COALESCE(MAX(pick_no), 0) FROM picks WHERE season = ${season}) + 1,
           sold.player_id, p.name, p.team, p.position,
           ${winnerId}, sold.nominator_id, ${price}
    FROM sold JOIN players p ON p.id = sold.player_id
    ON CONFLICT (season, player_id) DO NOTHING
    RETURNING pick_no`

  if (rows.length === 0) return { ok: false, reason: await explainRejectedAward(winnerId, price) }
  return { ok: true, data: { pickNo: Number(rows[0].pick_no) } }
}

/**
 * Work out why an award failed, for the message only.
 *
 * Deliberately runs *after* the fact. Checking first and then writing would be a
 * race; this way the database decides the outcome and we only narrate it.
 */
async function explainRejectedAward(winnerId: number, price: number): Promise<string> {
  const sql = getSql()
  const [totals] = await sql`
    SELECT t.budget, t.rostered, t.max_bid, m.display_name
    FROM manager_totals t JOIN managers m ON m.id = t.id WHERE t.id = ${winnerId}`
  if (!totals) return 'Unknown manager'

  const [{ roster_size }] = await sql`SELECT roster_size FROM draft WHERE id = 1`
  if (Number(totals.rostered) >= Number(roster_size)) {
    return `${totals.display_name}'s roster is already full`
  }
  if (price > Number(totals.max_bid)) {
    return (
      `$${price} is over ${totals.display_name}'s max bid of $${totals.max_bid} — ` +
      `they have $${totals.budget} and must keep $1 for each empty roster spot`
    )
  }
  return 'That player has already been awarded'
}
