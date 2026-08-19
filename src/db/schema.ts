import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
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
    /**
     * The one identifier that means the same thing across seasons.
     *
     * `id` is a Sleeper id when synced from Sleeper and a derived slug when
     * imported from a CSV, and the pool is re-imported every year — so `id`
     * does not survive a season boundary and cannot answer "what did this
     * player cost last year". This is resolved at import time by
     * `resolveSleeperIds` and is the key for any cross-year question, and what
     * `npm run news:refresh` joins on to attach injury status.
     *
     * ⚠️ **Nullable, and it will stay nullable.** Name matching between two
     * sources does not reach 100%, and a deliberately unresolved player is the
     * correct outcome when a name is ambiguous. Treat null as "unknown", never
     * as an error, and never make anything on the draft path depend on it.
     */
    sleeperId: text('sleeper_id'),
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

    /**
     * Availability, from the Sleeper dump (docs/BACKLOG.md §1).
     *
     * "Is this guy hurt?" is the question managers were alt-tabbing to Rotowire
     * to answer mid-auction, and it turns out to ride along in the same 5MB file
     * the pool already comes from — so it costs **no runtime dependency**. That
     * is the whole reason it lives in a column rather than behind a fetch: on
     * draft night this is already in the database, and no provider being down
     * can take it away.
     *
     * A live headline feed was built alongside this and then **deliberately
     * removed** — see docs/BACKLOG.md §1. These columns are the part that
     * earned its place, because they are small, factual, and attached to a
     * price you are about to pay.
     *
     * ⚠️ A **snapshot**, not a feed. It is as fresh as the last import or
     * `npm run news:refresh`, and `injuryUpdatedAt` is what lets the UI say "as
     * of Thursday" instead of implying it is live. Null status means *unknown*,
     * never healthy — a CSV-seeded pool has none of this, and rendering absence
     * as fitness would be a confident wrong answer about the one thing being
     * asked.
     */
    injuryStatus: text('injury_status'),
    injuryBodyPart: text('injury_body_part'),
    injuryNotes: text('injury_notes'),
    /** DNP · Limited Participation · Full Participation. */
    practiceParticipation: text('practice_participation'),
    /** When this row's injury picture was last refreshed from Sleeper. */
    injuryUpdatedAt: timestamp('injury_updated_at', { withTimezone: true }),
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
    /**
     * The `draft.nomination_index` this lot was opened at — the seat that
     * actually nominated, recorded so undo can hand the turn back to them.
     *
     * Nomination advances the index to *the seat it landed on* plus one, which
     * can be several indices when full rosters were skipped. `- 1` therefore
     * lands mid-skip-run rather than on the nominator; this column is the only
     * way to rewind exactly. See docs/BACKLOG.md §9 P2.
     *
     * Nullable because lots opened before this column existed have no answer.
     * Void/undo fall back to `- 1` for those, which is the old behaviour.
     */
    nominationIndex: integer('nomination_index'),
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
     * their 2028 team and quietly rewrite the archive. These columns are
     * what a past season renders from — the join is for live drafts only.
     */
    playerName: text('player_name').notNull(),
    playerTeam: text('player_team'),
    playerPosition: text('player_position').notNull(),
    /**
     * Where this player sat in the pool THAT NIGHT. Same snapshot argument as
     * the three columns above, and the reason the /stats "bargains and overpays"
     * view can score a finished season at all: rank is otherwise recoverable
     * only by joining `players`, which stops being true the moment next
     * season's rankings CSV is imported.
     *
     * NULLABLE, unlike name and position. A rank can legitimately be absent (a
     * Sleeper-seeded pool leaves plenty unranked), and a season drafted before
     * this column existed can never recover one. Consumers must treat null as
     * "not scored" — never as rank 0, which would read as the best player alive.
     */
    playerRank: integer('player_rank'),
    playerPosRank: integer('player_pos_rank'),
    /**
     * The player's cross-season identity, snapshotted here for the same reason
     * as everything above: `players.sleeper_id` is re-derived every import, and
     * `picks.player_id` is a slug that dies with the pool it came from.
     *
     * This is the column that makes "what did this player cost in 2026 vs 2027"
     * answerable at all — it is the only value on a pick that will still mean
     * the same thing in three years' time.
     *
     * Nullable, and often null for 2026: see `scripts/migrate-player-identity.ts`.
     */
    playerSleeperId: text('player_sleeper_id'),
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

