/**
 * Commissioner actions — the escape hatches.
 *
 * Live drafts go wrong: someone mis-clicks a bid, a player gets awarded to the
 * wrong manager, the room needs to stop for twenty minutes. Every one of these
 * exists because the alternative is editing the database by hand at 11pm.
 *
 * All of them bump `draft.rev`, which is part of the polling fingerprint, so
 * every client picks the change up on its next poll.
 */
import { randomInt } from 'node:crypto'
import { hashPin } from '@/lib/auth'
import { getSql } from './sql'
import { getState, type ActionResult } from './draft-service'

async function bumpRev() {
  await getSql()`UPDATE draft SET rev = rev + 1 WHERE id = 1`
}

/**
 * The year being drafted right now.
 *
 * Every action in this file operates on the current season only. Past seasons
 * are an archive: undoing a pick from 2026 in 2028 would silently rewrite a
 * finished draft, and none of these controls are reachable from the read-only
 * archive view. See docs/BACKLOG.md §2.
 */
async function currentSeason(): Promise<number> {
  const [d] = await getSql()`SELECT season FROM draft WHERE id = 1`
  return Number(d.season)
}

/**
 * Copy the current seating into `season_orders` for this season.
 *
 * `managers.draft_slot`, `display_name` and `color` are live, mutable columns —
 * re-drawn every setup and editable all season. This snapshot is what makes
 * "who picked where in 2026" survive the 2027 draw. Called after anything that
 * changes seating or naming, so the current season's row always matches
 * reality; once the season rolls over, nothing writes to it again and it is
 * frozen for good.
 */
async function snapshotOrder(season: number) {
  await getSql()`
    INSERT INTO season_orders (season, manager_id, draft_slot, display_name, color)
    SELECT ${season}, m.id, m.draft_slot, m.display_name, m.color FROM managers m
    ON CONFLICT (season, manager_id)
    DO UPDATE SET draft_slot   = EXCLUDED.draft_slot,
                  display_name = EXCLUDED.display_name,
                  color        = EXCLUDED.color`
}

/**
 * Pause: stop nominations and awards until someone resumes.
 *
 * There is no clock to bank any more — an open lot simply stays open. Pause
 * exists so that a break, or an argument about a price, cannot be resolved by
 * someone quietly typing a result in while the room isn't looking.
 */
export async function pause(): Promise<ActionResult<null>> {
  await getSql()`UPDATE draft SET status = 'paused' WHERE id = 1 AND status = 'live'`
  await bumpRev()
  return { ok: true, data: null }
}

