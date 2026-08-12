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
    /** FantasyPros tier. Shown on the board so talent cliffs are visible while bidding. */
    tier: integer('tier'),
    /** Bye week; null for players without one in the source. */
    byeWeek: integer('bye_week'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('players_rank_idx').on(t.searchRank)],
)

/**
 * Single-row table (id is always 1) holding draft settings and status.
 *
 * `rev` is bumped only for settings/pause/order changes. It is one component of
 * the polling fingerprint built in src/lib/version.ts — bid-driven changes are
 * tracked by lots.version instead, so that the bid UPDATE can stay a single
 * atomic statement.
 */
export const draft = pgTable('draft', {
  id: integer('id').primaryKey().default(1),
  status: text('status', { enum: ['setup', 'live', 'paused', 'done'] })
    .notNull()
    .default('setup'),
  /** How many nominations have been completed; drives the snake order. */
  nominationIndex: integer('nomination_index').notNull().default(0),
  timerSeconds: integer('timer_seconds').notNull().default(25),
  softCloseSeconds: integer('soft_close_seconds').notNull().default(10),
  rosterSize: integer('roster_size').notNull().default(16),
  startingBudget: integer('starting_budget').notNull().default(200),
  rev: integer('rev').notNull().default(0),
})

/**
 * One auction lot. There is at most one row with status 'open' at a time.
 *
 * `version` is incremented by the atomic bid UPDATE, which is what lets clients
 * detect a new bid without the server holding any lock or running a second write.
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
    highBid: integer('high_bid').notNull(),
    highBidderId: integer('high_bidder_id')
      .notNull()
      .references(() => managers.id),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Set while the draft is paused; null when running. */
    pausedRemainingMs: integer('paused_remaining_ms'),
    status: text('status', { enum: ['open', 'sold', 'void'] })
      .notNull()
      .default('open'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lots_status_idx').on(t.status)],
)

/** Full bid audit trail. Never read on the hot path — kept for disputes and export. */
export const bids = pgTable(
  'bids',
  {
    id: serial('id').primaryKey(),
    lotId: integer('lot_id')
      .notNull()
      .references(() => lots.id),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bids_lot_idx').on(t.lotId)],
)

/**
 * The result of the draft, and the ONLY source of budget truth.
 *
 * Budget and max bid are derived from these rows on every read and are never
 * stored — storing them is exactly how the old sheet ended up with a manager
 * sitting at -1 dollars.
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
