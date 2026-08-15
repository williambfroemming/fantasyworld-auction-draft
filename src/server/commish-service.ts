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
import { getSql } from './sql'
import type { ActionResult } from './draft-service'

async function bumpRev() {
  await getSql()`UPDATE draft SET rev = rev + 1 WHERE id = 1`
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
 * Undo the most recent pick: refund it, return the player to the pool, and
 * rewind the nomination order by one so the same manager nominates again.
 */
export async function undoLastPick(): Promise<ActionResult<{ playerName: string }>> {
  const sql = getSql()
  const [last] = await sql`
    SELECT pk.id, pk.player_id, p.name FROM picks pk
    JOIN players p ON p.id = pk.player_id
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

  await sql`DELETE FROM picks WHERE id = ${last.id}`
  // Void the lot so the player is draftable again but the history is kept.
  await sql`UPDATE lots SET status = 'void' WHERE player_id = ${last.player_id} AND status = 'sold'`
  await sql`UPDATE draft SET nomination_index = GREATEST(0, nomination_index - 1) WHERE id = 1`
  await bumpRev()
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
    SELECT t.budget, t.rostered, d.roster_size, pk.price AS old_price
    FROM picks pk
    JOIN manager_totals t ON t.id = pk.manager_id
    CROSS JOIN draft d
    WHERE pk.id = ${pickId} AND d.id = 1`
  if (!check) return { ok: false, reason: 'Unknown pick' }

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
  const [pick] = await sql`SELECT price FROM picks WHERE id = ${pickId}`
  if (!pick) return { ok: false, reason: 'Unknown pick' }

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

/** Skip whoever is on the clock — they've stepped away. */
export async function skipNominator(): Promise<ActionResult<null>> {
  const sql = getSql()
  const [open] = await sql`SELECT id FROM lots WHERE status = 'open'`
  if (open) return { ok: false, reason: 'Finish the current lot first' }
  await sql`UPDATE draft SET nomination_index = nomination_index + 1 WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/** Cancel the lot on the clock without awarding it. */
export async function voidLot(): Promise<ActionResult<null>> {
  const sql = getSql()
  const rows = await sql`UPDATE lots SET status = 'void' WHERE status = 'open' RETURNING id`
  if (rows.length === 0) return { ok: false, reason: 'No lot is on the clock' }
  await sql`UPDATE draft SET nomination_index = GREATEST(0, nomination_index - 1) WHERE id = 1`
  await bumpRev()
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
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
  const [settings] = await sql`SELECT status FROM draft WHERE id = 1`
  if (Number(n) > 0 && settings.status !== 'setup') {
    return { ok: false, reason: 'The draft has started — use "swap two managers" instead' }
  }
  for (const [slot, id] of orderedManagerIds.entries()) {
    await sql`UPDATE managers SET draft_slot = ${slot} WHERE id = ${id}`
  }
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
  await bumpRev()
  return { ok: true, data: null }
}

/** Let someone re-set a forgotten PIN. */
export async function clearPin(managerId: number): Promise<ActionResult<null>> {
  await getSql()`UPDATE managers SET pin_hash = NULL WHERE id = ${managerId}`
  return { ok: true, data: null }
}

/** Budget and roster size. Locked once picks exist — both feed max bid. */
export async function setLeagueSettings(
  startingBudget: number,
  rosterSize: number,
): Promise<ActionResult<null>> {
  if (startingBudget < 1 || startingBudget > 10_000) return { ok: false, reason: 'Budget out of range' }
  if (rosterSize < 1 || rosterSize > 40) return { ok: false, reason: 'Roster size out of range' }

  const sql = getSql()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
  if (Number(n) > 0) {
    // Changing either mid-draft would silently rewrite every manager's max bid
    // and could push someone below $1 per empty slot retroactively.
    return { ok: false, reason: `Cannot change these after the draft starts (${n} picks made)` }
  }

  await sql`UPDATE draft SET starting_budget = ${startingBudget}, roster_size = ${rosterSize} WHERE id = 1`
  await bumpRev()
  return { ok: true, data: null }
}

/** Rename a manager / change what the board calls them. */
export async function renameManager(
  managerId: number,
  displayName: string,
): Promise<ActionResult<null>> {
  const trimmed = displayName.trim()
  if (!trimmed) return { ok: false, reason: 'Name cannot be empty' }
  await getSql()`UPDATE managers SET display_name = ${trimmed} WHERE id = ${managerId}`
  await bumpRev()
  return { ok: true, data: null }
}

/**
 * Wipe every pick, lot, trade, and adjustment and return to setup.
 *
 * Destructive and irreversible — this is the "we ran a rehearsal, now clear it
 * out" button. Managers, PINs, and the player pool are left alone.
 *
 * budget_adjustments must go too. Leaving them would carry trade cash from the
 * rehearsal into the real draft, and because budgets are derived nobody would
 * see a stale number to be suspicious of — they'd just start at $190.
 */
export async function resetDraft(): Promise<ActionResult<{ cleared: number }>> {
  const sql = getSql()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
  await sql`DELETE FROM budget_adjustments`
  await sql`DELETE FROM trades`
  await sql`DELETE FROM picks`
  await sql`DELETE FROM lots`
  await sql`UPDATE draft SET status = 'setup', nomination_index = 0, rev = rev + 1 WHERE id = 1`
  return { ok: true, data: { cleared: Number(n) } }
}
