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
| Nomination | Nominator names an opening bid, becomes high bidder at that price |
| Roster rules | Hard cap 16, **no position enforcement**; position counts shown as info only |
| Nomination clock | **None.** Only the bid clock runs (breaks happen between lots) |
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
- Timer: `endsAt = now + timerSeconds` (default 25) on nomination.
- Soft close: on each bid, `endsAt = max(endsAt, now + softCloseSeconds)` (default 10). Bids **outside** the final 10s do not extend; bids **inside** it snap to exactly 10s.
- A manager at 16 players cannot bid and is skipped in the nomination order.

---

## 4. Architecture

**Next.js 16 App Router + TypeScript, Tailwind + shadcn/ui, Neon Postgres (Drizzle), deployed on Vercel.** No websockets, no pub/sub, no cron.

### Polling, and why it isn't a compromise
Clients `GET /api/state?v=<version>` every 400ms; `204` when unchanged. 10 clients ≈ 25 req/s — trivial.

The countdown is **not** polled — the server sends an absolute `endsAt` and the client renders locally at 60fps, so it's smooth regardless of poll rate. Polling carries only *bid events*.

400ms of staleness cannot hurt anyone, because **any bid inside the final 10s resets the clock to 10s**. Seeing a bid late always leaves a fresh 10s to respond. Late information can never cost someone a player.

> ⚠️ **Clock skew must be corrected.** Every state response includes `serverNow`; the client keeps a smoothed `offset = serverNow − clientNow` and renders `endsAt − (Date.now() + offset)`. Someone's laptop clock *will* be wrong. The server clock is the only one that decides anything.

### Lazy settlement — no cron
Each `/api/state` read first attempts:
```sql
UPDATE lots SET status='sold' WHERE status='open' AND now() >= ends_at RETURNING *
```
Only the caller that wins that race writes the `picks` row — idempotent by construction. A player sells within ~400ms of zero; if nobody's watching, it settles when anyone loads the page.

> ⚠️ This gives a `GET` side effects, so `/api/state` **must** be `export const dynamic = 'force-dynamic'` with `Cache-Control: no-store`. A cached `204` would silently freeze the whole draft and would look like a UI bug.

### Bids are one atomic conditional UPDATE — not a transaction
```sql
UPDATE lots SET
  high_bid = $amount, high_bidder_id = $mgr, version = version + 1,
  ends_at = GREATEST(ends_at, now() + ($softClose || ' seconds')::interval)
WHERE id = $lot AND status = 'open' AND now() < ends_at
  AND $amount > high_bid
  AND $amount <= (SELECT max_bid FROM manager_totals WHERE id = $mgr)
RETURNING *;
```
Zero rows = bid lost (too low / too late / over max / beaten by a millisecond). Postgres serializes concurrent `UPDATE`s on the same row, so simultaneous `+$1` gives one clean winner, no lost update, no lock held across a round trip.

> ⚠️ **Do not "fix" this into `SELECT … FOR UPDATE`.** Neon's HTTP driver (`drizzle-orm/neon-http`) does **not** support interactive transactions — that would fail at runtime and force `Pool`-over-WebSockets with connection-lifecycle management in serverless. The single-statement form is deliberate.

`manager_totals` is a SQL **view** deriving budget/rostered/max_bid from `picks`, so max bid is enforced *inside the database* and cannot be bypassed by a bad client.

---

## 5. Data model — `src/db/schema.ts`

| Table | Columns |
|---|---|
| `managers` | `id, name, displayName, color, pinHash, draftSlot, isCommish` |
| `players` | `id (sleeper_id), name, team, position, searchRank, active` |
| `draft` | single row: `status ('setup'\|'live'\|'paused'\|'done'), nominationIndex, timerSeconds=25, softCloseSeconds=10, rosterSize=16, startingBudget=200` |
| `lots` | `id, playerId, nominatorId, highBid, highBidderId, endsAt, pausedRemainingMs, status ('open'\|'sold'), version` |
| `bids` | `id, lotId, managerId, amount, createdAt` — full audit trail |
| `picks` | `id, pickNo, playerId, managerId, nominatorId, price, slotOverride, createdAt` |
| view `manager_totals` | `id, budget, rostered, max_bid` derived from `picks` |