// ---------------------------------------------------------------------------
// League history (Phase 2) — see docs/PROJECT_PLAN.md §12
//
// Everything below is READ-ONLY after import and is not reachable from any
// draft path. Nothing here is polled, nothing enters `/api/state`, and no
// budget is derived from it. `manager_totals` is `CROSS JOIN draft` filtered to
// the current season, so none of these rows can reach a live budget.
//
// ⚠️ **Neon returns `numeric` as a string.** `'124.20' + '110.00'` is
// `'124.20110.00'` — a sum that renders, sorts, and is wrong. Every points
// column below must go through `Number()` at the service boundary, the way the
// existing code does with `Number(r.price)`. `numeric` is used rather than a
// float because Postgres then sums points-for exactly: a season total built
// from 140 doubles lands on 1497.9999999999998, and this data's whole job is to
// be quoted back at people who know the real number.
// ---------------------------------------------------------------------------

/**
 * One row per league year, from the first record (2006) to the current season.
 *
 * Three facts that previously had no home share this grain exactly: where the
 * draft was held, who finished on the podium and what they won, and the settings
 * a finished season was played under. That last one is a live bug fix —
 * `getArchivedSeason()` reads roster size and starting budget from
 * `draft WHERE id = 1`, so every archived year currently renders with *today's*
 * settings.
 *
 * `dataTier` is the column that makes the two-era rule **structural** rather
 * than a UI convention. Metrics needing week-level data (all-play, lineup
 * efficiency, high/low scorer weeks, every score record) exist only from 2020;
 * standings-level metrics reach back to 2011; 2006–2010 is a champion's name
 * and nothing else. The workbook mixes these silently and contradicts itself as
 * a result — its hidden records sheet claims an all-time high of 203.9 while its
 * dashboard says 234.96, and both are "right" for the era each was computed over.
 */
export const seasons = pgTable('seasons', {
  season: integer('season').primaryKey(),
  /** 'legacy' (2006–2010) · 'standings' (2011–2019) · 'weekly' (2020+). */
  dataTier: text('data_tier', { enum: ['legacy', 'standings', 'weekly'] }).notNull(),
  /**
   * ⚠️ Pinned, never resolved by name. The account holds an unrelated 18-team
   * Guillotine League in 2024/2025 and the real 2025 league is misnamed with
   * 2024's name, so a name match imports a different league entirely and every
   * downstream number looks plausible. See `SLEEPER_LEAGUE_IDS`.
   */
  sleeperLeagueId: text('sleeper_league_id'),
  /** Null where unknown — pre-Sleeper years have no settings on record. */
  rosterSize: integer('roster_size'),
  startingBudget: integer('starting_budget'),
  /** 13 through 2020, 14 from 2021. Never assume it is constant. */
  regularSeasonWeeks: integer('regular_season_weeks'),
  playoffWeekStart: integer('playoff_week_start'),
  playoffTeams: integer('playoff_teams'),
  /**
   * The season is over and its record is complete. Read instead of inferring
   * completeness from roster counts: `draftComplete()` tests that every manager
   * is full, which calls 2022 unfinished forever because one pick is missing
   * from the record and cannot be recovered.
   */
  isFinal: boolean('is_final').notNull().default(false),
  draftCity: text('draft_city'),
  draftState: text('draft_state'),
  draftCountry: text('draft_country'),
  /**
   * The podium.
   *
   * For 2020+ this is read from Sleeper's `winners_bracket`, which tags the
   * championship game `p: 1` and the third-place game `p: 3`. That derivation was
   * checked against the workbook's own `win_history` for all five overlapping
   * seasons and matched on every one of the fifteen placings.
   *
   * Third place **is** played, contrary to an earlier reading of the data. The
   * bracket holds seven games, not five: two quarter-finals, two semi-finals, a
   * fifth-place game, the final, and a third-place game. The workbook recorded
   * only five of them — it dropped the fifth- and third-place games from
   * `playoff_matchup_data` while still recording a third-place finisher in
   * `win_history`, which is what made it look unplayed.
   *
   * Pre-2020 it is transcribed from `win_history`, because nothing finer exists.
   */
  championManagerId: integer('champion_manager_id').references(() => managers.id),
  runnerUpManagerId: integer('runner_up_manager_id').references(() => managers.id),
  thirdManagerId: integer('third_manager_id').references(() => managers.id),
  /**
   * ⚠️ Null is *unknown*, not zero. Prize money is a real $0 for 2011–2013 and
   * genuinely unknown for 2006–2010, where the source records a literal "-".
   * Collapsing those makes a "Bag Secured" total quietly authoritative about
   * five years it knows nothing about.
   */
  championPrize: integer('champion_prize'),
  runnerUpPrize: integer('runner_up_prize'),
  thirdPrize: integer('third_prize'),
  /** Anything a reader of this season needs told. Rendered in the archive. */
  notes: text('notes').array().notNull().default([]),
})

