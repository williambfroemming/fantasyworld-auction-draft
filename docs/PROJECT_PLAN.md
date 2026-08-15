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

---

## 8. Screens

1. **`/` Join** — pick name, set/enter PIN, signed httpOnly cookie.
2. **`/draft`** — center: the player on the block, and for the nominator a price field plus a grid of the ten managers. **Type the price first and everyone who cannot afford it greys out**, so an illegal price is refused while the room is still listening. Left: searchable/filterable pool, drafted players vanish, Nominate live only on your turn. Right: tabs **My Roster / Budgets / Picks**. Bottom: recent-picks ticker. Audio: gavel on sold, nudge on your turn.
3. **League board** (`/board`) — 16 slot rows × 10 manager columns, one color each, headers pinned. Auto-slotted for display; drag your own to override; empty slots greyed; winner's column flashes on sale. Mobile: horizontal scroll with pinned labels + single-manager picker. **A year picker sits in the header**: the current season is live and polling, any past season renders read-only from the archive and stops polling — a finished draft does not change.
4. **Commissioner drawer** (`isCommish`) — pause/resume, undo last pick, edit price, reassign, skip nominator, cancel lot, export CSV.
5. **`/trades`** — its own page, for the same reason the board got one: bidding, studying the board, and negotiating a trade are three different moments. Two rosters side by side, cash either way, and a live preview of both managers' budget/roster/max bid *after* the deal.
6. **`/setup`** — sync players, seed managers, budget/roster rules, and **set the season's draft order** (drag or Randomize, re-rollable, round 1/2 preview, locks when live).

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

- [x] **1.** `docs/` scaffold + root `CLAUDE.md`
- [ ] **2.** Provision Neon via Vercel Marketplace, `vercel env pull` *(needs the user's account — deferred, not blocking 3/4)*
- [x] **3.** Scaffold Next.js + Tailwind + shadcn; Drizzle schema, `manager_totals` view, lazy `getDb()`
- [x] **4.** `src/lib/draft.ts` + unit tests — **before any UI** *(26 tests passing)*
- [ ] **5.** Sleeper sync + CSV import + `/setup` incl. draft-order shuffle
- [ ] **6.** Join flow + PIN cookie
- [ ] **7.** `/api/nominate`, `/api/bid`, `/api/state`, `/api/board`
- [ ] **8.** `/draft` UI, polling hook, skew-corrected clock
- [ ] **9.** League board / Budgets / Pick log tabs, `autoSlot`, drag override
- [ ] **10.** Commissioner drawer
- [ ] **11.** CSV export
- [ ] **12.** Deploy to preview → dress rehearsal → full UAT
- [x] **16.** **Called auction** — remove the clock, live bidding, soft close, lazy settlement and clock sync; `awardLot()` records the room's result. **Trades** of players and auction dollars, salary staying with the drafter.
- [x] **18.** **§9 P0/P1 + backlog §3–§6** — `nominatorAt` no longer stalls near the end of a draft; a real "Draft Complete!" panel that distinguishes finished from stuck; the board grows bench rows so a manager with no defense doesn't lose a player; average remaining budget; on deck; market by position; the private player queue.
- [x] **17.** **Seasons + archive** (BACKLOG §2) — `season` on every per-draft table, season-scoped `manager_totals`, the player snapshot on `picks`, `season_orders`, `/api/archive` and the year picker on `/board`. `season:new` replaces "reset and start over". The 2026 draft's final 8 picks recorded and the draft closed at 160.

### Timeline

| When | Steps | State at end |
|---|---|---|
| **Tue 8/11** | 1–7 | Backend correct and tested; draft runnable via API |
| **Wed 8/12** | 8–9 | **Playable end to end** — cut line, a draft could be run on this |
| **Thu 8/13** | 10–11, deploy, **dress rehearsal with the league** | Bugs found with a night left to fix them |
| **Fri 8/14** | Fix rehearsal findings, full UAT | Draft night |

**Thursday's rehearsal is the hard commitment, not Friday.** It's the only step that finds what scripted tests can't, and it's worthless after the code is frozen.

**Fallback:** the Google Sheet stays untouched and usable all week. If Friday goes sideways, the old process still works.

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