`slotOverride` is nullable and **display-only** — null means auto-slot, a value means the manager dragged the player into a specific grid row. It never affects bidding.

---

## 6. Core logic — `src/lib/draft.ts` (pure, DB-free, unit-tested)

- `maxBidFor(budget, rostered, rosterSize)`
- `snakeOrder(managers, nominationIndex)` — round `r`, position `i`: slot `i` when `r` even, `N−1−i` when odd. Reads `draftSlot` (per-season data). Skips full managers.
- `randomOrder(managers)` — Fisher–Yates.
- `validateBid({ amount, manager, lot })`
- `autoSlot(picks)` → `Record<SlotRow, Pick|null>` — greedy best fit: `slotOverride` first, then natural position, then FLEX (RB/WR/TE), then SUPERFLEX (QB/RB/WR/TE), then bench. **Display-only; deliberately unreachable from any bid path** so it can never become a restriction by accident.

## 7. API

| Route | Behaviour |
|---|---|
| `POST /api/nominate` | `{ playerId, openingBid }` — asserts caller's turn, validates vs max, creates lot, nominator is high bidder |
| `POST /api/bid` | `{ lotId, amount }` — the atomic UPDATE above |
| `GET /api/state?v=` | settles expired lots, returns `{ version, serverNow, draft, lot, managers[], recentPicks }`, `204` if unchanged |
| `GET /api/board` | heavy payload (full pool + all rosters), fetched only when `version` changes |

---

## 8. Screens

1. **`/` Join** — pick name, set/enter PIN, signed httpOnly cookie.
2. **`/draft`** — center: lot + big countdown + `+$1`/`+$5`/custom, your max bid always visible, over-max disabled *with the reason shown*. Left: searchable/filterable pool, drafted players vanish, Nominate live only on your turn. Right: tabs **My Roster / League / Budgets / Pick log**. Bottom: recent-picks ticker. Audio: beep at 10s & 3s, gavel on sold.
3. **League board** — 16 slot rows × 10 manager columns, one color each, headers pinned. Auto-slotted for display; drag your own to override; empty slots greyed; winner's column flashes on sale. Mobile: horizontal scroll with pinned labels + single-manager picker.
4. **Commissioner drawer** (`isCommish`) — pause/resume (banks `pausedRemainingMs`), adjust timer + ±10s live, undo last pick, edit price, reassign, skip nominator, reopen lot, export CSV.
5. **`/setup`** — sync players, seed managers, budget/roster/timer defaults, and **set the season's draft order** (drag or Randomize, re-rollable, round 1/2 preview, locks when live).

## 9. Sleeper — `src/lib/sleeper.ts`, setup only, never on draft night

- `GET https://api.sleeper.app/v1/players/nfl` — public, no auth, ~5MB. Sleeper says store it yourself, ≤1 call/day.
- Filter `active === true`, positions QB/RB/WR/TE/K/DEF. Team defenses come back with `player_id` = team abbrev (`"PHI"`), position `DEF`.
- Sort by `search_rank`. **Caveat:** that's search popularity, not ADP — fine for lookup, mediocre for drafting. CSV import (`Name, Team, Position, Rank`) is the real answer and the fallback if Sleeper is down.
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

- `drizzle-kit` and `tsx` don't auto-load `.env.local` → `npx dotenv -e .env.local -- npx drizzle-kit push`
- Never wrap the Drizzle client in a `Proxy` for lazy init — use a plain `getDb()`
- `neon()` throws at import if `DATABASE_URL` is unset, which crashes `next build` → lazy init
- neon-http has **no interactive transactions** (see §4)
- `/api/state` must be `force-dynamic` + `no-store` (see §4)
- Sleeper `/players/nfl` is 5MB — never call it from a request path
