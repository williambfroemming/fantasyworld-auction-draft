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
  /**
   * The season being drafted right now — the single source of "which year is
   * current". Every per-draft table carries a matching `season`, and starting a
   * new year bumps this instead of deleting last year's rows
   * (`npm run season:new`).
   *
   * ⚠️ Read this column; never hardcode a year in app code. The only place a
   * literal season belongs is the backfill in scripts/migrate-seasons.ts.
   */
  season: integer('season').notNull().default(2026),
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
 * Who sat where, in a given season — the draft order as a permanent record.
 *
 * `managers.draft_slot` is re-drawn and overwritten in place every year, so it
 * only ever describes the current season. Without this table, "who picked where
 * in 2026" is destroyed the moment 2027 is set up.
 *
 * `displayName` and `color` are snapshotted alongside the slot for the same
 * reason the display fields are denormalized onto `picks`: a manager can be
 * renamed, or a seat can change hands between seasons, and an archive that
 * re-renders a past year with today's names is quietly rewriting history.
 */
export const seasonOrders = pgTable(
  'season_orders',
  {
    season: integer('season').notNull(),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    /** 0-indexed seat in that season's snake order. */
    draftSlot: integer('draft_slot').notNull(),
    displayName: text('display_name').notNull(),
    color: text('color').notNull(),
  },
  (t) => [uniqueIndex('season_orders_pk').on(t.season, t.managerId)],
)

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
    /** The season this lot belongs to. Matches `draft.season` when it is opened. */
    season: integer('season').notNull().default(2026),
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
  (t) => [index('lots_status_idx').on(t.status), index('lots_season_idx').on(t.season)],
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
    /**
     * The season whose budget this moves. Miss this filter in `manager_totals`
     * and last year's trade cash silently lands in this year's budgets.
     */
    season: integer('season').notNull().default(2026),
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
  (t) => [
    index('budget_adjustments_manager_idx').on(t.managerId),
    index('budget_adjustments_season_idx').on(t.season),
  ],
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
  /** The season this trade happened in. */
  season: integer('season').notNull().default(2026),
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
    /**
     * Which draft this pick belongs to. Everything that derives a budget MUST
     * filter on it — see the warning on `manager_totals` in
     * src/db/sql/manager_totals.sql.
     */
    season: integer('season').notNull().default(2026),
    /** 1..160 within a season; restarts each year. */
    pickNo: integer('pick_no').notNull(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    /**
     * The player as they were THAT NIGHT, copied in at award time.
     *
     * The pool is re-imported from a fresh CSV every season, so `players` holds
     * this year's truth: a player changes team, changes position, or disappears
     * on retirement. Rendering a 2026 pick by joining to `players` would show
     * their 2028 team and quietly rewrite the archive. These three columns are
     * what a past season renders from — the join is for live drafts only.
     */
    playerName: text('player_name').notNull(),
    playerTeam: text('player_team'),
    playerPosition: text('player_position').notNull(),
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
    // Per SEASON, not globally. A bare unique on player_id would make every
    // player drafted in 2026 permanently undraftable, which is the one thing
    // this is not — the league is not a keeper league.
    uniqueIndex('picks_season_player_idx').on(t.season, t.playerId),
    index('picks_manager_idx').on(t.managerId),
    index('picks_season_idx').on(t.season),
  ],
)

/**
 * A manager's private list of players they are targeting.
 *
 * ## Privacy is the whole feature
 *
 * A queue anyone else can see is worse than no queue — it broadcasts your
 * strategy to the nine people bidding against you. Two hard consequences that
 * constrain every layer above this table:
 *
 *  - **It must never enter `/api/state`.** That payload is league-wide and every
 *    client receives all of it.
 *  - It is read through a session-scoped route that returns **only the caller's
 *    own rows**, keyed off the PIN cookie (`src/server/session.ts`).
 *
 * Stored server-side rather than in `localStorage` on failure-mode grounds:
 * localStorage is private by construction and needs no backend, but it dies when
 * someone switches laptops or clears their browser — and it would fail on draft
 * night, the only night it matters.
 *
 * Season-scoped like everything else, so last year's targets don't reappear.
 */
export const playerQueue = pgTable(
  'player_queue',
  {
    id: serial('id').primaryKey(),
    season: integer('season').notNull(),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    /** Ascending. Ties break on id, so the order is always total. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('player_queue_unique').on(t.season, t.managerId, t.playerId),
    index('player_queue_manager_idx').on(t.season, t.managerId),
  ],
)

export type Manager = typeof managers.$inferSelect
export type Player = typeof players.$inferSelect
export type Draft = typeof draft.$inferSelect
export type Lot = typeof lots.$inferSelect
export type Pick = typeof picks.$inferSelect
export type Trade = typeof trades.$inferSelect
export type BudgetAdjustment = typeof budgetAdjustments.$inferSelect
export type SeasonOrder = typeof seasonOrders.$inferSelect
export type QueueEntry = typeof playerQueue.$inferSelect
