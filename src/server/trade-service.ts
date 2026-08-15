/**
 * Trades: players and auction dollars, both directions, in one transaction.
 *
 * ## The league's rule
 *
 * A traded player's **salary stays with whoever bought them at auction**. If
 * Bill drafts Josh Allen for $50 and trades him to Justin, Bill keeps paying the
 * $50 and Justin gets him for nothing. The only money that actually moves is the
 * cash the two managers explicitly agree to swap.
 *
 * That rule is at odds with how ownership is stored. Current ownership lives in
 * `picks.manager_id` — every roster, board, and export query reads it — so a
 * trade has to move it. But budget is derived by summing `picks.price` over that
 * same column, so moving it would drag the $50 along too.
 *
 * The fix is a compensating pair in `budget_adjustments`: −$50 to Bill, +$50 to
 * Justin, exactly cancelling what the move did to their derived budgets. Budget
 * is still never stored, ownership still has one home, and the two rules stop
 * fighting. Every trade's adjustments sum to zero across the league.
 *
 * ## Why it is one statement
 *
 * Neon's HTTP driver has no interactive transactions (docs/PROJECT_PLAN.md §4),
 * and a half-applied trade is the worst possible outcome here — players moved
 * but the compensating adjustments missing would silently charge the wrong
 * manager for the rest of the draft, which is precisely the class of bug this
 * app exists to eliminate. A single statement with data-modifying CTEs is atomic
 * by construction, so there is no half-applied state to recover from.
 *
 * Do not split this into "validate, then apply". Every check lives in the `ok`
 * CTE, and when `ok` is empty every downstream CTE writes nothing.
 */
import { getSql } from './sql'
import type { ActionResult } from './draft-service'
import { validateTrade } from '@/lib/draft'

export interface TradeInput {
  aId: number
  bId: number
  /** Pick ids moving from A to B. */
  picksAToB: number[]
  picksBToA: number[]
  /** Non-negative. Netted before storage. */
  cashAToB: number
  cashBToA: number
}

export interface TradeSummary {
  id: number
  createdAt: string
  managerAId: number
  managerBId: number
  cashAToB: number
  players: Array<{
    pickId: number
    name: string
    position: string
    price: number
    /** Which side this player ended up on. */
    toManagerId: number
  }>
}

/**
 * Postgres array literal from ids we have already proven are integers.
 *
 * Built by hand rather than relying on the driver's array encoding: this string
 * ends up inside an `= ANY(...)`, and a silently mis-encoded array would not
 * error, it would just match nothing and apply half a trade.
 */
function intArrayLiteral(ids: number[]): string {
  return `{${ids.join(',')}}`
}