/**
 * One row per manager per season — the only grain that exists for 2011–2019,
 * and therefore the entire factual base of the "All-Time" era.
 *
 * `playoffs_legacy` in the workbook is this same grain, so it folds in here
 * rather than becoming a second table that every query would have to LEFT JOIN.
 */
export const seasonStandings = pgTable(
  'season_standings',
  {
    season: integer('season')
      .notNull()
      .references(() => seasons.season),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    place: integer('place'),
    wins: integer('wins').notNull(),
    losses: integer('losses').notNull(),
    ties: integer('ties').notNull().default(0),
    /**
     * Sleeper's own published season total, not a re-sum of the weekly rows.
     *
     * Those two disagree slightly for eight rosters across 2020-21 — a stat
     * correction that reached the weekly rows and not the stored total. The
     * league's decision is to take the platform's figure, which is also what the
     * history workbook's standings sheet recorded, so the archive agrees with
     * both. Checked: 49 of 50 overlapping member-seasons match the workbook to
     * the cent, and the one that does not (Brian, 2023) is a workbook error —
     * Sleeper's season total and its weekly rows both say 1976.62 there.
     *
     * ⚠️ Summing `season_matchups.points` will therefore not always equal this.
     * That is the source's inconsistency, not a defect here; anything showing
     * both must say which one it is showing.
     */
    pointsFor: numeric('points_for', { precision: 8, scale: 2 }),
    pointsAgainst: numeric('points_against', { precision: 8, scale: 2 }),
    madePlayoffs: boolean('made_playoffs').notNull().default(false),
    playoffWins: integer('playoff_wins'),
    playoffLosses: integer('playoff_losses'),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.managerId] }),
    index('season_standings_manager_idx').on(t.managerId),
  ],
)

/**
 * One row per **game side** — two rows per game, one from each manager's view.
 *
 * The redundancy is deliberate and cheap (~1,700 rows). Every consumer wants
 * "for each manager, for each week": all-play, streaks, high/low scorer weeks,
 * per-manager points, consistency, and the head-to-head grid. Storing one row
 * per game would put a `UNION ALL` in every one of them.
 *
 * Regular season and playoffs share the table because records span both — "the
 * all-time high score" is not a regular-season question — and splitting them
 * would mean a UNION in every record query instead.
 *
 * `marginOfVictory` is NOT stored: it is `points - opponentPoints`, and this
 * codebase does not store what it can derive.
 */
export const seasonMatchups = pgTable(
  'season_matchups',
  {
    season: integer('season')
      .notNull()
      .references(() => seasons.season),
    week: integer('week').notNull(),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    /** Sleeper's per-week pairing key. Two rows sharing one are one game. */
    matchupId: integer('matchup_id'),
    points: numeric('points', { precision: 8, scale: 2 }).notNull(),
    opponentManagerId: integer('opponent_manager_id')
      .notNull()
      .references(() => managers.id),
    opponentPoints: numeric('opponent_points', { precision: 8, scale: 2 }).notNull(),
    isPlayoff: boolean('is_playoff').notNull().default(false),
    playoffRound: integer('playoff_round'),
    /**
     * Which finishing place a playoff game decided, when it decided one.
     *
     * **Null means the championship path** — a quarter-final, a semi-final, or
     * the final itself. Otherwise it is the place being contested: `3` for the
     * third-place game, `5` for the fifth-place game.
     *
     * The distinction exists because the league does not treat these as equal.
     * Third place pays, so that game counts. Nobody tries in the fifth-place
     * game, so counting its scores toward "all-time high score" or a playoff
     * record would put results from a game people were not playing seriously
     * alongside ones they were. Stats default to `playoff_placement IS NULL OR
     * playoff_placement <= 3`; the rows are all here for anyone who wants them.
     */
    playoffPlacement: integer('playoff_placement'),
    /** Stored, not derived: a scoring rule, in a league that could tie. */
    result: text('result', { enum: ['W', 'L', 'T'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.week, t.managerId] }),
    index('season_matchups_manager_idx').on(t.managerId),
    index('season_matchups_season_idx').on(t.season),
  ],
)

/**
 * What a manager scored against the best they could have scored, per week.
 *
 * **Kept separate from `season_matchups` despite the identical grain.** In the
 * workbook these two numbers lived on different scales and disagreed by an
 * average of 6.4 points, and putting `actualPoints` on the same row as `points`
 * would create two columns that both look like "what they scored". Sourcing both
 * from Sleeper fixes the scale, but the separation is still right: a join is a
 * cheap price for never letting those two numbers touch by accident.
 *
 * `pointsLeftOnBench` and the efficiency percentage are arithmetic, so neither
 * is stored.
 */
