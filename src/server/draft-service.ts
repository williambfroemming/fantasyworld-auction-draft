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
import { managerColor } from '@/lib/colors'

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
  /**
   * Availability for the player on the block (docs/BACKLOG.md §1).
   *
   * ⚠️ This looks like it breaks §1's "news never touches `/api/state`" and does
   * not. That rule exists to keep a **third-party fetch** off the path every
   * client polls — someone else's uptime must never sit in front of an award.
   * This is a stored column, refreshed out-of-band by `npm run news:refresh`,
   * read from a join on `players` that this query already performs for the name
   * and bye week. No new query, no new dependency, nothing that can time out.
   *
   * It has to come through here because the open lot is deliberately *excluded*
   * from `/api/board`'s pool, so the one player whose health matters most —
   * the one money is about to be committed to — is the one the pool payload
   * cannot carry.
   *
   * Not in the fingerprint, so a refresh mid-draft will not wake every client.
   * That is correct: this is refreshed before draft night, not during it.
   */
  playerInjury: {
    status: string
    bodyPart: string | null
    notes: string | null
    practice: string | null
    updatedAt: string | null
  } | null
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

/**
 * The polling fingerprint on its own, in a single query.
 *
 * `/api/state` answers the overwhelming majority of polls with a 204, and every
 * one of those used to cost five queries: the fingerprint is computed *from* the
 * state, so `getState()` had to build the entire state — managers, the open lot,
 * recent picks — before it could discover nothing had changed and discard all of
 * it. The heaviest of the five is the `manager_totals` join, an aggregate over
 * `picks` and `budget_adjustments` that the 204 path never reads.
 *
 * At draft-night cadence that is ~12.5 queries/second across ten clients. It is
 * also what makes a forgotten dev tab dangerous: four days of one exhausted the
 * project's data-transfer quota and 500'd the live board. See
 * `src/db/neon-local.ts` for the other half of that fix.
 *
 * So the unchanged path now reads only what the fingerprint is made of: five
 * scalars, one round trip, no aggregate view.
 *
 * ## This must produce exactly what `getState()` produces
 *
 * Two functions computing one fingerprint is the hazard here. If they ever
 * disagree the failure is silent and total — clients either poll forever without
 * ever seeing a change, or refetch the whole board on every tick. They are kept
 * honest structurally: both build `VersionParts` and hand it to the same
 * `fingerprint()`, so only the SQL differs, and `state-version.itest.ts` asserts
 * the two agree across nominate, award, undo and trade.
 *
 * The season filters are load-bearing for the usual reason (AGENTS.md): an
 * unscoped `picks` count folds every past draft into the number, and a
 * fingerprint that counts last year's rows stops moving when this year's change.
 */
export async function getVersion(): Promise<string | null> {
  const sql = getSql()

  // The subqueries correlate on `d.season` rather than a separately-read year,
  // so the season filter cannot drift from the row it belongs to.
  const rows = await sql`
    SELECT d.season, d.rev, d.status,
           (SELECT l.id FROM lots l
             WHERE l.status = 'open' AND l.season = d.season
             LIMIT 1) AS lot_id,
           (SELECT count(*)::int FROM picks WHERE season = d.season) AS pick_count
      FROM draft d
     WHERE d.id = 1`

  // Null rather than a throw: an uninitialised draft is `getState()`'s error to
  // report, with its "run `npm run db:seed`" hint. The caller falls through to it
  // rather than this path inventing a second, worse version of that message.
  const d = rows[0]
  if (!d) return null

  return fingerprint({
    season: d.season as number,
    rev: d.rev as number,
    lotId: (d.lot_id as number | null) ?? null,
    pickCount: d.pick_count as number,
    draftStatus: d.status as string,
  })
}

export interface LiveSeason {
  season: number
  status: string
  rosterSize: number
  picks: number
  /** Managers with an unfilled roster. Zero means the draft is over. */
  unfilled: number
  seats: number
}

/**
 * The cheap read: what season is it, and is the draft over?
 *
 * One query, next to `getVersion()` for the same reason that one exists — the
 * expensive function is not always the one you need. The landing page (`/`)
 * calls this on every visit to decide whether to redirect to `/draft`, and
 * `getState()`'s five queries would be four wasted on a question this answers
 * on its own.
 *
 * ⚠️ **"Is the draft over" is `unfilled === 0`, never `status === 'done'`.**
 * The flag is set by hand and lags — the whole of `docs/BACKLOG.md` §9 P1. It is
 * returned here for display ("paused" is worth saying out loud) and must not be
 * used to answer the question.
 *
 * ⚠️ `seats` exists so that "nobody has a roster yet" cannot read as complete.
 * An empty `managers` table makes `unfilled` zero, which would send the first
 * visitor of a brand-new season to a front page announcing a finished draft.
 * This is the same guard `draftComplete()` spells `managers.length > 0`.
 *
 * `manager_totals` is season-scoped in its own definition
 * (`src/db/sql/manager_totals.sql`), so the season filter is inherited rather
 * than restated — which is the only way it cannot drift from `d.season`.
 */