export async function executeTrade(
  callerId: number,
  input: TradeInput,
): Promise<ActionResult<{ tradeId: number }>> {
  const sql = getSql()
  const { aId, bId, picksAToB, picksBToA, cashAToB, cashBToA } = input

  // --- shape checks, before anything touches the database --------------------
  if (aId === bId) return { ok: false, reason: 'Pick two different managers' }
  for (const id of [...picksAToB, ...picksBToA]) {
    if (!Number.isInteger(id) || id < 1) return { ok: false, reason: 'Bad player selection' }
  }
  if (new Set(picksAToB).size !== picksAToB.length || new Set(picksBToA).size !== picksBToA.length) {
    return { ok: false, reason: 'The same player is listed twice' }
  }
  for (const cash of [cashAToB, cashBToA]) {
    if (!Number.isInteger(cash) || cash < 0) {
      return { ok: false, reason: 'Cash must be a whole dollar amount of $0 or more' }
    }
  }

  const [settings] = await sql`SELECT season, status, roster_size FROM draft WHERE id = 1`
  if (settings.status === 'setup') {
    return { ok: false, reason: 'The draft has not started — there is nothing to trade yet' }
  }
  const season = Number(settings.season)

  // A readable rejection, computed up front. The database still has the final
  // say below; this exists so the message names the manager and the shortfall
  // instead of "trade rejected".
  const [ta] = await sql`SELECT t.budget, t.rostered, m.display_name
                         FROM manager_totals t JOIN managers m ON m.id = t.id WHERE t.id = ${aId}`
  const [tb] = await sql`SELECT t.budget, t.rostered, m.display_name
                         FROM manager_totals t JOIN managers m ON m.id = t.id WHERE t.id = ${bId}`
  if (!ta || !tb) return { ok: false, reason: 'Unknown manager' }

  const pre = validateTrade({
    rosterSize: Number(settings.roster_size),
    a: {
      name: ta.display_name,
      budget: Number(ta.budget),
      rostered: Number(ta.rostered),
      playersOut: picksAToB.length,
      playersIn: picksBToA.length,
      cashOut: cashAToB,
      cashIn: cashBToA,
    },
    b: {
      name: tb.display_name,
      budget: Number(tb.budget),
      rostered: Number(tb.rostered),
      playersOut: picksBToA.length,
      playersIn: picksAToB.length,
      cashOut: cashBToA,
      cashIn: cashAToB,
    },
  })
  if (!pre.ok) return pre

  const aArr = intArrayLiteral(picksAToB)
  const bArr = intArrayLiteral(picksBToA)

  // --- the whole trade, atomically ------------------------------------------
  const rows = await sql`
    WITH input AS (
      SELECT ${aId}::int AS a_id, ${bId}::int AS b_id,
             ${aArr}::int[] AS a_picks, ${bArr}::int[] AS b_picks,
             ${cashAToB}::int AS cash_a, ${cashBToA}::int AS cash_b,
             ${callerId}::int AS created_by, ${season}::int AS season
    ),
    facts AS (
      SELECT i.*,
             d.roster_size,
             ta.budget AS a_budget, ta.rostered AS a_rostered,
             tb.budget AS b_budget, tb.rostered AS b_rostered,
             COALESCE(array_length(i.a_picks, 1), 0) AS a_n,
             COALESCE(array_length(i.b_picks, 1), 0) AS b_n,
             -- counted with the ownership filter: this is what proves every
             -- listed player is actually on the giving manager's roster right
             -- now, and rejects a stale client trading away someone they
             -- already traded away a minute ago.
             --
             -- The season filter belongs here too. Pick ids are unique across
             -- ALL seasons, so without it a client could name a pick id from a
             -- finished draft and move a 2026 player onto a 2027 roster.
             (SELECT count(*) FROM picks p
               WHERE p.id = ANY(i.a_picks) AND p.manager_id = i.a_id
                 AND p.season = i.season) AS a_owned,
             (SELECT count(*) FROM picks p
               WHERE p.id = ANY(i.b_picks) AND p.manager_id = i.b_id
                 AND p.season = i.season) AS b_owned,
             COALESCE((SELECT sum(p.price) FROM picks p
                        WHERE p.id = ANY(i.a_picks) AND p.season = i.season), 0) AS a_salary,
             COALESCE((SELECT sum(p.price) FROM picks p
                        WHERE p.id = ANY(i.b_picks) AND p.season = i.season), 0) AS b_salary
      FROM input i
      JOIN draft d ON d.id = 1
      JOIN manager_totals ta ON ta.id = i.a_id
      JOIN manager_totals tb ON tb.id = i.b_id
    ),
    ok AS (
      SELECT * FROM facts f
      WHERE f.a_id <> f.b_id
        AND f.cash_a >= 0 AND f.cash_b >= 0
        AND (f.a_n + f.b_n + f.cash_a + f.cash_b) > 0
        AND f.a_owned = f.a_n
        AND f.b_owned = f.b_n
        -- neither roster may overflow
        AND (f.a_rostered - f.a_n + f.b_n) <= f.roster_size
        AND (f.b_rostered - f.b_n + f.a_n) <= f.roster_size
        -- and both sides must still hold $1 for every slot left to fill.
        -- Note giving a player away OPENS a slot, so it can fail this even
        -- though no money leaves that manager's side.
        AND (f.a_budget - f.cash_a + f.cash_b) >= (f.roster_size - (f.a_rostered - f.a_n + f.b_n))
        AND (f.b_budget - f.cash_b + f.cash_a) >= (f.roster_size - (f.b_rostered - f.b_n + f.a_n))
    ),
    t AS (
      INSERT INTO trades (season, manager_a_id, manager_b_id, picks_a_to_b, picks_b_to_a,
                          cash_a_to_b, created_by)
      SELECT season, a_id, b_id, a_picks, b_picks, cash_a - cash_b, created_by FROM ok
      RETURNING id
    ),
    -- IN (SELECT unnest(...)), not = ANY((SELECT arr ...)). Postgres reads ANY
    -- of a parenthesised subquery as the *subquery* form and expects a set of
    -- scalars, so handing it an array column fails at runtime with
    -- "operator does not exist: integer = integer[]".
    -- (And no backticks in here: this is inside a tagged template literal.)
    mv_a AS (
      UPDATE picks SET manager_id = (SELECT b_id FROM ok)
      WHERE id IN (SELECT unnest(a_picks) FROM ok) AND EXISTS (SELECT 1 FROM t)
      RETURNING id
    ),
    mv_b AS (
      UPDATE picks SET manager_id = (SELECT a_id FROM ok)
      WHERE id IN (SELECT unnest(b_picks) FROM ok) AND EXISTS (SELECT 1 FROM t)
      RETURNING id
    ),
    -- The compensating pair. Cancels the salary the pick move just dragged
    -- across, and applies the cash. These two amounts always sum to zero.
    adj AS (
      INSERT INTO budget_adjustments (season, manager_id, amount, reason, trade_id)
      SELECT ok.season, ok.a_id, (ok.b_salary - ok.a_salary - ok.cash_a + ok.cash_b),
             'Trade #' || t.id, t.id
      FROM ok, t
      UNION ALL
      SELECT ok.season, ok.b_id, (ok.a_salary - ok.b_salary - ok.cash_b + ok.cash_a),
             'Trade #' || t.id, t.id
      FROM ok, t
      RETURNING id
    ),
    -- A trade changes no pick COUNT, so without this every client sits on a 204
    -- and never sees the board change hands. See src/lib/version.ts.
    bump AS (
      UPDATE draft SET rev = rev + 1 WHERE id = 1 AND EXISTS (SELECT 1 FROM t) RETURNING id
    )
    SELECT id FROM t`

  if (rows.length === 0) {
    // The pre-check passed but the database refused, so something moved
    // underneath us — almost always a player traded or awarded in between.
    return { ok: false, reason: 'One of those players is no longer on that roster — reload and retry' }
  }

  return { ok: true, data: { tradeId: Number(rows[0].id) } }
}