export const seasonLineups = pgTable(
  'season_lineups',
  {
    season: integer('season')
      .notNull()
      .references(() => seasons.season),
    week: integer('week').notNull(),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    actualPoints: numeric('actual_points', { precision: 8, scale: 2 }).notNull(),
    /**
     * The best legal lineup available from that week's roster, computed against
     * **that season's** `roster_positions`. 2020–2021 start 9 with one FLEX;
     * 2022+ start 10 and add SUPER_FLEX, which makes a QB flex-eligible. A
     * calculation that assumes one shape is wrong for the other era.
     */
    optimalPoints: numeric('optimal_points', { precision: 8, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.season, t.week, t.managerId] })],
)

/**
 * Every rostered player's points, per week, per manager.
 *
 * Sourced from Sleeper's `players_points`, so unlike the workbook's version this
 * **is** summable to a team score. It is also a prerequisite rather than a
 * nice-to-have: computing an optimal lineup needs every rostered player's points
 * for that week, not just the ones who started.
 *
 * `playerId` is a Sleeper id — the one player key that survives a season.
 */
export const playerWeeks = pgTable(
  'player_weeks',
  {
    season: integer('season')
      .notNull()
      .references(() => seasons.season),
    week: integer('week').notNull(),
    managerId: integer('manager_id')
      .notNull()
      .references(() => managers.id),
    playerId: text('player_id').notNull(),
    playerName: text('player_name'),
    position: text('position'),
    nflTeam: text('nfl_team'),
    isStarter: boolean('is_starter').notNull().default(false),
    /** The lineup slot they filled, when they started. Null on the bench. */
    slot: text('slot'),
    points: numeric('points', { precision: 8, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.week, t.managerId, t.playerId] }),
    index('player_weeks_player_idx').on(t.playerId),
    index('player_weeks_season_idx').on(t.season),
  ],
)

/**
 * A player's season line, league-wide — not per manager.
 *
 * Two jobs: scoring the draft-steal metric (points per dollar), and joining a
 * 2021–2024 auction pick to a Sleeper id. That second job is why the workbook's
 * copy of this sheet is still imported at all; the join hits 640/640.
 *
 * `position` is unconstrained text on purpose. This legitimately contains CB, LB
 * and P — pre-filtering to fantasy positions would hide the two same-named
 * players (a QB and a CB both called Lamar Jackson) that the matcher needs to
 * see in order to refuse to guess.
 */
export const playerSeasons = pgTable(
  'player_seasons',
  {
    season: integer('season')
      .notNull()
      .references(() => seasons.season),
    /** Sleeper player id, or a team code for a defense. */
    playerId: text('player_id').notNull(),
    playerName: text('player_name').notNull(),
    position: text('position'),
    nflTeam: text('nfl_team'),
    weeksPlayed: integer('weeks_played'),
    totalPoints: numeric('total_points', { precision: 8, scale: 2 }),
    avgPoints: numeric('avg_points', { precision: 6, scale: 2 }),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.playerId] }),
    index('player_seasons_name_idx').on(t.playerName),
  ],
)

/**
 * Champions from 2006–2010: a name, and nothing else.
 *
 * Deliberately NOT linked to `managers`. These five years predate the league's
 * membership record, and while the names are all recognisable today, asserting
 * that the 2006 "Daniel" is the same person as today's Daniel is a guess dressed
 * as a fact. The money is likewise unknown rather than zero — the source records
 * a literal "-", which is not the real $0 recorded for 2011–2013.
 */
export const legacyChampions = pgTable('legacy_champions', {
  season: integer('season').primaryKey(),
  championName: text('champion_name').notNull(),
  moneyWon: integer('money_won'),
})

export type Manager = typeof managers.$inferSelect
export type Player = typeof players.$inferSelect
export type Draft = typeof draft.$inferSelect
export type Lot = typeof lots.$inferSelect
export type Pick = typeof picks.$inferSelect
export type Trade = typeof trades.$inferSelect
export type BudgetAdjustment = typeof budgetAdjustments.$inferSelect
export type SeasonOrder = typeof seasonOrders.$inferSelect
export type QueueEntry = typeof playerQueue.$inferSelect

export type Season = typeof seasons.$inferSelect
export type SeasonStanding = typeof seasonStandings.$inferSelect
export type SeasonMatchup = typeof seasonMatchups.$inferSelect
export type SeasonLineup = typeof seasonLineups.$inferSelect
export type PlayerWeek = typeof playerWeeks.$inferSelect
export type PlayerSeason = typeof playerSeasons.$inferSelect
export type LegacyChampion = typeof legacyChampions.$inferSelect