export async function getLiveSeason(): Promise<LiveSeason | null> {
  const sql = getSql()

  const rows = await sql`
    SELECT d.season, d.status, d.roster_size,
           (SELECT count(*)::int FROM picks WHERE season = d.season) AS picks,
           (SELECT count(*)::int FROM manager_totals t
             WHERE t.rostered < d.roster_size) AS unfilled,
           (SELECT count(*)::int FROM manager_totals) AS seats
      FROM draft d
     WHERE d.id = 1`

  // Null rather than a throw, matching `getVersion()`: an uninitialised draft is
  // a state the caller renders, not an exception it catches.
  const d = rows[0]
  if (!d) return null

  return {
    season: Number(d.season),
    status: String(d.status),
    rosterSize: Number(d.roster_size),
    picks: Number(d.picks),
    unfilled: Number(d.unfilled),
    seats: Number(d.seats),
  }
}

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
               p.position AS player_position, p.bye_week AS player_bye_week,
               p.injury_status, p.injury_body_part, p.injury_notes,
               p.practice_participation, p.injury_updated_at
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
    // Mapped here rather than in each component: `color` reaches the client as
    // a theme-aware `var(--mgr-*)` so the board is correct on newsprint and on
    // the Late Edition ground alike. See src/lib/colors.ts.
    color: managerColor(m.color),
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
        playerInjury: l.injury_status
          ? {
              status: l.injury_status as string,
              bodyPart: (l.injury_body_part as string | null) ?? null,
              notes: (l.injury_notes as string | null) ?? null,
              practice: (l.practice_participation as string | null) ?? null,
              updatedAt: l.injury_updated_at ? String(l.injury_updated_at) : null,
            }
          : null,
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
  //
  // The lot records the index it was nominated at. The line below advances the
  // cursor past any seats that were skipped to reach this one, so the distance
  // moved is not always 1 and cannot be inferred later — see docs/BACKLOG.md §9 P2.
  const season = state.draft.season
  const rows = await sql`
    INSERT INTO lots (season, player_id, nominator_id, nomination_index)
    SELECT ${season}, ${playerId}, ${managerId}, ${state.onTheClock.index}
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
): Promise<ActionResult<{ pickNo: number; draftComplete: boolean }>> {
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

  // The player's name/team/position/rank are copied onto the pick here, at
  // award time. That snapshot is what the archive renders from years later,
  // when the pool has been re-imported and this player may have changed team,
  // changed position, or left `players` entirely. See docs/BACKLOG.md §2.
  //
  // Rank rides along for the same reason and is what lets /stats score a
  // finished season's bargains and overpays. It costs nothing here: `players`
  // is already joined to read the name.
  //
  // `sleeper_id` rides along too, and is the only value here that will still
  // mean the same thing in three years: `player_id` is a slug that dies with
  // the pool that produced it. Nullable, and often null — treat it as
  // "unknown", never as an error. See docs/BACKLOG.md §2.
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
                       player_position, player_rank, player_pos_rank,
                       player_sleeper_id, manager_id, nominator_id, price)
    SELECT ${season},
           (SELECT COALESCE(MAX(pick_no), 0) FROM picks WHERE season = ${season}) + 1,
           sold.player_id, p.name, p.team, p.position, p.search_rank, p.pos_rank,
           p.sleeper_id,
           ${winnerId}, sold.nominator_id, ${price}
    FROM sold JOIN players p ON p.id = sold.player_id
    ON CONFLICT (season, player_id) DO NOTHING
    RETURNING pick_no`

  if (rows.length === 0) return { ok: false, reason: await explainRejectedAward(winnerId, price) }

  // If that was the last empty slot in the league, the draft is over — record
  // it. Until now `setStatus` was only ever called by hand, so the database
  // never actually learned the draft had ended; the screen knew, because every
  // consumer that matters asks "is anybody unfilled?" instead of trusting the
  // flag. See docs/BACKLOG.md §9 P1.
  //
  // Those consumers stay as they are. This makes the flag true, it does not
  // make it authoritative: `stats.ts` still refuses to trust it, because an
  // archived season has no live status and a commissioner can still set it by
  // hand. The flag is now a *record* that the draft finished, not a source.
  //
  // Uses the same definition of "complete" as `nominatorAt` — every manager at
  // rosterSize, asked of the derived view rather than a pick count, so it stays
  // right after a trade moves players around. Idempotent and guarded on
  // 'live', so a paused or already-done draft is untouched, and undoing the
  // final pick flips it back (see `undoLastPick`).
  const [finished] = await sql`
    UPDATE draft
    SET status = 'done', rev = rev + 1
    WHERE id = 1
      AND status = 'live'
      AND NOT EXISTS (SELECT 1 FROM manager_totals t WHERE t.rostered < draft.roster_size)
    RETURNING season`

  return { ok: true, data: { pickNo: Number(rows[0].pick_no), draftComplete: Boolean(finished) } }
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