export async function resume(): Promise<ActionResult<null>> {
  await getSql()`UPDATE draft SET status = 'live' WHERE id = 1 AND status = 'paused'`
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Undo the most recent pick: refund it, return the player to the pool, and hand
 * the turn back to the manager who nominated it.
 *
 * "Hand the turn back" used to mean `nomination_index - 1`, which is wrong
 * whenever nomination skipped a full roster to reach that seat — the cursor
 * lands mid-skip-run instead of on the nominator. `lots.nomination_index` is
 * the recorded answer; see docs/BACKLOG.md §9 P2.
 */
export async function undoLastPick(): Promise<ActionResult<{ playerName: string }>> {
  const sql = getSql()
  const season = await currentSeason()
  const [last] = await sql`
    SELECT pk.id, pk.player_id, pk.player_name AS name FROM picks pk
    WHERE pk.season = ${season}
    ORDER BY pk.pick_no DESC LIMIT 1`
  if (!last) return { ok: false, reason: 'There are no picks to undo' }

  // A traded player's salary is held in place by a pair of budget_adjustments
  // that reference this pick's price. Deleting the pick would leave those
  // adjustments behind with nothing to cancel, quietly shifting both managers'
  // budgets for the rest of the draft. Undo the trade first.
  const [traded] = await sql`
    SELECT id FROM trades
    WHERE ${last.id}::int = ANY(picks_a_to_b) OR ${last.id}::int = ANY(picks_b_to_a)
    LIMIT 1`
  if (traded) {
    return {
      ok: false,
      reason: `${last.name} has been traded (trade #${traded.id}) — reverse the trade before undoing the pick`,
    }
  }

  // One statement, three effects: drop the pick, void its lot so the player is
  // draftable again while the history is kept, and rewind the cursor to the
  // seat that nominated. Split across three statements a failure between them
  // could leave a sold lot with no pick, or a refunded player still undraftable.
  //
  // The status reversal matters as much as the rewind: awarding the final pick
  // now flips the draft to 'done', and 'done' refuses nominations. Undoing that
  // pick without undoing the status would leave the draft one player short and
  // permanently unable to fill it.
  await sql`
    WITH gone AS (
      DELETE FROM picks WHERE id = ${last.id}
      RETURNING player_id
    ), voided AS (
      UPDATE lots SET status = 'void'
      WHERE player_id = (SELECT player_id FROM gone)
        AND status = 'sold' AND season = ${season}
      RETURNING nomination_index
    )
    UPDATE draft
    SET nomination_index = COALESCE(
          (SELECT v.nomination_index FROM voided v),
          GREATEST(0, draft.nomination_index - 1)),
        status = CASE WHEN status = 'done' THEN 'live' ELSE status END,
        rev = rev + 1
    WHERE id = 1`
  return { ok: true, data: { playerName: last.name } }
}

/** Fix a mistyped price. Budget recalculates automatically — it's derived. */
export async function editPrice(pickId: number, price: number): Promise<ActionResult<null>> {
  if (!Number.isInteger(price) || price < 1) {
    return { ok: false, reason: 'Every player costs at least $1' }
  }
  const sql = getSql()

  // Guard the invariant by hand here: this is the one path that can write a
  // price without going through the award rules, so it must not be able to push
  // a manager below $1 per empty roster slot.
  //
  // The starting point is manager_totals rather than a SUM over picks, because
  // that view is the only thing that also folds in budget_adjustments. Summing
  // picks directly would ignore every trade this manager has made.
  const [check] = await sql`
    SELECT t.budget, t.rostered, d.roster_size, pk.price AS old_price, pk.season
    FROM picks pk
    JOIN manager_totals t ON t.id = pk.manager_id
    CROSS JOIN draft d
    WHERE pk.id = ${pickId} AND d.id = 1`
  if (!check) return { ok: false, reason: 'Unknown pick' }
  // manager_totals only describes the current season, so its budget is the
  // wrong yardstick for an older pick — and a finished draft should not be
  // edited years later regardless.
  if (Number(check.season) !== (await currentSeason())) {
    return { ok: false, reason: `That pick is from the ${check.season} draft and is archived` }
  }

  const budget = Number(check.budget) - (price - Number(check.old_price))
  const slotsLeft = Number(check.roster_size) - Number(check.rostered)
  if (budget < slotsLeft) {
    return {
      ok: false,
      reason: `That would leave $${budget} for ${slotsLeft} empty slots — they need at least $1 each`,
    }
  }

  await sql`UPDATE picks SET price = ${price} WHERE id = ${pickId}`
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Give a player to a different manager — "we awarded that to the wrong person".
 *
 * NOT a trade. This moves the charge along with the player, because the premise
 * is that the original award was a mistake and the money was never really the
 * first manager's to spend. A trade deliberately leaves the salary behind; see
 * src/server/trade-service.ts.
 */
export async function reassignPick(pickId: number, managerId: number): Promise<ActionResult<null>> {
  const sql = getSql()
  const [pick] = await sql`SELECT price, season FROM picks WHERE id = ${pickId}`
  if (!pick) return { ok: false, reason: 'Unknown pick' }
  if (Number(pick.season) !== (await currentSeason())) {
    return { ok: false, reason: `That pick is from the ${pick.season} draft and is archived` }
  }

  // A traded player's salary stays with whoever drafted them, held in place by a
  // pair of budget_adjustments. Reassigning moves the charge with the player, so
  // on a traded pick it would quietly bill the new owner as well as leaving the
  // trade's cancelling pair behind. Same refusal as undoLastPick.
  const [traded] = await sql`
    SELECT id FROM trades
    WHERE ${pickId}::int = ANY(picks_a_to_b) OR ${pickId}::int = ANY(picks_b_to_a)
    LIMIT 1`
  if (traded) {
    return { ok: false, reason: `That player has been traded (trade #${traded.id}) — reassigning would double-charge` }
  }

  const [totals] = await sql`SELECT budget, rostered FROM manager_totals WHERE id = ${managerId}`
  const [settings] = await sql`SELECT roster_size FROM draft WHERE id = 1`
  if (!totals) return { ok: false, reason: 'Unknown manager' }
  if (Number(totals.rostered) >= Number(settings.roster_size)) {
    return { ok: false, reason: 'That roster is already full' }
  }
  const slotsAfter = Number(settings.roster_size) - Number(totals.rostered) - 1
  if (Number(totals.budget) - Number(pick.price) < slotsAfter) {
    return { ok: false, reason: 'They cannot afford it and still fill their roster' }
  }

  await sql`UPDATE picks SET manager_id = ${managerId} WHERE id = ${pickId}`
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Skip whoever is on the clock — they've stepped away.
 *
 * ⚠️ Advances past the seat that is *actually* on the clock, not past the raw
 * cursor. Those differ whenever full rosters were skipped to reach the current
 * nominator: with the cursor at 1 and seats 1–4 full, seat 5 is on the clock,
 * and `nomination_index + 1` would move the cursor to 2 — which still resolves
 * to seat 5. The skip button would do nothing, repeatedly, with the room
 * watching. Same root cause as docs/BACKLOG.md §9 P2: the cursor is not the
 * seat.
 */
export async function skipNominator(): Promise<ActionResult<null>> {
  const sql = getSql()
  const season = await currentSeason()
  const [open] = await sql`SELECT id FROM lots WHERE status = 'open' AND season = ${season}`
  if (open) return { ok: false, reason: 'Finish the current lot first' }

  const state = await getState()
  if (!state.onTheClock) return { ok: false, reason: 'Nobody is on the clock to skip' }

  await sql`UPDATE draft SET nomination_index = ${state.onTheClock.index + 1}, rev = rev + 1
            WHERE id = 1`
  return { ok: true, data: null }
}

/**
 * Cancel the lot on the clock without awarding it, and give the turn back to
 * whoever nominated it.
 *
 * Same rewind as `undoLastPick`, and for the same reason: nomination may have
 * advanced the cursor past several full rosters to reach that seat, so `- 1`
 * does not undo it. `lots.nomination_index` is the exact answer, with the old
 * behaviour kept as the fallback for lots opened before that column existed.
 *
 * One statement so a void cannot half-apply into a cancelled lot whose turn was
 * never returned — which reads in the room as the app skipping someone.
 */
export async function voidLot(): Promise<ActionResult<null>> {
  const sql = getSql()
  const season = await currentSeason()
  const rows = await sql`
    WITH voided AS (
      UPDATE lots SET status = 'void'
      WHERE status = 'open' AND season = ${season}
      RETURNING id, nomination_index
    )
    UPDATE draft
    SET nomination_index = COALESCE(
          (SELECT v.nomination_index FROM voided v),
          GREATEST(0, draft.nomination_index - 1)),
        rev = rev + 1
    WHERE id = 1 AND EXISTS (SELECT 1 FROM voided)
    RETURNING (SELECT v.id FROM voided v) AS lot_id`
  if (rows.length === 0) return { ok: false, reason: 'No lot is on the clock' }
  return { ok: true, data: null }
}

export async function setStatus(status: 'setup' | 'live' | 'done'): Promise<ActionResult<null>> {
  await getSql()`UPDATE draft SET status = ${status} WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/** Re-draw the seating. Locked once the draft is live and picks exist. */
export async function setDraftOrder(orderedManagerIds: number[]): Promise<ActionResult<null>> {
  const sql = getSql()
  const [settings] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const season = Number(settings.season)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  if (Number(n) > 0 && settings.status !== 'setup') {
    return { ok: false, reason: 'The draft has started — use "swap two managers" instead' }
  }
  for (const [slot, id] of orderedManagerIds.entries()) {
    await sql`UPDATE managers SET draft_slot = ${slot} WHERE id = ${id}`
  }
  await snapshotOrder(season)
  await bumpRev()
  return { ok: true, data: null }
}

/** Swap two seats mid-draft; completed picks are untouched. */
export async function swapSeats(aId: number, bId: number): Promise<ActionResult<null>> {
  const sql = getSql()
  const rows = await sql`SELECT id, draft_slot FROM managers WHERE id IN (${aId}, ${bId})`
  if (rows.length !== 2) return { ok: false, reason: 'Unknown manager' }
  const [a, b] = rows
  await sql`UPDATE managers SET draft_slot = ${b.draft_slot} WHERE id = ${a.id}`
  await sql`UPDATE managers SET draft_slot = ${a.draft_slot} WHERE id = ${b.id}`
  await snapshotOrder(await currentSeason())
  await bumpRev()
  return { ok: true, data: null }
}

/** Let someone re-set a forgotten PIN. */
export async function clearPin(managerId: number): Promise<ActionResult<null>> {
  await getSql()`UPDATE managers SET pin_hash = NULL, pin_attempts = 0, pin_locked_until = NULL WHERE id = ${managerId}`
  return { ok: true, data: null }
}

/**
 * Give a member a new PIN and hand it back, once, to the commissioner to pass on.
 *
 * This is the "I forgot my PIN" path. It sets a PIN rather than clearing one on purpose:
 * a cleared seat can be claimed by whoever reaches the sign-in screen first, and the
 * sign-in screen is public. Here there is no unclaimed moment. The member signs in with
 * the PIN they are given and can ask for another any time.
 *
 * Random, so the commissioner is not choosing (or reusing) a PIN. Also lifts a lockout.
 */
export async function resetPin(managerId: number): Promise<ActionResult<{ pin: string }>> {
  const sql = getSql()
  const pin = String(randomInt(0, 10_000)).padStart(4, '0')
  const rows = await sql`
    UPDATE managers SET pin_hash = ${await hashPin(pin)}, pin_attempts = 0, pin_locked_until = NULL
    WHERE id = ${managerId} RETURNING id`
  if (rows.length === 0) return { ok: false, reason: 'Unknown manager' }
  return { ok: true, data: { pin } }
}

/** Budget and roster size. Locked once picks exist — both feed max bid. */
export async function setLeagueSettings(
  startingBudget: number,
  rosterSize: number,
): Promise<ActionResult<null>> {
  if (startingBudget < 1 || startingBudget > 10_000) return { ok: false, reason: 'Budget out of range' }
  if (rosterSize < 1 || rosterSize > 40) return { ok: false, reason: 'Roster size out of range' }

  const sql = getSql()
  const season = await currentSeason()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  if (Number(n) > 0) {
    // Changing either mid-draft would silently rewrite every manager's max bid
    // and could push someone below $1 per empty slot retroactively.
    //
    // Scoped to this season on purpose: a past draft's 160 picks must not lock
    // the league out of changing the budget for a NEW year.
    return { ok: false, reason: `Cannot change these after the draft starts (${n} picks made)` }
  }

  await sql`UPDATE draft SET starting_budget = ${startingBudget}, roster_size = ${rosterSize} WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * The facts about a season that exist in no API: prize money, the buy-in, the
 * weekly side bet, and where the draft was held.
 *
 * These live on `seasons`, not `draft`, because they are facts about a *year*
 * rather than settings the auction engine reads — nothing here can change a
 * budget, a max bid or a pick. That is why, unlike `setLeagueSettings`, they
 * stay editable after the first pick and for any past year: the room only
 * agrees the buy-in once everyone has paid, prize money is settled at the end
 * of the season, and somebody always wants to add the city months later.
 *
 * ⚠️ Null is UNKNOWN, never zero, for every money field — the same semantics as
 * `npm run season:info` (scripts/set-season-info.ts). 2006–2010 paid something
 * nobody wrote down; 2011–2013 genuinely paid $0. A form that turned an empty
 * box into 0 would make career winnings quietly authoritative about years it
 * knows nothing about.
 */
export interface SeasonDetails {
  season: number
  city: string | null
  state: string | null
  buyIn: number | null
  championPrize: number | null
  runnerUpPrize: number | null
  thirdPrize: number | null
  sideBet: number | null
}

export const SEASON_MONEY_FIELDS = ['buyIn', 'championPrize', 'runnerUpPrize', 'thirdPrize', 'sideBet'] as const

export async function setSeasonDetails(d: SeasonDetails): Promise<ActionResult<null>> {
  for (const f of SEASON_MONEY_FIELDS) {
    const v = d[f]
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100_000)) {
      return { ok: false, reason: 'Dollar amounts must be whole numbers between 0 and 100,000' }
    }
  }
  const sql = getSql()
  const current = await currentSeason()
  const city = d.city?.trim() || null
  const stateName = d.state?.trim() || null

  // The current season may not have a `seasons` row yet — it only gets one when
  // the history import first sees it — so that year upserts. Any other year must
  // already be on record: inventing a row for 2031 from a typo would put an
  // empty season in the archive. Country is fixed: the history import writes
  // 'USA' for every season, and it is a field nobody would ever fill in.
  const rows =
    d.season === current
      ? await sql`
          INSERT INTO seasons (season, draft_city, draft_state, draft_country, buy_in,
                               champion_prize, runner_up_prize, third_prize, side_bet, data_tier)
          VALUES (${d.season}, ${city}, ${stateName}, ${city ? 'USA' : null}, ${d.buyIn},
                  ${d.championPrize}, ${d.runnerUpPrize}, ${d.thirdPrize}, ${d.sideBet}, 'weekly')
          ON CONFLICT (season) DO UPDATE SET
            draft_city      = excluded.draft_city,
            draft_state     = excluded.draft_state,
            draft_country   = COALESCE(excluded.draft_country, seasons.draft_country),
            buy_in          = excluded.buy_in,
            champion_prize  = excluded.champion_prize,
            runner_up_prize = excluded.runner_up_prize,
            third_prize     = excluded.third_prize,
            side_bet        = excluded.side_bet
          RETURNING season`
      : await sql`
          UPDATE seasons SET
            draft_city      = ${city},
            draft_state     = ${stateName},
            draft_country   = COALESCE(${city ? 'USA' : null}, draft_country),
            buy_in          = ${d.buyIn},
            champion_prize  = ${d.championPrize},
            runner_up_prize = ${d.runnerUpPrize},
            third_prize     = ${d.thirdPrize},
            side_bet        = ${d.sideBet}
          WHERE season = ${d.season}
          RETURNING season`
  if (rows.length === 0) return { ok: false, reason: `No ${d.season} season on record` }
  return { ok: true, data: null }
}

const nullableInt = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/**
 * Every season on record, newest first, plus the current one even if the
 * history import has not given it a row yet. Its own read, never a field on
 * `/api/state`: this changes about once a year and that payload is polled
 * every 400ms.
 */
export async function listSeasonDetails(): Promise<{ current: number; seasons: SeasonDetails[] }> {
  const current = await currentSeason()
  const rows = await getSql()`
    SELECT season, draft_city, draft_state, buy_in, champion_prize, runner_up_prize,
           third_prize, side_bet
    FROM seasons ORDER BY season DESC`
  const seasons: SeasonDetails[] = rows.map((r) => ({
    season: Number(r.season),
    city: (r.draft_city as string | null) ?? null,
    state: (r.draft_state as string | null) ?? null,
    buyIn: nullableInt(r.buy_in),
    championPrize: nullableInt(r.champion_prize),
    runnerUpPrize: nullableInt(r.runner_up_prize),
    thirdPrize: nullableInt(r.third_prize),
    sideBet: nullableInt(r.side_bet),
  }))
  if (!seasons.some((x) => x.season === current)) {
    seasons.unshift({
      season: current, city: null, state: null, buyIn: null,
      championPrize: null, runnerUpPrize: null, thirdPrize: null, sideBet: null,
    })
  }
  return { current, seasons }
}

/** Rename a manager / change what the board calls them. */
export async function renameManager(
  managerId: number,
  displayName: string,
): Promise<ActionResult<null>> {
  const trimmed = displayName.trim()
  if (!trimmed) return { ok: false, reason: 'Name cannot be empty' }
  await getSql()`UPDATE managers SET display_name = ${trimmed} WHERE id = ${managerId}`
  // Only the current season's snapshot follows the rename. Past seasons keep
  // the name that was on the board that night.
  await snapshotOrder(await currentSeason())
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Wipe THIS SEASON'S picks, lots, trades, and adjustments and return to setup.
 *
 * Destructive and irreversible — this is the "we ran a rehearsal, now clear it
 * out" button. Managers, PINs, and the player pool are left alone.
 *
 * ⚠️ This is NOT how a new year starts. Use `startNewSeason()` /
 * `npm run season:new` for that: it keeps the finished draft and rolls the
 * season forward, which is the whole point of docs/BACKLOG.md §2. Reset exists
 * to clear a *rehearsal* of the season currently being set up.
 *
 * Every DELETE is scoped to `draft.season`. Unscoped, this single function
 * would erase every draft the league has ever run — which is exactly the risk
 * §2 was written about.
 *
 * budget_adjustments must go too. Leaving them would carry trade cash from the
 * rehearsal into the real draft, and because budgets are derived nobody would
 * see a stale number to be suspicious of — they'd just start at $190.
 */
export async function resetDraft(): Promise<ActionResult<{ cleared: number; season: number }>> {
  const sql = getSql()
  const season = await currentSeason()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${season}`
  await sql`DELETE FROM budget_adjustments WHERE season = ${season}`
  await sql`DELETE FROM trades WHERE season = ${season}`
  await sql`DELETE FROM picks WHERE season = ${season}`
  await sql`DELETE FROM lots WHERE season = ${season}`
  await sql`UPDATE draft SET status = 'setup', nomination_index = 0, rev = rev + 1 WHERE id = 1`
  return { ok: true, data: { cleared: Number(n), season } }
}

/**
 * Start a new season. The replacement for "reset and start over".
 *
 * Deletes nothing. The finished draft keeps its rows, tagged with the season it
 * belonged to, and simply stops matching the current-season filter — so it
 * drops out of every live query and appears in the archive instead.
 *
 * Refuses to move backwards or sideways: a season is only ever created ahead of
 * the current one, because rolling onto a year that already has picks would
 * merge two drafts into one and produce budgets that are the sum of both.
 */
export async function startNewSeason(year: number): Promise<ActionResult<{ season: number }>> {
  const sql = getSql()
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    return { ok: false, reason: 'That is not a season year' }
  }

  const [d] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const current = Number(d.season)
  if (year <= current) {
    return { ok: false, reason: `The league is already on ${current} — a new season must be later` }
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${year}`
  if (Number(n) > 0) {
    return { ok: false, reason: `${year} already has ${n} picks — it is not a new season` }
  }

  // Freeze the outgoing season's seating before managers.draft_slot is re-drawn
  // for the new year. After this, nothing writes to that row again.
  await snapshotOrder(current)

  await sql`UPDATE draft
            SET season = ${year}, status = 'setup', nomination_index = 0, rev = rev + 1
            WHERE id = 1`

  // Seed the new season's order from the seating as it stands, so the archive
  // has a row for it even if nobody re-draws before the draft.
  await snapshotOrder(year)
  return { ok: true, data: { season: year } }
}

/**
 * Lift a PIN lockout without touching the PIN.
 *
 * `resetPin` also lifts a lock, but it hands the member a new PIN they did not
 * ask for. When a seat is locked because someone fat-fingered it five times (or
 * because a stranger guessed at it — see src/lib/pin-lockout.ts), the member's
 * own PIN is still fine, and they should be able to use it.
 */
export async function unlockSeat(managerId: number): Promise<ActionResult<null>> {
  const rows = await getSql()`
    UPDATE managers SET pin_attempts = 0, pin_locked_until = NULL
    WHERE id = ${managerId} RETURNING id`
  if (rows.length === 0) return { ok: false, reason: 'Unknown manager' }
  return { ok: true, data: null }
}

/**
 * Make someone a commissioner, or stop them being one.
 *
 * ⚠️ There must always be at least one. A league with no commissioner cannot
 * fix a pick, reset a PIN or start a season from the app, and the only way back
 * would be a hand-written UPDATE.
 *
 * ⚠️ The guard has to LOCK the other commissioners, not just count them. The
 * first version checked `EXISTS (another commissioner)` and lost a race the
 * integration test caught: under READ COMMITTED, two commissioners removing
 * each other at the same moment each update a *different* row, so neither
 * waits, each sees the other still flagged, and both succeed — zero left.
 * `FOR UPDATE` on the rows being counted makes the second statement wait for
 * the first, then re-read those rows and see that the other has gone. Every
 * commissioner row is locked — the caller's own included — in id order, so two
 * concurrent removals queue behind each other instead of each holding one row
 * the other needs (a deadlock). Still one statement, because Neon's HTTP driver
 * has no interactive transactions.
 *
 * Bumps `draft.rev`: `isCommish` rides on `/api/state`'s managers list, and
 * without the bump no client would notice the change until the next pick.
 */
export async function setCommish(managerId: number, on: boolean): Promise<ActionResult<null>> {
  const sql = getSql()
  const rows = await sql`
    WITH commissioners AS (
      SELECT id FROM managers WHERE is_commish ORDER BY id FOR UPDATE
    )
    UPDATE managers SET is_commish = ${on}
    WHERE id = ${managerId}
      AND (${on} OR (SELECT count(*) FROM commissioners c WHERE c.id <> ${managerId}) > 0)
    RETURNING id`
  if (rows.length === 0) {
    const [exists] = await sql`SELECT id FROM managers WHERE id = ${managerId}`
    return {
      ok: false,
      reason: exists ? 'There must always be at least one commissioner' : 'Unknown manager',
    }
  }
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Record a sale outside the nomination order — "we bought him in the room but
 * the app wouldn't let us enter it". The in-app version of `npm run draft:record`.
 *
 * It bypasses **whose turn it is** and nothing else. The lot and the pick are
 * written by ONE statement with the same max-bid check and the same player
 * snapshot as `awardLot()`, so a price that would strand a manager below $1 per
 * empty slot is refused by the database exactly as it is in the room.
 *
 * The lot records the cursor as it stands, and the cursor does not move. That is
 * what makes undo safe: `undoLastPick` rewinds `nomination_index` to the lot's
 * recorded value — here "where it already was" — instead of falling back to
 * `- 1` and stealing a turn from whoever is on the clock.
 *
 * The buyer is recorded as their own nominator. Inventing someone else's name in
 * the permanent record would be a lie.
 */
export async function recordSale(
  playerId: string,
  managerId: number,
  price: number,
): Promise<ActionResult<{ pickNo: number; draftComplete: boolean }>> {
  if (!Number.isInteger(price) || price < 1) {
    return { ok: false, reason: 'Every player costs at least $1' }
  }
  const sql = getSql()
  const [settings] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const season = Number(settings.season)
  if (settings.status === 'setup') {
    return { ok: false, reason: 'The draft has not started — start it first' }
  }

  const rows = await sql`
    WITH lot AS (
      INSERT INTO lots (season, player_id, nominator_id, nomination_index, sold_price, winner_id, status)
      SELECT ${season}, p.id, ${managerId}, d.nomination_index, ${price}, ${managerId}, 'sold'
      FROM players p CROSS JOIN draft d
      WHERE p.id = ${playerId}
        AND d.id = 1
        AND ${price} <= (SELECT max_bid FROM manager_totals WHERE id = ${managerId})
        AND NOT EXISTS (
          SELECT 1 FROM picks pk WHERE pk.player_id = ${playerId} AND pk.season = ${season})
        AND NOT EXISTS (
          SELECT 1 FROM lots l
          WHERE l.player_id = ${playerId} AND l.season = ${season} AND l.status = 'open')
      RETURNING player_id, nominator_id
    )
    INSERT INTO picks (season, pick_no, player_id, player_name, player_team,
                       player_position, player_rank, player_pos_rank,
                       player_sleeper_id, manager_id, nominator_id, price)
    SELECT ${season},
           (SELECT COALESCE(MAX(pick_no), 0) FROM picks WHERE season = ${season}) + 1,
           lot.player_id, p.name, p.team, p.position, p.search_rank, p.pos_rank,
           p.sleeper_id,
           ${managerId}, lot.nominator_id, ${price}
    FROM lot JOIN players p ON p.id = lot.player_id
    ON CONFLICT (season, player_id) DO NOTHING
    RETURNING pick_no`

  if (rows.length === 0) {
    // Narrate the refusal after the fact; the database already decided it.
    const [player] = await sql`SELECT name FROM players WHERE id = ${playerId}`
    if (!player) return { ok: false, reason: 'Unknown player' }
    const [drafted] = await sql`
      SELECT m.display_name FROM picks pk JOIN managers m ON m.id = pk.manager_id
      WHERE pk.player_id = ${playerId} AND pk.season = ${season}`
    if (drafted) return { ok: false, reason: `${player.name} is already on ${drafted.display_name}'s roster` }
    const [open] = await sql`
      SELECT 1 AS x FROM lots WHERE player_id = ${playerId} AND season = ${season} AND status = 'open'`
    if (open) return { ok: false, reason: `${player.name} is on the block right now — award or cancel that lot` }
    const [t] = await sql`
      SELECT t.budget, t.rostered, t.max_bid, m.display_name
      FROM manager_totals t JOIN managers m ON m.id = t.id WHERE t.id = ${managerId}`
    if (!t) return { ok: false, reason: 'Unknown manager' }
    return {
      ok: false,
      reason:
        `$${price} is over ${t.display_name}'s max bid of $${t.max_bid} ` +
        `(budget $${t.budget}, ${t.rostered} rostered)`,
    }
  }

  // Same completion rule as awardLot: every roster full means the draft is over.
  const [after] = await sql`
    UPDATE draft
    SET status = CASE
          WHEN status IN ('live', 'done')
           AND NOT EXISTS (SELECT 1 FROM manager_totals t WHERE t.rostered < draft.roster_size)
          THEN 'done' ELSE status END,
        rev = rev + 1
    WHERE id = 1
    RETURNING status`
  return {
    ok: true,
    data: { pickNo: Number(rows[0].pick_no), draftComplete: after?.status === 'done' },
  }
}

/**
 * Everything the members panel needs that `/api/state` must not carry.
 *
 * Lock state and attempt counts are commissioner business: they say who has been
 * guessing at whose seat. They stay off the polling payload and the fingerprint,
 * and `pin_hash` is never selected at all — only whether it is null.
 */
export interface AdminMember {
  id: number
  displayName: string
  color: string
  hasPin: boolean
  pinAttempts: number
  pinLockedUntil: string | null
  isCommish: boolean
}

export async function listMembers(): Promise<AdminMember[]> {
  const rows = await getSql()`
    SELECT id, display_name, color, (pin_hash IS NOT NULL) AS has_pin, pin_attempts,
           CASE WHEN pin_locked_until > now() THEN pin_locked_until END AS locked_until,
           is_commish
    FROM managers ORDER BY draft_slot, id`
  return rows.map((r) => ({
    id: Number(r.id),
    displayName: r.display_name as string,
    color: r.color as string,
    hasPin: Boolean(r.has_pin),
    pinAttempts: Number(r.pin_attempts),
    pinLockedUntil: r.locked_until ? new Date(r.locked_until as string).toISOString() : null,
    isCommish: Boolean(r.is_commish),
  }))
}
