# Fantasy Auction Draft — Project Plan

> **Read this first if you are a new session/agent.** This is the durable spec.
> Then read `PROGRESS_LOG.md` for what's been learned so far, and `UAT.md` for acceptance.

**Deadline: the live draft is Friday 2026-08-14.** Ten managers, in a room, bidding for real.

---

## 1. Context

The league runs its auction out of a Google Sheet ([2025 Fantasy Draft](https://docs.google.com/spreadsheets/d/1bJo99wz0DPVWO2mmVdpCtWp_QpFqsDnFe_Jdz24sCgE/edit)). Someone maintains a draft board; each manager nominates in turn; bidding is verbal with the nominator counting down from 10; then a human types the winning price into the pick log, the roster grid, *and* the budget table.

Three hand-writes per pick is where it breaks. The sheet already shows the damage: a manager sitting at **−1 budget**, a DEFENSE slot holding a running back, players logged with no price at all.

This app keeps **one authoritative copy** of the draft. It does not need to be pretty. It needs to be correct, available to 10 people at once, and impossible to desync.

### What we learned reading the sheet

- **Nomination order is a snake.** Picks 1–10 run Gabes→Justin, 11–20 reverse, 21–30 forward. Not a straight repeat.
- **The roster is 16 slots, not 15.** QB, RB, RB, WR, WR, WR, TE, FLEX, SUPERFLEX, DEF + 6 BENCH. The brief's "2 QB" is QB + SUPERFLEX.
- This confirms the max-bid formula: `200 − 15 = $185` at the start. ✔
- The sheet's player pool is **2025**. It's Aug 2026 — pool comes fresh from Sleeper.
- One manager appears as **Grossman** in the order tab and **Eric/Blakey** in the roster grid. Display names ≠ canonical names.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| Player pool | Sleeper API sync (league's app of choice), CSV import as override/fallback |
| Identity | Shared link → pick your name from the 10 → 4-digit PIN on first use |
| Auction | **Called aloud in the room.** The app records the result, it does not run the bidding |
| Nomination | Nominator puts a player on the block. No opening bid — the price is entered once, at the end |
| Recording a sale | The nominator (or commissioner) types the hammer price and taps the winner |
| Roster rules | Hard cap 16, **no position enforcement**; position counts shown as info only |
| Clocks | **None anywhere.** No nomination timer, no bid timer, no countdown, no clock sync |
| Trades | Players and auction dollars, either direction, executed by any manager. Salary stays with the drafter |
| Draft order | Set per-season at setup — drag to reorder, or randomize in-app |
| Realtime | Polling, not websockets (see §4) |

---

## 3. Rules of the auction

```
budget   = 200 − SUM(picks.price)
rostered = COUNT(picks)
maxBid   = budget − (rosterSize − rostered − 1)      // 200 − 15 = 185 at start
```

- **Budget and max bid are derived, never stored.** Storing them is exactly how the sheet reached −1.
- **Invariant:** max bid reserves $1 per unfilled slot, so a manager's budget can never drop below their remaining slot count. Nobody can be stranded unable to fill a roster. This is the bug the sheet's −1 represents.
- A manager at 16 players cannot be sold anyone and is skipped in the nomination order.

### Why there is no clock

The league already had a working auction: someone calls a player, everyone shouts numbers,
the nominator counts down from ten. That part was never broken. What was broken was the
*bookkeeping* — three hand-writes per pick, into three places, one of which reached −1.

An in-app timer replaces a thing that works with a thing that can go wrong: a phone that
sleeps, a laptop clock eight minutes fast, a bidding war lost to 400ms of wifi. Every one
of those is a way for the app to cost somebody a player, and none of them existed in the
old process. So the clock came out, and with it the soft close, lazy settlement, the
skew-corrected countdown, and the entire live-bidding path.

**The app now enforces exactly one thing: that a recorded result is legal.** That is the
one thing the sheet could not do.

### Trades

A trade moves players and/or auction dollars between two managers.

- **Salary stays with whoever bought the player at auction.** Receiving a $50 player costs
  nothing; giving one away refunds nothing. Only the agreed cash moves money.
- Both sides are re-validated against the reserve invariant *after* the trade. Note that
  **giving a player away opens a roster spot**, which then needs $1 behind it — so a broke
  manager can be blocked from trading a player out even though no money leaves their side.
- A refused trade writes nothing at all.

---

## 4. Architecture

**Next.js 16 App Router + TypeScript, Tailwind + shadcn/ui, Neon Postgres (Drizzle), deployed on Vercel.** No websockets, no pub/sub, no cron.

### Polling
Clients `GET /api/state?v=<version>` every 400ms; `204` when unchanged. 10 clients ≈ 25 req/s — trivial.

Nothing on screen depends on the client's clock, so there is no clock sync and no `serverNow`.
400ms of staleness cannot cost anyone anything: the price is agreed out loud and then typed
in once.

> ⚠️ `/api/state` **must** stay `export const dynamic = 'force-dynamic'` with
> `Cache-Control: no-store`. It no longer has side effects, but a cached `204` strands every
> client on a board that has moved on, and it presents as a UI bug rather than a caching one.

### Recording a sale is one atomic statement
```sql
WITH sold AS (
  UPDATE lots SET status='sold', sold_price=$price, winner_id=$winner
  WHERE id = $lot AND status = 'open'
    AND $price <= (SELECT max_bid FROM manager_totals WHERE id = $winner)
    AND NOT EXISTS (SELECT 1 FROM picks WHERE player_id = lots.player_id)
  RETURNING player_id, nominator_id
)
INSERT INTO picks (pick_no, player_id, manager_id, nominator_id, price)
SELECT (SELECT COALESCE(MAX(pick_no),0) FROM picks) + 1,
       sold.player_id, $winner, sold.nominator_id, $price
FROM sold
ON CONFLICT (player_id) DO NOTHING
RETURNING pick_no;
```
Zero rows = refused (over max, roster full, already sold). The lot update and the pick insert
are one statement, so there is no window in which a lot reads 'sold' with no pick behind it —
i.e. a manager who won a player and does not have them.

> ⚠️ **Do not "fix" this into `SELECT … FOR UPDATE`.** Neon's HTTP driver (`drizzle-orm/neon-http`) does **not** support interactive transactions — that would fail at runtime and force `Pool`-over-WebSockets with connection-lifecycle management in serverless. The single-statement form is deliberate.

### Trades are one atomic statement too

`src/server/trade-service.ts` moves both sets of picks, books both budget adjustments, and
bumps `draft.rev` in a single statement built from data-modifying CTEs. Every check lives in
one `ok` CTE; when it is empty, every downstream CTE writes nothing.

A half-applied trade — players moved, compensating adjustments missing — would silently
charge the wrong manager for the rest of the draft. That is the exact class of bug this app
exists to remove, so it is made structurally impossible rather than carefully avoided.

`manager_totals` is a SQL **view** deriving budget/rostered/max_bid from `picks` *and*
`budget_adjustments`, so max bid is enforced *inside the database* and cannot be bypassed by
a bad client.

> ⚠️ The view's aggregates are scalar subqueries inside a `LATERAL`, **not joins**. The
> original `LEFT JOIN picks … GROUP BY` was correct for one table and silently wrong for two:
> joining `budget_adjustments` as well would multiply every pick by that manager's adjustment
> count and inflate every budget.

---

## 5. Data model — `src/db/schema.ts`

| Table | Columns |
|---|---|
| `managers` | `id, name, displayName, color, pinHash, draftSlot, isCommish` |
| `players` | `id (sleeper_id), name, team, position, searchRank, active` |
| `draft` | single row: `season, status ('setup'\|'live'\|'paused'\|'done'), nominationIndex, rosterSize=16, startingBudget=200, rev` |
| `lots` | `id, season, playerId, nominatorId, soldPrice, winnerId, status ('open'\|'sold'\|'void'), createdAt` — price/winner null until awarded |
| `picks` | `id, season, pickNo, playerId, playerName, playerTeam, playerPosition, managerId, nominatorId, price, slotOverride, createdAt` |
| `trades` | `id, season, managerAId, managerBId, picksAToB[], picksBToA[], cashAToB (signed), createdBy, createdAt` |
| `budget_adjustments` | `id, season, managerId, amount (signed), reason, tradeId, createdAt` |
| `season_orders` | `season, managerId, draftSlot, displayName, color` — the seating, frozen per year |
| `player_queue` | `id, season, managerId, playerId, sortOrder, createdAt` — **private** per-manager shortlist |

`picks` also snapshots `playerRank` / `playerPosRank` at award time, nullable. Rank is otherwise
recoverable only by joining `players`, and that join dies the moment the next season's rankings CSV
replaces the pool — so a finished season could never be scored again. Same argument as the
name/team/position snapshot.
| view `manager_totals` | `id, budget, rostered, max_bid` derived from `picks` + `budget_adjustments`, **filtered to `draft.season`** |

### Seasons

Every draft the league runs is kept. `draft.season` says which year is current;
the per-draft tables carry a matching `season`, and starting a new year
(`npm run season:new -- 2027`) bumps that column instead of deleting anything.
Past rows simply stop matching the current-season filter and appear in the
read-only archive at `/board` instead.

> ⚠️ **Every query against `picks` or `lots` must filter on the season.** For
> budgets that filter lives in `manager_totals`, so there is one place to get
> right — miss it and each manager begins the new year carrying their entire
> previous spend, silently, because budgets are derived. Miss it in the pool
> exclusion and last year's players stay undraftable, which turns a redraft
> league into a keeper league. `picks` is `UNIQUE (season, player_id)`, never
> `UNIQUE (player_id)`.

> ⚠️ **`picks` stores its own `playerName` / `playerTeam` / `playerPosition`.**
> The pool is re-imported every season, so a 2026 pick rendered by joining to
> `players` would show a 2028 team. The live draft may join; the archive reads
> only the snapshot. See `src/server/archive-service.ts`.

`picks.managerId` is **current ownership** — a trade moves it. The auction history is preserved
by `nominatorId` and the trade log, and a traded player's salary is pinned in place by the
paired `budget_adjustments` rows rather than by freezing the column.

`slotOverride` is nullable and **display-only** — null means auto-slot, a value means the manager dragged the player into a specific grid row. It never affects bidding.

---

## 6. Core logic — `src/lib/draft.ts` (pure, DB-free, unit-tested)

- `maxBidFor(budget, rostered, rosterSize)`
- `snakeOrder(managers, nominationIndex)` — round `r`, position `i`: slot `i` when `r` even, `N−1−i` when odd. Reads `draftSlot` (per-season data). Skips full managers.
- `nominatorAt(managers, index, rosterSize)` — **no index cap.** Returns null only when *every* manager is at `rosterSize`; otherwise scans forward over a `2n` window (never `n` — a window of `n` straddling a snake turn can miss a seat). The old `n * rosterSize + n` bound is what stalled the 2026 draft with 32 picks still to make: `nominationIndex` is not a pick counter, because every skipped seat consumes one too. Called a second time at `index + 1` to get **on deck** — never a second copy of the snake maths.
- `randomOrder(managers)` — Fisher–Yates.
- `validateAward({ price, winnerMaxBid, winnerRostered, … })`
- `validateTrade({ rosterSize, a, b })` — both sides re-checked against the reserve invariant
- `slotRows(extraBench)` / `extraBenchRows(laid)` / `pickInRow(laid, i)` — the board's rows. **Grows extra BENCH rows so no drafted player is ever undrawn**: a manager who skips the DEFENSE slot has a 16th player with nowhere to sit, and `autoSlot`'s `overflow` used to be silently ignored by the callers
- `positionMarket(picks, pool?)` — count / median / mean / range / remaining per position, **QB, RB, WR, TE only**. Groups on the player's real position, never their display slot
- `autoSlot(picks)` → `Record<SlotRow, Pick|null>` — greedy best fit: `slotOverride` first, then natural position, then FLEX (RB/WR/TE), then SUPERFLEX (QB/RB/WR/TE), then bench. **Display-only; deliberately unreachable from any bid path** so it can never become a restriction by accident.

## 7. API

| Route | Behaviour |
|---|---|
| `POST /api/nominate` | `{ playerId }` — asserts caller's turn, opens a lot with no price and no deadline |
| `POST /api/award` | `{ lotId, winnerId, price }` — the atomic statement above; nominator or commish only |
| `POST /api/trade` | `{ aId, bId, picksAToB[], picksBToA[], cashAToB, cashBToA }` — any signed-in manager |
| `GET /api/state?v=` | returns `{ version, draft, lot, managers[], recentPicks }`, `204` if unchanged |
| `GET /api/board` | heavy payload (pool + all rosters + trade log) for the **current** season, fetched only when `version` changes |
| `GET /api/archive` | the season list for the year picker |
| `GET /api/archive?season=` | one finished season, read-only. Its own route so browsing 2026 during the 2027 draft never touches the hot path |
| `GET /api/export?season=` | pick log as CSV; defaults to the current season |
| `GET/POST /api/queue` | the caller's **own** player queue. Manager id comes from the session cookie — there is deliberately no id field to send |

`/stats` needs **no route of its own**: all four views are pure functions of what `/api/board` and
`/api/archive` already ship.

---

## 8. Screens

1. **`/` Join** — pick name, set/enter PIN, signed httpOnly cookie.
2. **`/draft`** — center: the player on the block, and for the nominator a price field plus a grid of the ten managers. **Type the price first and everyone who cannot afford it greys out**, so an illegal price is refused while the room is still listening. Left: searchable/filterable pool, drafted players vanish, Nominate live only on your turn. Right: tabs **My Roster / Budgets / Picks**. Bottom: recent-picks ticker. Audio: gavel on sold, nudge on your turn.
3. **League board** (`/board`) — 16 slot rows × 10 manager columns, one color each, headers pinned. Auto-slotted for display; drag your own to override; empty slots greyed; winner's column flashes on sale. Mobile: horizontal scroll with pinned labels + single-manager picker. **A year picker sits in the header**: the current season is live and polling, any past season renders read-only from the archive and stops polling — a finished draft does not change.
4. **Commissioner drawer** (`isCommish`) — pause/resume, undo last pick, edit price, reassign, skip nominator, cancel lot, export CSV.
5. **`/stats`** — spend analysis, its own page because `/board` is about *who has whom*. Four views (Teams / Pace / Nominations / Value), one `StatsInput` adapter so the live draft and any archived season share a single code path. The Value view is **gated until every roster is full** — a live "you overpaid" readout is the anchoring the league removed tiers and auction values to avoid.
6. **`/trades`** — its own page, for the same reason the board got one: bidding, studying the board, and negotiating a trade are three different moments. Two rosters side by side, cash either way, and a live preview of both managers' budget/roster/max bid *after* the deal.
6. **`/admin`** (was `/setup`; reached from the account menu, commissioner only) — sync players, seed managers, budget/roster rules, and **set the season's draft order** (drag or Randomize, re-rollable, round 1/2 preview, locks when live).

## 9. Sleeper — `src/lib/sleeper.ts`, setup only, never on draft night

- `GET https://api.sleeper.app/v1/players/nfl` — public, no auth, ~5MB. Sleeper says store it yourself, ≤1 call/day.
- Filter `active === true`, positions QB/RB/WR/TE/K/DEF. Team defenses come back with `player_id` = team abbrev (`"PHI"`), position `DEF`.
### ⚠️ Measured against the live API 2026-08-11 — `search_rank` is not a ranking

| Finding | Number |
|---|---|
| Raw entries returned | 12,218 |
| Draftable positions | 4,262 |
| Active + draftable | **3,228** |
| Distinct `search_rank` values across 3,149 ranked players | **660** |
| Ranks shared by 2+ players | **318** (Josh Allen and Bijan Robinson are both #1) |
| Team defenses with a rank | **0 of 32** |
| Unranked sentinel | `9999999`, **not** null |

Three consequences, all handled in `src/lib/sleeper.ts` with tests:
1. `9999999` is normalized to `null`, or it renders as "#9999999" and poisons any numeric sort.
2. Ties break by position group then name, so the board order is stable rather than arbitrary.
3. **Every team defense is unranked**, so a naive rank sort buries all 32 at the bottom of a 3,200-row list — and this league drafts defenses. The pool UI therefore leads with **position filters + search**, not with rank order.

**Therefore: importing a real 2026 ranking CSV is the recommended path, not a fallback.** `parseCsvPool` accepts `Name, Team, Position, Rank`, tolerates a missing header, quoted fields, and the DS/DST/D-ST spellings of a defense.
- Optional: `GET /v1/league/<id>/users` to auto-populate manager names.

---

## 10. Build steps

`[ ]` todo · `[~]` in progress · `[x]` done

**Steps 1–37 are complete** — the auction app, the season archive, league history
(Phase 2) and the Gazette. Their checklist and the draft-week timeline are in
`docs/archive/BUILD_STEPS_1-37.md`; their log entries are in
`docs/archive/PROGRESS_LOG_2026.md`.

**Open steps start at 38 and are listed in §13.**

---

## 11. Gotchas index

Running list — add to it, and mirror anything hard-won into `PROGRESS_LOG.md`.

- `drizzle-kit push` cannot distinguish a new table from a rename and blocks on an interactive prompt (fatal in a non-TTY). Structural changes belong in a hand-written idempotent script — `scripts/migrate-called-auction.ts`
- A backtick inside a `sql\`…\`` template literal terminates it; the failure surfaces as an unrelated esbuild parse error
- `= ANY((SELECT arr FROM cte))` is the *subquery* form and fails with `operator does not exist: integer = integer[]`. Use `IN (SELECT unnest(arr) FROM cte)`
- Next 16 refuses a second `next dev` in the same directory — stop the live-DB server before smoke-testing the test DB
- `drizzle-kit` and `tsx` don't auto-load `.env.local` → `npx dotenv -e .env.local -- npx drizzle-kit push`
- Never wrap the Drizzle client in a `Proxy` for lazy init — use a plain `getDb()`
- `neon()` throws at import if `DATABASE_URL` is unset, which crashes `next build` → lazy init
- neon-http has **no interactive transactions** (see §4)
- `/api/state` must be `force-dynamic` + `no-store` (see §4)
- Sleeper `/players/nfl` is 5MB — never call it from a request path
- `picks` must be `UNIQUE (season, player_id)`. A global unique on `player_id` makes every previously drafted player undraftable forever, and `ON CONFLICT` in `awardLot` has to name the same columns
- A migration script that hardcodes a `CREATE OR REPLACE VIEW` becomes a loaded gun the moment that view changes. `scripts/migrate-called-auction.ts` now refuses to run once `draft.season` exists
- `@neondatabase/serverless` v1 `sql` is **tagged-template-only**; a plain call throws. Use `sql.query()` when the identifier is dynamic
- Any "is a draft under way?" check built on `COUNT(picks)` needs the season filter, or it sticks at 160 forever once a season completes (`scripts/check-idle.ts`)

---

## 12. League history (Phase 2)

The draft app knows about one season. The league has sixteen on record, back to 2011, plus
champions named back to 2006. Phase 2 brings that history in and builds the views the league reads:
the all-time League Summary, a record book, per-season and per-member pages, and a head-to-head grid.

### Source of record, by era

| Years | Source | Why it and not the other |
|---|---|---|
| 2020–2025 | **Sleeper API**, pulled to `data/sleeper/` | The workbook's weekly sheets came from this API and then drifted. Going back to the origin removes an approximate scoring model, an incomparable efficiency scale, and a PF/PA disagreement in 15 of 50 member-seasons |
| 2011–2019 | Workbook `regular_season`, `playoffs_legacy` | Pre-Sleeper. Member-season W/L/PF/PA is the only grain that exists |
| 2006–2010 | Workbook `win_history` legacy block | A champion's name and nothing else. Predates the membership record, so these are **names, not manager ids** |
| any year | Workbook `win_history`, `draft_locations` | Prize money and where the draft was held are league facts Sleeper cannot know |
| 2021–2024 | Workbook `auction_drafts` | **Auction prices exist only here.** Sleeper's amounts are a formality — every pick $1 |
| 2025 | The league's Google Sheet | The 2025 auction in full, plus that year's drawn draft order |

⚠️ **Sleeper's auction amounts must never be imported as prices.** 2022, 2023 and 2025 each record
160 picks totalling exactly $160; 2021 totals $250; 2024 has no picks at all. The room drafted aloud
on a sheet and entered results into Sleeper afterwards purely to set rosters. Those records are
authoritative about **which players** each manager took — that cross-check found a duplicated 2022
pick and recovered a missing one — and worthless about what they cost.

⚠️ **Never select the league by name.** The account holds an unrelated 18-team *Guillotine League*
in 2024 and 2025, and the real 2025 league is misnamed with 2024's name. League ids are pinned in
`SLEEPER_LEAGUE_IDS` and checked against Sleeper's own `previous_league_id` chain.

### The two-era rule

Metrics needing week-level data — all-play, lineup efficiency, high/low scorer weeks, every score
record — exist only from 2020. Standings-level metrics go back to 2011. **This is enforced
structurally, not by convention:** `seasons.data_tier` is `'legacy' | 'standings' | 'weekly'`, every
compute function returns a `Coverage` alongside its numbers, and `EraBadge` cannot render without
one. The workbook mixes the eras silently and contradicts itself as a result — its hidden
`All-time Records` sheet claims a high score of 203.9 (Nate, 2014) while the dashboard says 234.96
(Daniel, 2023).

### Schema principles — why the tables don't mirror the sheets

1. **Store facts, derive everything else.** High/low weeks, margin of victory, points left on bench
   and efficiency percentage are computed. Same rule that keeps budgets derived.
2. **One fact, one table.** Three sheets say "a game happened"; `season_matchups` does, with
   `is_playoff`. Every record question spans both.
3. **IDs, not names.** The sheets carry `member` *and* `member_id` on every row, which is exactly how
   a name mismatch broke a lookup and cost Eric + Mark their high-scorer weeks.
4. **Every primary key is the grain.** That makes "two rows per game" a decision, not an accident.
5. **Null means unknown, never zero.** Prize money is a real $0 for 2011–2013 and genuinely unknown
   for 2006–2010.
6. **Sparse stat columns become one `jsonb`.**

### Identity — `src/lib/history-identity.ts`

Three namespaces, no shared id space: the app says `Gabes`/`Bolek`/`Grossman`, the workbook says
`Brian`/`Jon`/`Eric + Mark`, Sleeper says `bgabrielsen`/`OGJonnyB`/`gizzle4`, and the workbook's
`member_id` is not `managers.id`. All three are reconciled in one frozen constant, **not a table** —
nothing at runtime consults it, since every imported row already carries a resolved `manager_id`, and
a table would be a second place the truth could drift. Every lookup **throws**: the league has had
the same ten members since 2011, so an unmapped name is a bug in the map, not an eleventh manager.
The co-managed seat has two Sleeper user_ids (`gizzle4` owns the roster, `markcubs` co-owns it).

### Budget anomalies are imported as recorded, never reconciled

Some manager-seasons don't balance: 2023 has Bryan at $205 and Mario at $194 against a $200 budget
(auction dollars were traded), and 2025 ends with Bolek at **−$1** — the exact failure §1 names as
the reason this app exists. These import faithfully and the archive **displays** them, flagged, with
the reason. A balancing row in `budget_adjustments` would be a stored budget wearing a disguise, in
the one table whose whole job is provenance. `getArchivedSeason` must not clamp a negative to zero.

Departures from a source are never silent: they live in one reviewable `HISTORY_PICK_CORRECTIONS`
list with a reason and a date.

### Money in, money out — the buy-in is derived, not entered

The league's payout rule: **third gets their money back, second gets double, and first takes the
rest.** With ten managers that makes the pot `10 × buy-in` and the payouts `7× / 2× / 1×` — so the
third-place prize *is* the buy-in, and `seasons.buy_in` is derived from it at import rather than
typed in fourteen times.

Derived, but **asserted**: `import-workbook-history.ts` throws if a season's runner-up isn't `2×`
its third-place prize, or its champion isn't `7×`. The rule currently holds for all fourteen
seasons on record with every pot balancing to the dollar. If the league changes its structure, that
should stop the import and be recorded — not be silently absorbed into a wrong buy-in that then
quietly skews every career figure.

The check that this is right: **career net winnings sum to exactly −$3,500 across all ten
managers**, which is 2026's ten $350 buy-ins paid in and not yet awarded. A zero-sum league nets to
zero, and the only gap is the season still being played.

`null` is unknown, never free. A season nobody has priced contributes to neither side of anyone's
net, rather than reading as a $0 entry fee — `memberProfile` restricts net winnings to seasons that
have *both* a buy-in and a podium, so fifteen years of prizes are never netted against one year's
entry fee.

Location, buy-in, prize money and side bet are set from the admin panel (`setSeasonDetails`, any season on record), and unlike budget and roster size they
**stay editable after the first pick**. Nothing about them reaches the auction engine, and both are
routinely settled late — the buy-in once everyone has actually paid, the city whenever somebody
remembers. They are read by `/api/season-info`, deliberately not by `/api/state`: they change once a
year, and that payload is fetched every 400ms by ten clients all night.

---

## 13. Analytics (Phase 3)

Eight features chosen 2026-11-10. **The build instructions for every step are in
`docs/ANALYTICS_ROADMAP.md`** — one self-contained section per step. This is only the
checklist. `[ ]` todo · `[~]` in progress · `[x]` done

**A. Ask the Oracle** — a question bar over the database
- [x] **38.** The database boundary: `oracle` schema of views, `oracle_reader` role, `oracle_log`
- [x] **39.** The SQL guard and the read-only runner
- [x] **40.** The schema notes the model reads, kept in step with the views by a test
- [x] **41.** The tool loop — `askOracle()`
- [x] **42.** `POST /api/ask` — session, daily cap, log
- [x] **43.** `/history/oracle` and the nav entry
- [ ] **44.** Ship: key in Vercel, live migration, UAT, twenty real questions

**B. Charts**
- [x] **45.** The chart kit — line, bar, stacked bar, donut
- [x] **46.** `/history/charts` — cumulative wins by year, and three more
- [x] **47.** Charts on the member and Past Auctions pages

**C. Playoff odds, extended**
- [x] **48.** Seed distribution and win-or-lose leverage
- [x] **49.** Title odds

**D. Positional scorecard**
- [x] **50.** `positionalScorecard()`
- [x] **51.** Member-page table and the season grid

**E. How the roster was built**
- [x] **52.** `roster-origin.ts` — drafted, traded at the draft, added later, unknown
- [x] **53.** The stacked bars

**F. Deeper record book**
- [x] **54.** Top-ten lists behind every record
- [x] **55.** The player record book

**G. Rating over time**
- [x] **56.** `ratingHistory()`
- [x] **57.** `/history/ratings`

**H. FAAB and waivers**
- [x] **58.** Pull Sleeper transactions
- [x] **59.** `season_transactions` and the importer
- [x] **60.** `faab.ts`
- [x] **61.** `/history/waivers`, and the Oracle learns about transactions

**I. Commissioner tools** — added 2026-11-11, outside the analytics roadmap
- [x] **62.** The admin panel: `/admin` from the account menu, replacing the ⚙ Commish drawer and `/setup`; edit any pick, record a sale, unlock a seat, rename, commissioner role, per-season prize money, start a new season
- [x] **63.** Site structure (`docs/SITE_STRUCTURE.md`): the top bar becomes The Gazette · History ▾ · Auction ▾; the Gazette and the Oracle move to `/gazette` and `/oracle` with permanent redirects; a global Ask the Oracle launcher, hidden on the draft pages; Glossary in the account menu

**J. Activity** — added 2026-11-11, see `docs/ACTIVITY_ROADMAP.md`
- [x] **63.** `page_visits` table and `npm run db:migrate-activity`; Oracle exclusion
- [x] **64.** `src/lib/activity.ts` — path normalising, page groups, the visible-and-active clock, the summary
- [x] **65.** `<ActivityBeacon>` and `POST /api/track`
- [x] **66.** Admin panel → Activity, `GET /api/admin/activity`, and ship

**K. Player stats** — added 2026-11-11. **Build instructions: `docs/PLAYER_STATS_ROADMAP.md`**
- [x] **63.** Pull Sleeper's weekly stats, trimmed to rostered players and the whitelist, into `data/sleeper/{season}/stats-NN.json`
- [x] **64.** `player_week_stats` and the importer
- [x] **65.** The Oracle learns about stats
- [x] **66.** Show the stat line

**L. Weaving player stats into the site** — added 2026-11-11. **Build instructions: `docs/STATS_WEAVE_ROADMAP.md`**
- [x] **67.** `player-stat-totals.ts` and "Stats by season" on the player page
- [x] **68.** Player page: game log, and a points / headline-stat toggle on the timeline
- [x] **69.** Players index: position and season filters, one stat column (stat sort only within one position)
- [ ] **70.** Records: stat records within a position
- [ ] **71.** Spend & Value / Past Auctions: what each pick returned
- [ ] **72.** Member page: biggest weeks, with stat lines
- [ ] **73.** Waivers: what a claim did since pickup
- [ ] **74.** Front page (season underway): the week's biggest starts
- [ ] **75.** Oracle suggested questions, glossary, UAT

