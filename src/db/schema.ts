import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * The 10 league managers.
 *
 * `name` is canonical and drives the draft order and logs. `displayName` is what
 * shows on the board — the old sheet called one manager "Grossman" in the order
 * tab and "Eric/Blakey" in the roster grid, and the board is unreadable if it
 * shows names nobody in the room actually uses.
 */
export const managers = pgTable(
  'managers',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    /** Tailwind-ish hex used for this manager's column on the League board. */
    color: text('color').notNull().default('#64748b'),
    /** scrypt hash; null until the manager claims their seat and sets a PIN. */
    pinHash: text('pin_hash'),
    /** 0-indexed seat in the snake order. Re-drawn every season at setup. */
    draftSlot: integer('draft_slot').notNull(),
    isCommish: boolean('is_commish').notNull().default(false),
  },
  (t) => [uniqueIndex('managers_name_idx').on(t.name)],
)

/**
 * Player pool. Seeded from a FantasyPros rankings CSV (preferred) or Sleeper.
 *
 * `id` is the Sleeper player_id when synced from Sleeper, or a derived slug for
 * CSV imports.
 */
export const players = pgTable(
  'players',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    team: text('team'),
    position: text('position').notNull(),
    /**
     * Overall draft rank — the board's sort order.
     * From FantasyPros RK when imported; from Sleeper's search_rank otherwise,
     * which is a much weaker signal (see docs/PROJECT_PLAN.md §9).
     */
    searchRank: integer('search_rank'),
    /** Positional rank parsed out of FantasyPros' "WR12" style POS column. */
    posRank: integer('pos_rank'),
    /** Bye week; null for players without one in the source. */
    byeWeek: integer('bye_week'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('players_rank_idx').on(t.searchRank)],
)

/**
 * Single-row table (id is always 1) holding draft settings and status.
 *
 * `rev` is bumped for settings/pause/order/trade changes. It is one component
 * of the polling fingerprint built in src/lib/version.ts, alongside the open
 * lot's id and the pick count.
 *
 * There are deliberately no timer columns. The auction is called aloud in the
 * room; the app records the result. See docs/PROJECT_PLAN.md §3.
 */
export const draft = pgTable('draft', {
  id: integer('id').primaryKey().default(1),
  status: text('status', { enum: ['setup', 'live', 'paused', 'done'] })
    .notNull()
    .default('setup'),
  /** How many nominations have been completed; drives the snake order. */
  nominationIndex: integer('nomination_index').notNull().default(0),
  rosterSize: integer('roster_size').notNull().default(16),
  startingBudget: integer('starting_budget').notNull().default(200),
  rev: integer('rev').notNull().default(0),
})

/**
 * One auction lot — a player put on the block and, once the room has finished
 * bidding, the price and winner the nominator typed in.
 *
 * There is at most one row with status 'open' at a time, and an open lot has no
 * deadline: it stays up until somebody awards it. `soldPrice` and `winnerId`
 * are null until then, which is what makes "on the block" and "sold" distinct
 * states rather than a guess based on a clock.
 */
export const lots = pgTable(
  'lots',
  {
    id: serial('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    nominatorId: integer('nominator_id')
      .notNull()
      .references(() => managers.id),
    /** Null while open; the hammer price once awarded. */
    soldPrice: integer('sold_price'),
    /** Null while open; the winning manager once awarded. */
    winnerId: integer('winner_id').references(() => managers.id),
    status: text('status', { enum: ['open', 'sold', 'void'] })
      .notNull()
      .default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lots_status_idx').on(t.status)],
)

/**
 * Every dollar that moves without a player being bought.
 *
 * Budget stays derived — this table holds signed *deltas* with provenance, not
 * a stored balance, so `manager_totals` remains the only place a budget is ever
 * computed. Two things write here:
 *
 *  - a trade's cash side, and
 *  - a trade's player side. The league's rule is that a traded player's salary
 *    stays charged to whoever bought them at auction, but moving `picks.manager_id`
 *    would otherwise move that charge too — so each traded player books an equal
 *    and opposite pair of adjustments that cancels it out.
 *
 * Every trade therefore writes adjustments summing to exactly zero across the
 * league. `npm run db:verify` asserts that.
 */
export const budgetAdjustments = pgTable(
  'budget_adjustments',
  {
    id: serial('id').primaryKey(),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    /** Signed. Positive gives this manager money, negative takes it away. */
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    /** Null for a standalone commissioner correction. */
    tradeId: integer('trade_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('budget_adjustments_manager_idx').on(t.managerId)],
)

/**
 * A completed trade between two managers. Written by one atomic statement that
 * also moves the picks and books the adjustments — see src/server/trade-service.ts.
 *
 * The pick id arrays are the record of what moved. They are a log, not the
 * source of truth: current ownership always lives in `picks.manager_id`.
 */
export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  managerAId: integer('manager_a_id')
    .notNull()
    .references(() => managers.id),
  managerBId: integer('manager_b_id')
    .notNull()
    .references(() => managers.id),
  picksAToB: integer('picks_a_to_b').array().notNull().default([]),
  picksBToA: integer('picks_b_to_a').array().notNull().default([]),
  /** Signed net cash. Positive = A pays B, negative = B pays A. */
  cashAToB: integer('cash_a_to_b').notNull().default(0),
  createdBy: integer('created_by')
    .notNull()
    .references(() => managers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * The result of the draft, and — with `budget_adjustments` — the ONLY source of
 * budget truth.
 *
 * Budget and max bid are derived from these rows on every read and are never
 * stored: storing them is exactly how the old sheet ended up with a manager
 * sitting at -1 dollars.
 *
 * `managerId` is CURRENT ownership, not who bought the player. A trade moves it.
 * `nominatorId` and the trade log are what preserve the auction's history, and
 * a traded player's salary is held in place by the paired rows in
 * `budget_adjustments` rather than by freezing this column.
 */
export const picks = pgTable(
  'picks',
  {
    id: serial('id').primaryKey(),
    pickNo: integer('pick_no').notNull(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    nominatorId: integer('nominator_id')
      .notNull()
      .references(() => managers.id),
    price: integer('price').notNull(),
    /**
     * Display-only override for the League board grid row. Null means "auto-slot me".
     * MUST NOT be consulted by any bidding logic — slotting can never block a bid.
     */
    slotOverride: text('slot_override'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('picks_player_idx').on(t.playerId),
    index('picks_manager_idx').on(t.managerId),
  ],
)

export type Manager = typeof managers.$inferSelect
export type Player = typeof players.$inferSelect
export type Draft = typeof draft.$inferSelect
export type Lot = typeof lots.$inferSelect
export type Pick = typeof picks.$inferSelect
export type Trade = typeof trades.$inferSelect
export type BudgetAdjustment = typeof budgetAdjustments.$inferSelect