/**
 * Trade history for one season, newest first. Shown in the sidebar, on the
 * board, and in the archive.
 *
 * `season` defaults to whatever the league is drafting now. Pass an explicit
 * year to read a finished season's trades.
 */
export async function listTrades(season?: number, limit = 25): Promise<TradeSummary[]> {
  const sql = getSql()
  const year =
    season ?? Number((await sql`SELECT season FROM draft WHERE id = 1`)[0].season)
  const rows = await sql`
    SELECT t.id, t.created_at, t.manager_a_id, t.manager_b_id, t.cash_a_to_b,
           t.picks_a_to_b, t.picks_b_to_a
    FROM trades t WHERE t.season = ${year} ORDER BY t.id DESC LIMIT ${limit}`
  if (rows.length === 0) return []

  // One extra round trip for every player named in the window, rather than one
  // per trade. Names come from the pick's own snapshot, so an archived trade
  // still reads correctly after the pool has been re-imported.
  const pickIds = rows.flatMap((r) => [...(r.picks_a_to_b ?? []), ...(r.picks_b_to_a ?? [])])
  const detail =
    pickIds.length === 0
      ? []
      : await sql`
          SELECT pk.id, pk.price, pk.player_name AS name, pk.player_position AS position
          FROM picks pk
          WHERE pk.id = ANY(${intArrayLiteral(pickIds)}::int[])`
  const byId = new Map(detail.map((d) => [Number(d.id), d]))

  return rows.map((r) => ({
    id: Number(r.id),
    createdAt: new Date(r.created_at).toISOString(),
    managerAId: Number(r.manager_a_id),
    managerBId: Number(r.manager_b_id),
    cashAToB: Number(r.cash_a_to_b),
    players: [
      ...(r.picks_a_to_b ?? []).map((id: number) => ({ id, to: Number(r.manager_b_id) })),
      ...(r.picks_b_to_a ?? []).map((id: number) => ({ id, to: Number(r.manager_a_id) })),
    ]
      .map(({ id, to }) => {
        const d = byId.get(Number(id))
        return d
          ? {
              pickId: Number(id),
              name: d.name as string,
              position: d.position as string,
              price: Number(d.price),
              toManagerId: to,
            }
          : null
      })
      .filter((p): p is NonNullable<typeof p> => p !== null),
  }))
}
