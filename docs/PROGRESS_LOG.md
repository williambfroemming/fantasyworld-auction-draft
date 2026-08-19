# Progress Log

**Append-only.** Never edit a past entry — if something turns out wrong, write a new entry correcting it and note which entry it supersedes. The history of what we believed and when is part of the value.

One entry per completed build step from `PROJECT_PLAN.md` §10. The **Learned** and **Watch out for** lines are the point of this file: they're the things that cost an hour to find and five seconds to write down, and they're exactly what a fresh context window otherwise pays for twice. An entry with an empty **Learned** line is a smell, not a clean run.

### Template

```markdown
## Step N — <name>
**Date:** YYYY-MM-DD  **Status:** done
**Built:** files/modules created or changed
**Decisions:** anything chosen that wasn't already in PROJECT_PLAN.md (and update that file too)
**Learned:** the non-obvious thing. Be specific.
**Watch out for:** the trap the next person would otherwise fall into
**Next:** step N+1
```

---

## Step 1 — docs scaffold + CLAUDE.md
**Date:** 2026-08-11  **Status:** done
**Built:** `docs/PROJECT_PLAN.md`, `docs/PROGRESS_LOG.md`, `docs/UAT.md`, root `CLAUDE.md`; `git init`

**Decisions:** Docs come before code. With a Friday deadline and work likely spanning several sessions, the cost of a fresh context re-deriving the architecture is higher than the cost of writing it down once.

**Learned:** Reading the league's actual Google Sheet changed the spec in three ways that the written brief did not convey, and none would have been caught by asking follow-up questions in the abstract:
1. The nomination order is a **snake** — visible only by reading the pick log and noticing picks 11–20 run in reverse. The brief just said "full draft order."
2. The roster is **16 slots, not 15** — the brief said "2 QB" but the grid shows QB + SUPERFLEX. This is load-bearing: the whole max-bid formula keys off roster size, and 15 would have made every max bid $1 too high all draft.
3. The sheet contains a manager at **−1 budget** and a DEFENSE slot holding a running back — concrete evidence of what the manual process actually breaks, which is what justified deriving budgets rather than storing them.

**Watch out for:** Two architectural choices in §4 look like mistakes and will tempt a future agent to "fix" them. Both are deliberate and both are documented inline:
- Bids use a single conditional `UPDATE`, **not** `SELECT … FOR UPDATE` in a transaction, because Neon's HTTP driver has no interactive transactions.
- `GET /api/state` has side effects (lazy settlement), so it must stay `force-dynamic` + `no-store`. Caching it would freeze the draft and present as a UI bug.

**Next:** Step 2 — provision Neon via Vercel Marketplace. Blocked on the user: Vercel CLI is not installed (`npm i -g vercel`) and the Vercel MCP server is unauthorized in this session, so login/provisioning needs their hands.

---

## Steps 3 & 4 — Next.js scaffold, DB layer, and the rules engine
**Date:** 2026-08-11  **Status:** done

**Built:** Next 16.3.0 / React 19.2.8 / Tailwind 4 scaffold (src dir, `@/*` alias); `src/db/schema.ts` (managers, players, draft, lots, bids, picks); `src/db/index.ts` lazy `getDb()`; `src/db/sql/manager_totals.sql`; `scripts/apply-sql.ts`; `drizzle.config.ts`; `src/lib/draft.ts` + `src/lib/draft.test.ts` — **26 tests passing**, typecheck clean, `next build` green.

**Decisions:**
- **Polling version is a fingerprint, not a counter.** Originally the plan had a single `version` column to bump on every mutation. That conflicts with the atomic single-statement bid — bumping a global counter would need a second write. Instead: `draft.rev` (settings/pause/order changes) + `lots.version` (bumped atomically by the bid UPDATE) + `COUNT(picks)`, composed into one fingerprint string. No bump discipline to forget, and the bid stays one statement. *(PROJECT_PLAN.md §5 updated.)*
- **Vitest pinned to v3, not v4** — see below.
- `autoSlot` uses four passes (overrides → natural → FLEX/SUPERFLEX → bench) rather than a greedy walk in draft order. A greedy walk hands SUPERFLEX to whatever arrives first, so a manager who drafts RB-heavy early would see their second QB pushed to the bench. SUPERFLEX also explicitly prefers a QB, which is how the sheet shows the league actually using it.

**Learned:**
- **The `next build` / EOL-Node interaction is the real story.** `npm test` failed with "Cannot find native binding — npm has a bug related to optional dependencies," which is a misleading error. The actual cause: this machine runs **Node 21.7.3**, and `@rolldown/binding-darwin-arm64` (pulled in by Vitest 4) declares `engines: ^20.19.0 || >=22.12.0`. Node 21 satisfies neither, so npm *correctly* skipped the optional dep and rolldown then blamed npm. Removing `node_modules` + lockfile — the fix the error suggests — does nothing. Vitest 3 uses esbuild instead of rolldown and works fine.
- Verified rather than assumed: `next build` succeeds with `DATABASE_URL` unset, so the lazy `getDb()` genuinely protects the build.
- The old sheet's "budget $2, 16 players, max bid $3" is the un-clamped max-bid formula leaking — with a full roster, `budget − (16 − 16 − 1)` = `budget + 1`. Both `maxBidFor()` and the `manager_totals` view clamp a full roster to 0. There's a test asserting this exact case.

**Watch out for:**
- **Node 21.7.3 is EOL and Vercel runs Node 24.** This already broke one dependency's install. Anything else with a `^20.19 || >=22.12` engine range will fail the same silent way. Recommended the user move to Node 22 LTS or 24 — until then, treat every "cannot find native binding" as an engines mismatch, not an npm bug.
- **`create-next-app` writes its own `CLAUDE.md` containing `@AGENTS.md`** and an `AGENTS.md` with a Next-generated rules block. Scaffolding into the repo overwrote the step-1 `CLAUDE.md`. Project rules now live in `AGENTS.md` *below* the `<!-- BEGIN:nextjs-agent-rules -->` block, which `next dev` rewrites on every run — don't delete it, and keep custom content outside it.
- **Do not enable `cacheComponents` in `next.config.ts`.** Next 16 *removes* the `dynamic` route-segment config when it's on (confirmed in `node_modules/next/dist/docs/.../route-segment-config/index.md`), which would silently break the `force-dynamic` guarantee that `/api/state` depends on for lazy settlement. Noted in AGENTS.md as a non-negotiable.

**Next:** Step 2 (Neon provisioning — blocked on the user's Vercel account), then Step 5 (Sleeper sync + `/setup`). Step 5's pure logic can proceed without the DB.

---

## Step 5a — Sleeper sync + CSV import (library layer)
**Date:** 2026-08-11  **Status:** done (library); `/setup` UI still pending on the DB

**Built:** `src/lib/sleeper.ts` (`normalizePool`, `sortForBoard`, `fetchPool`, `fetchLeagueUsers`, `parseCsvPool`) + `src/lib/sleeper.test.ts`. 38 tests total passing.

**Decisions:** The player pool UI will lead with **position filters + search**, not rank order — forced by the data below, not a style preference.

**Learned — I probed the live API instead of trusting the docs, and it changed the design:**
- The pool is **3,228 active draftable players**, not the ~275 of the old sheet. An unfiltered scroll list is unusable at that size.
- **`search_rank` is a weak ordering, not a ranking.** Only **660 distinct values across 3,149 players**; **318 ranks are shared** by two or more players — Josh Allen and Bijan Robinson are both rank 1, and four players share rank 5. Sorting by it alone gives an unstable, arbitrary board.
- **Sleeper marks unranked players with `9999999`, not null.** `max(search_rank)` for both QB and RB is exactly that. My original null check missed it entirely, which would have shown "#9999999" in the UI and silently ranked those players above nothing.
- **All 32 team defenses have no rank at all.** A naive sort put the first defense at board index **3,150 of 3,228**. This league drafts a defense every year, so that alone would have been a draft-night problem.
- Correcting an earlier guess: I had speculated ~40% of players lack a rank. The real figure is **2.4% null** — but that was only because the 9999999 sentinel was hiding the rest. Worth stating plainly: the guess was wrong in both directions and only measuring settled it.

**Watch out for:**
- Never sort the pool by `searchRank` alone — always through `sortForBoard`, which applies the position/name tiebreak.
- `fetchPool()` downloads ~5MB. It is setup-only. **Never call it from a request path**, and never on draft night.
- IDP positions are in the raw payload and must stay filtered out (4,262 draftable vs 12,218 raw).

**Next:** Step 2 (Neon provisioning — needs the user's Vercel account) unblocks `/setup`, the seed script, and everything after it.

---

## Step 5b — Node 22 upgrade + auth, clock, and version libraries
**Date:** 2026-08-11  **Status:** done

**Built:** `src/lib/auth.ts` (scrypt PIN hashing, HMAC-signed session cookie), `src/lib/clock.ts` (`ClockSync`), `src/lib/version.ts` (polling fingerprint), plus tests for each. **57 tests passing** on Node 22.

**Decisions:**
- Node upgraded to **22.23.2 LTS** via Homebrew (user approved). Tests and `next build` re-verified on it.
- **Vitest stays on v3** even though Node 22 now satisfies rolldown's engine range. It works, and swapping test runners three days before a live draft is churn with no upside.
- PIN uses `node:crypto` scrypt rather than bcrypt — no native dependency, so nothing else can fail an engines check the way rolldown did.
- Sessions are **signed, not encrypted**. The manager id isn't a secret; it only needs to be unforgeable so nobody can hand-edit a cookie and bid as someone else.

**Learned:**
- `ClockSync` needs **round-trip compensation**, not just `serverNow - clientNow`. The server's timestamp reflects roughly the midpoint of the round trip, so the naive form treats network latency as clock skew and biases every countdown early by ~half the RTT. There's a test with perfectly synced clocks and a 400ms RTT asserting the offset stays under 20ms.
- The threat model here is a **shared laptop and a misclick**, not an attacker. That's what justifies a 4-digit PIN and a week-long cookie (it has to outlive a dead phone battery mid-draft) rather than anything heavier.

**Watch out for:**
- `timingSafeEqual` **throws** on length mismatch rather than returning false. Both `verifyPin` and `verifySession` compare lengths first; there are tests for malformed stored hashes and junk tokens specifically because the natural implementation crashes instead of rejecting.
- The clock is smoothed (α=0.2), so it takes a few polls to converge. That's deliberate — one slow response must not yank the countdown — but it means a freshly loaded client is briefly unsynced. `ClockSync.synced` reports this; the UI should not show a countdown until it's true.
- `sessionSecret()` throws in production if `SESSION_SECRET` is unset. **Set it in Vercel before deploying**, or every session would be forgeable.

**Next:** Step 2 (Neon) is still the blocker for `/setup`, the seed, and all API routes.

---

## Step 2 + 5c — Neon provisioned, schema pushed, pool seeded from FantasyPros
**Date:** 2026-08-11  **Status:** done

**Built:** Neon provisioned via Vercel Marketplace (user ran the CLI); schema pushed; `manager_totals` view applied; `scripts/seed.ts` and `scripts/verify.ts`; header-driven CSV parser. **62 tests passing.** `npm run db:verify` green.

**Seeded:** 10 managers (2025 seating, to be re-drawn at setup), **503 players** — WR 171, RB 140, TE 76, QB 52, K 33, DEF 31.

**Decisions:**
- **The pool now comes from FantasyPros, not Sleeper.** The user supplied `FantasyPros_2026_Draft_ALL_Rankings.csv`. Sleeper remains the fallback in `seed.ts` when no CSV is passed.
- Schema gained `pos_rank`, `tier`, `bye_week`, `auction_value`. Tier and bye came free in the file and are genuinely useful while bidding; `auction_value` is populated only if an auction-values export is imported later.
- The CSV parser is now **header-driven, not positional** — it locates columns by name so a column reorder, a missing tier, or a different export shape doesn't silently produce garbage.

**Learned:**
- **The CSV completely solves the Sleeper ranking problem documented in step 5a.** Defenses went from board index **3,150 of 3,228** to **rank 156 of 503** — findable. Every player now has a real overall rank; `db:verify` asserts zero unranked.
- FantasyPros bakes the positional rank into the position column (`WR1`, `DST1`, `K3`) and uses `"-"` for missing bye weeks. Both needed explicit handling — `Number("-")` is `NaN`, which would have written nulls silently, and an unsplit `"WR1"` would have failed the draftable-position check and **dropped every player from the import**.
- Its header has trailing spaces (`"UPSIDE "`), so header matching has to trim.
- Confirmed live: a fresh manager reads **$200 budget / $185 max bid** straight out of `manager_totals`. That is the number the whole auction hangs on and it is now asserted in `db:verify`, not just in unit tests.

**Watch out for:**
- `seed.ts` deletes and reloads the pool but **only removes players nothing points at** (`WHERE id NOT IN (SELECT player_id FROM picks)`), so re-importing rankings mid-draft can't orphan a drafted player. It also uses `onConflictDoNothing` for managers so a re-seed never wipes someone's PIN.
- FantasyPros lists **31 defenses, not 32**. `db:verify` therefore asserts `>= 28` rather than exactly 32. If a manager wants the missing team's defense, it must be added by hand.
- Scripts run from outside the project directory can't resolve `node_modules` — that's why `verify.ts` lives in `scripts/` rather than a temp dir.

**Next:** Step 7 — the nominate/bid/state routes, then integration tests for concurrency and the soft-close timer against real Postgres.

---

## Step 7 — Auction engine + API routes, verified against real Postgres
**Date:** 2026-08-11  **Status:** done

**Built:** `src/server/sql.ts`, `src/server/draft-service.ts` (settle / getState / nominate / placeBid), `src/server/session.ts`, routes `/api/state`, `/api/bid`, `/api/nominate`, `/api/session`; `vitest.config.ts` + `vitest.integration.config.ts`; `src/server/draft-service.itest.ts`.

**62 unit tests + 20 integration tests against live Neon — all passing.**

**What the integration suite actually proves** (these were architectural claims until now):
- **10 simultaneous bids at the same amount → exactly one winner**, one bid row, no lost updates. The atomic conditional UPDATE holds.
- **Soft close is exact**: a bid at 20s left leaves `ends_at` byte-identical; a bid at 3s left snaps it to within 9.0–10.1s. Five consecutive late bids each reset it, so a bidding war cannot time out early.
- **Settlement is idempotent**: 10 concurrent `settleExpiredLots()` calls produce **one** pick, not ten. This is what makes lazy settlement-on-read safe with ten clients polling.
- **The invariant holds under adversarial play**: driving one manager to bid their entire max 16 times in a row, every manager's budget stays ≥ their remaining slot count at every step.
- Max bid is enforced **in the database** — a bid of $186 is rejected even though the client never sent a validation flag.

**Decisions:**
- Settlement is a **single statement with a CTE** (`WITH won AS (UPDATE … RETURNING *) INSERT INTO picks … FROM won`). The two-statement version had a crash window where a lot could be marked sold with no pick written. `repairOrphanedLots()` remains as a belt-and-braces self-heal.
- Rejected bids return **HTTP 200 with `ok:false`**, not 4xx. Losing an auction is a normal outcome, not an error, and it keeps the console clean during a live draft.
- The bidder is always read from the **signed session cookie**, never from the request body.

**Learned:**
- `explainRejectedBid()` runs *after* the failed UPDATE, purely to phrase the error. Checking first and then updating would reintroduce the race the single statement exists to eliminate. The database decides; we only narrate.
- Postgres `GREATEST(ends_at, now() + interval)` expresses the entire soft-close rule in one expression — no read-modify-write, so it's correct under concurrency for free.
- Integration tests take ~62s, dominated by network round trips to Neon (each `sql` call is an HTTP request). Fine for a pre-deploy gate, too slow for a watch loop — hence the split configs.

**Watch out for:**
- **`npm run test:int` DELETES all picks, lots, and bids.** It is guarded behind `ALLOW_DB_RESET=1` precisely so a stray run on draft night can't wipe the live draft. Do not remove that guard, and consider pointing it at a Neon branch before Friday.
- `/api/state` must keep both `export const dynamic = 'force-dynamic'` and `Cache-Control: no-store`. A cached 204 freezes the draft for everyone and looks like a UI bug.
- The integration suite leaves the draft in `status='setup'` on completion, by design. Re-run `npm run db:verify` after it if something looks odd.

**Next:** Step 8 — join screen and `/draft` UI (pool, lot, clock, polling).

---

## Steps 8 + 9 — Join screen, draft board, League grid; playable end to end
**Date:** 2026-08-11  **Status:** done

**Built:** `src/hooks/useDraft.ts` (polling + skew-corrected countdown), `src/lib/sounds.ts`, `src/components/LotPanel.tsx`, `PlayerPool.tsx`, `SidePanel.tsx` (My Roster / League / Budgets / Picks), `src/app/page.tsx` (join), `src/app/draft/page.tsx`, `/api/board`, `scripts/smoke.ts`.

**64 unit tests + 20 integration tests + 24 end-to-end smoke checks — all green.**

**Decisions:**
- Removed auction values entirely at the league's request (published prices anchor bidding the same way ADP does). Column dropped, importer ignores it, test pins the behaviour.
- Bid buttons are +$1/+$2/+$5/+$10 plus a custom field, each pre-validated by the shared `validateBid` so the button disables *and* the reason is shown. A silent rejection mid-auction is useless.
- The player pool shows a **tier break line** where FantasyPros' tier changes — that's where the talent cliff is, which is when to spend.
- Audio is synthesized with WebAudio rather than asset files: nothing to 404 on draft night.

**Learned — two real bugs the smoke test caught that nothing else would have:**
1. **`drizzle-kit push` DROPS the `manager_totals` view.** Every `db:push` silently removed it, and the next `/api/state` returned HTTP 500 with `relation "manager_totals" does not exist`. Unit and integration tests didn't catch it because they'd run before the push. `db:push` now *always* re-applies `db:sql`, so the two can't drift.
2. **A verify run that fails partway looks like a pass if you only read the matching lines.** `db:verify` did catch the missing view — it stopped after four checks — but the absence of the final "All checks passed" was easy to miss when grepping. Always check the **exit code**, not the visible output.

**Watch out for:**
- Never run `drizzle-kit push` directly. Use `npm run db:push`, which re-applies the view afterwards.
- `endsAt` crosses the wire as an ISO string, so `ClockSync` accepts strings and returns 0 (not NaN) for an unparseable value — NaN on the big countdown is worse than 0.
- Browsers block WebAudio until a user gesture. `unlockAudio()` is wired to the first click anywhere on the draft page; without it the 10s/3s cues stay silent all night.
- `npm run smoke` also wipes draft state and is guarded by `ALLOW_DB_RESET=1`.

**Next:** `/setup` (draft-order shuffle), commissioner drawer, CSV export, then deploy.

---

## Step 9b — Removed tiers (and auction values) from the board
**Date:** 2026-08-11  **Status:** done

**Built:** `tier` removed from schema, CSV importer, `/api/board`, hook types, and the pool UI; column dropped from Postgres. Same treatment previously applied to `auction_value`.

**Decisions:** The league does not want **any** opinionated third-party signal on the board — no auction values, no tiers. Managers bring their own rankings and cheat sheets, and a number printed next to a player anchors the room's bidding whether or not people trust it. The board now shows **facts only**: overall rank, position, team, bye week.

**Learned:** Both were dropped at the **import boundary** rather than hidden in the UI. Storing-but-not-showing would have meant the data was one component prop away from reappearing, and any future `/api/board` change could leak it. A single test — "drops opinionated columns the league does not want on the board" — asserts neither key survives a CSV that contains both.

**Watch out for:** FantasyPros exports still *contain* `TIERS` and sometimes `Auction Value`. The header-driven parser simply doesn't look for them, so re-importing a fresh export can't reintroduce either. If a future request adds a column, add it deliberately — don't widen the parser to "take everything".

**Next:** commissioner drawer, `/setup` draft-order shuffle, CSV export, deploy.

---

## Steps 10 + 11 — Commissioner controls and CSV export
**Date:** 2026-08-11  **Status:** done

**Built:** `src/server/commish-service.ts`, `/api/commish`, `src/components/CommishDrawer.tsx`, `/api/export` (CSV shaped like the old sheet's pick log), `scripts/check-idle.ts`, `src/server/commish-service.itest.ts`.

**64 unit + 33 integration tests passing.**

Commissioner can: pause/resume, ±10s/+30s on the live clock, change timer defaults, undo the last pick, cancel the current lot, skip a nominator, edit a price, reassign a player, swap two seats, clear a forgotten PIN, export CSV.

**Learned — the biggest operational finding so far:**
- **A single open browser tab breaks the integration suite, and could have destroyed a live draft.** Two tests failed mysteriously; the dev log showed **1,831 `/api/state` polls** from the user's open tab. Every poll settles expired lots — lazy settlement working exactly as designed — so lots were being awarded out from under tests that had just created them. The tests were right; the environment was contaminated.
- The serious version of this is not flaky tests. `test:int` and `smoke` both **wipe picks, lots, and bids**. Running either during the real draft on Friday would erase it. `ALLOW_DB_RESET=1` prevented an *accidental* run, but not a deliberate one against the wrong database.
- Added `npm run check:idle`, now a prerequisite of `test:int`: it refuses outright if picks exist and the draft isn't in `setup` (i.e. a real draft), and refuses if anything answers on the dev port (i.e. someone may be connected). Verified in both directions — exit 1 blocks the suite.
- Reordered `explainRejectedBid` to check **expiry before status**. A lot that timed out may be settled by another client's poll between the failed UPDATE and the follow-up read, and "Time expired" is truthful either way, where "Bidding closed" made a normal timeout look like a fault.

**Decisions:**
- `pause()` banks `paused_remaining_ms` rather than just setting a flag, so a break mid-player restores the exact clock. Tested: pause at 17s, wait 1.5s, resume — still ~17s.
- `editPrice()` re-checks the budget invariant by hand. It is the only path that writes a price without going through the bid rules, so it must not be able to strand a manager below $1 per empty slot. There's a test for exactly that.
- Undoing a pick marks the lot `void` rather than deleting it — the history stays, and the player becomes nominatable again.

**Watch out for:**
- **Before Friday, point `test:int`/`smoke` at a separate Neon branch.** `check:idle` is a guard, not isolation. This is the single highest-value remaining risk.
- `adjustClock(-300)` on a 5s lot clamps the deadline to "now", which ends the lot immediately. That's intended ("sold!"), and the test asserts it clamps rather than landing minutes in the past.

**Next:** `/setup` (draft-order shuffle), then deploy to preview with `SESSION_SECRET`.

---

## Step 12 — Making it testable by one person
**Date:** 2026-08-11  **Status:** done

**Built:** `/test` multi-seat console (+ `/api/test/act`), `scripts/bots.ts`, `scripts/pins.ts`, `scripts/start-draft.ts`, seat-switching in the header, and much clearer "why can't I nominate" messaging.

**Learned — a UX bug that would have cost real time on draft night:**
The user opened the app and could not find any way to nominate. The cause: the draft was in `status='setup'` (left there by the integration suite's teardown) and **the UI said nothing about it**. The player list was simply inert. Two smaller versions of the same problem: nothing indicated whose turn it was if it wasn't yours, and there was no way to sign out and switch seats.

Fixed by making the reason always visible: a banner when the draft hasn't started, a permanent "On the clock: *name*" bar, and an explicit line in the player list for every blocked case (not your turn / paused / bidding already open / draft complete). **A disabled control with no explanation is the worst possible failure mode in a live draft** — people assume the app is broken.

**Decisions:**
- `/test` can act as any manager without a PIN, so it is gated behind `ENABLE_TEST_SEATS=1`, checked **independently** in both the page and the API route — a single guard is one refactor away from being bypassed. Verified 404 in both places with the flag off before enabling it. `npm run dev:test` turns it on locally; the flag is never set in Vercel.
- The test console calls the **same** `placeBid`/`nominate` functions as the real UI. It bypasses authentication only — never the auction rules — so a rejection there is the real rule firing, which is what makes it valid for verification.
- `bots.ts` bids more aggressively inside the final six seconds, so the soft close is easy to observe by hand.

**Watch out for:**
- **`npm run pins -- --clear` before Friday.** Every seat currently shares PIN `1111` for testing; that defeats the point of PINs in the real draft.
- The integration suite's `afterAll` leaves the draft in `setup`. After running tests, `npm run draft:start` (or ⚙ Commish → Start draft) is needed before anything works.

**Next:** `/setup` page, then deploy to preview with `SESSION_SECRET`.

---

## Steps 13 + 14 — UI restructure and /setup
**Date:** 2026-08-11  **Status:** done

**Built:** `/setup` (draft-order randomizer + manual reorder + snake preview, budget/roster/timer rules, start draft, clear PINs, reset draft), `/board` page, `commish.setLeagueSettings/renameManager/resetDraft`, `src/lib/colors.ts`.

**Three UI passes, driven by the user looking at it:**
1. *Dead space below the clock* → moved the League board into the centre column.
2. *League tab too small in the sidebar* → gave the board real width.
3. *Too much information at once* → moved the board to its own `/board` page and made the lot the centrepiece (5xl name, 9xl countdown).

The third is the one that's right, and the reason is worth recording: **bidding and studying the board are different moments.** During a lot the only things that matter are the player and the clock; between lots people want the grid. Trying to serve both in one view made both worse. `/board` keeps the live countdown pinned in its header so nobody parked there misses a lot starting.

**Colours:** the seeded hexes came from the spreadsheet and several were muddy. Replaced with a 10-colour palette that must satisfy three things at once — distinct from each other, readable as *text* on near-black, and readable as a *background* behind dark text. Ten hues can't all be far apart, so the closest pairs (green/teal, sky/indigo) are never assigned to neighbouring seats. Header text colour is computed from relative luminance, so a hand-edited colour can't produce an unreadable header.

**Learned:** A verification script reported three failures that were **the safety locks working correctly** — reorder refused because a draft was under way, budget/roster refused because picks exist. The first run looked like three bugs. Re-running with the context printed (`8 picks, status "live"`) made it obvious. **A check that doesn't report the state it ran against produces false alarms**, and a false alarm two days before a deadline costs as much as a real bug.

**Watch out for:**
- `setLeagueSettings` refuses whenever any picks exist — deliberately. Changing budget or roster size mid-draft would silently rewrite every manager's max bid and could retroactively strand someone below $1 per empty slot.
- The draft order is editable while `status='setup'` even with picks present, which is what makes "reset then re-draw" work. Once live, use swap-seats instead.

**Next:** Deployment Protection is ON — the app 302s to Vercel SSO, so the league cannot reach it. That's the last blocker and it needs the user in the Vercel dashboard.

---

## Step 15 — Destructive tests isolated onto their own database
**Date:** 2026-08-12  **Status:** done

**Built:** `neondb_test`, a second database in the same Neon project; `scripts/setup-test-db.ts`, `scripts/seed-test.ts` (deterministic synthetic pool), `scripts/guard-test-db.ts`; `test:int`, `smoke` and `dev:test` now run against `TEST_DATABASE_URL`.

**33/33 integration tests pass against the isolated database, and the live draft was verified untouched afterwards** (`status: setup, picks: 0, budgets all $200`).

**Why this mattered:** `test:int` and `smoke` delete every pick, lot, and bid. Until now only `check-idle.ts` stood between a mistyped command and an erased draft — a *warning*, not a wall. Now the dangerous case is structurally impossible: the guard exits 1 (verified) if `TEST_DATABASE_URL` is unset or resolves to the same database as `DATABASE_URL`, so the suite never starts.

**Learned — a shell subtlety that silently wrote to the wrong database:**
```sh
DATABASE_URL="$TEST" npx drizzle-kit push && npx tsx scripts/apply-sql.ts
```
The `VAR=x` prefix applies to **the first command only**. `drizzle-kit push` correctly targeted the test database, then `apply-sql.ts` ran against **production**. The failure surfaced as 31 tests erroring with `relation "manager_totals" does not exist` — the view had been created in the wrong place. Harmless here (the statement is `CREATE OR REPLACE` and production already had it), but the same mistake in a destructive script would have been the exact disaster this step exists to prevent. Fixed with `export VAR; cmd1 && cmd2`.

This is worth remembering generally: **an env-var prefix does not survive `&&`.** Every multi-command shell string that overrides a database URL must use `export`.

**Decisions:**
- The test database is seeded with a **synthetic** 200-player pool rather than the real FantasyPros CSV, so the suite is reproducible on any machine and doesn't depend on a file on someone's Desktop (or redistribute FantasyPros' data).
- `check-idle.ts` is kept as a secondary check but is no longer the primary defence.

**Watch out for:**
- `npm run db:test-migrate` must be re-run after any schema change, or the test database drifts from production.
- `.env.local` now carries `TEST_DATABASE_URL`. It is not set in Vercel and must not be.

**Next:** Thursday's dress rehearsal. The 2026 draft order is still to be drawn — the user is doing that on Friday.

---

## Step 17 — The 2026 draft finished, and seasons (BACKLOG §2)
**Date:** 2026-08-15  **Status:** done

**Built:** `scripts/backup.ts` (`db:backup`), `scripts/record-picks.ts` (`draft:record`),
`scripts/migrate-seasons.ts`, `scripts/new-season.ts` (`season:new`), `scripts/list-seasons.ts`
(`season:list`); `season` on `draft`/`picks`/`lots`/`trades`/`budget_adjustments`; player snapshot
columns on `picks`; new `season_orders` table; season-scoped `manager_totals`;
`src/server/archive-service.ts` + `/api/archive`; year picker on `/board`;
`src/server/season-archive.itest.ts`.

**64 unit + 53 integration tests passing** (13 of them new), `db:verify` green, `next build` clean.

**The draft is complete.** The last 8 picks were bought in the room but never entered, because of
the P0 nomination stall in BACKLOG §9 — Mario ×3, Eric/Blakey ×1, Nate ×1, Daniel ×3, all at $1.
Recorded through `draft:record`, which bypasses *whose turn it is* and nothing else: it opens a
real lot and runs the same award statement, so the max-bid rule was still enforced by the database.
160 picks, every roster at 16, status flipped to `done`.

**Decisions:**
- **A `season` integer, not a `drafts` table.** The backlog called this and it held up — ten
  people will never run two drafts in one year, and a foreign key would have meant touching every
  query anyway.
- **Name/team/position are copied onto the pick at award time.** The archive reads only those, never
  a join to `players`.
- **`season_orders` snapshots `display_name` and `color` alongside the seat**, not just the slot.
  Same argument as the player snapshot: `managers` is mutable, and a rename would silently
  re-label a finished draft.
- **`/api/archive` is its own route**, not a parameter on `/api/board`. `/api/board` is on the
  draft-night hot path and ships the 500-row live pool; browsing 2026 during the 2027 draft must
  not touch it.
- **Backups are committed to git.** `backups/*.json` is a whole-database snapshot, ~200KB. The
  archive is the feature; a copy outside Neon is the insurance, and the backlog was explicit that
  the export should happen *before* anything else got built. Two snapshots are in the repo: one
  taken before the migration, one after.

**Learned:**

- **The unique index was the load-bearing part, and it is not obvious.** `picks_player_idx` was
  `UNIQUE (player_id)` — globally. Season columns everywhere would still have left every player
  drafted in 2026 permanently undraftable, i.e. an accidental keeper league, and the failure would
  have surfaced as "why can't I nominate Ja'Marr Chase" in July 2027. It has to become
  `UNIQUE (season, player_id)`, and `awardLot`'s `ON CONFLICT (player_id)` has to move with it or
  the award statement throws at runtime.
- **An old migration script is a loaded gun once a view changes.** `migrate-called-auction.ts` ends
  with a hardcoded `CREATE OR REPLACE VIEW manager_totals` — the pre-season version. Running it
  after `migrate-seasons.ts` would have silently stripped the season filter, and *nothing would
  error*: budgets are derived, so there is no stored number to look wrong. It now refuses to run if
  `draft.season` exists. Any migration that hardcodes a view definition needs this guard.
- **`check-idle.ts` counted picks globally**, so once a season is in the books it would have sat at
  160 forever and blocked `test:int` permanently. Every "is a draft under way?" heuristic built on
  a row count needs the season filter too — the count is no longer a proxy for "something is
  happening now".
- **`@neondatabase/serverless` v1 `sql` is tagged-template-only.** A plain `sql("SELECT ...")` call
  throws with a message about placeholders that reads like a SQL problem. `sql.query()` is the
  escape hatch when the table name is dynamic — `backup.ts` needs it to loop over tables.
- **The three-way disagreement to watch for:** `manager_totals.rostered` summed across managers must
  equal `COUNT(picks WHERE season = current)`. `db:verify` asserts exactly that, because it catches
  a missed filter in *either* direction, and it is the cheapest possible check for the one bug that
  would otherwise be invisible until draft night.

**Watch out for:**

- **`draft:reset` is still destructive and still exists.** It is now scoped to the current season
  and refuses over 30 picks without `--force`, and the `/setup` button is relabelled "Erase 2026
  draft" with the `season:new` command in the confirm dialog. It is no longer the documented way to
  prepare for a new year — `season:new` is — but somebody who remembers the old workflow will still
  reach for it.
- **`season:new` does not re-import the pool or re-draw the order.** It prints both as next steps.
  Drafting 2027 against 2026's rankings would work and be wrong.
- **Bye weeks are null in the archive, deliberately.** They belong to a season that is over, and the
  only place to get them is today's pool — which is the exact join the archive exists to avoid.
- The `/board` year picker only lists seasons that have picks, plus the current one. A season rolled
  forward and never drafted shows as the current tab and nothing else.

**Next:** BACKLOG §9's P0 — `nominatorAt` runs out of index budget and stalls the draft near the
end. It is the reason the last 8 picks needed a script, and it will recur every season.

---

## Step 18 — The P0 stall fixed, and backlog §3–§6
**Date:** 2026-08-15  **Status:** done

**Built:** `slotRows` / `extraBenchRows` / `pickInRow` and `positionMarket` in `src/lib/draft.ts`;
rewritten `nominatorAt`; `onDeck` on `DraftState`; a real completion panel in `LotPanel`;
`RoomMoney` in `SidePanel`; `src/components/MarketPanel.tsx`; `player_queue` +
`src/server/queue-service.ts` + `/api/queue` + `src/hooks/useQueue.ts` + a reworked `PlayerPool`;
`scripts/migrate-queue.ts`.

**81 unit + 64 integration tests passing** (10 unit and 11 integration of them new),
`db:verify` green, build clean.

### The board was hiding players it had been paid for

Nate and Mario both finished 2026 without a defense. The grid has a fixed DEFENSE row and six
bench rows, so with 16 players and no DEF, `autoSlot` returned one player in `overflow` — and
**`LeagueBoard` never read `overflow`.** Two managers each had a player they bought that simply was
not on the board, and the same blind spot existed in the sidebar's My Roster. The grid now grows a
bench row (17 rows for 2026) sized to the worst roster on screen, so every column keeps the same
rows. Verified against the real archive: all ten managers now draw 16 of 16.

`autoSlot` had returned `overflow` since step 4 specifically so a paid-for player could never be
dropped — the value was correct and the caller ignored it. **A safe return value nobody reads is
the same as not having one.**

### P0: the draft-stalling index cap

`nominatorAt` capped its search at `n * rosterSize + n` and returned "draft complete". That is the
bug that stopped the 2026 draft with 32 picks left. Now it asks the real question — *is anybody
unfilled?* — and scans forward with no cap, over a `2n` window.

**Learned, and this is the part worth keeping:** the two draft shapes that pass under the old code
are the two anyone would write a test for. A perfectly even draft never skips anyone and finishes
at index 160; a mildly lumpy one finishes at exactly 170, *landing precisely on the cap*. Only the
realistic skewed shape fails. I confirmed this by reverting the fix and re-running: 4 of the 7 new
tests fail, and the two "obvious" ones are not among them. A test suite that only covers the tidy
cases would have shipped this bug twice.

### Backlog items

- **§3 average remaining budget** — two numbers in the Budgets panel: mean budget, and dollars per
  open slot. Both exclude full rosters, because a manager at 16 cannot bid and their money will
  never chase another player. Pure render, no schema, no API change.
- **§5 on deck** — one name, from a second `nominatorAt` call at `turn.index + 1`. Never a second
  copy of the snake maths. Shown on the lot panel and in the turn banner, and it says "(again — the
  order turns here)" when the snake doubles back, which is the case that confuses the room.
- **§6 market by position** — QB/RB/WR/TE only, on `/board` behind a Board/Market toggle, plus a
  compact own-spend line in My Roster. It groups on `players.position`, never the display slot.
  Real 2026 numbers: QB median $14, RB $7, WR $7, TE $3 — the median/mean gap is large (RB mean is
  $13.4 against a $7 median), which is exactly why the backlog called for medians.
- **§4 private queue** — a `player_queue` table, a session-scoped route, and a star on each pool row.

**Learned:**

- **The star had to be a sibling of the row button, not a child.** A button cannot nest inside a
  button, and the row is `disabled` when it isn't your turn — which is precisely when someone builds
  a queue. The row is now a flex container holding two independent buttons, which is what makes the
  star live while the row is dead.
- **The queue's privacy is provable and is now proven.** Two integration tests assert the things
  that would be invisible otherwise: that `JSON.stringify(getState())` contains no queued player id,
  and that three queue edits leave the polling fingerprint byte-identical. The second is the one that
  keeps a private edit from waking all ten clients.
- Queue entries are **not** deleted when a player is drafted — they are flagged and struck through,
  with a count and a Clear button. A list that quietly empties itself reads as a bug.
- `react-hooks/set-state-in-effect` (Next 16's lint) rejects calling a `useCallback` that sets state
  from an effect body, even when the set happens after an `await`. Inlining the fetch so the
  `setState` lives in a `.then` callback satisfies it and is no worse to read.

**Watch out for:**

- **`extraBenchRows` is computed across the managers being displayed**, so the grid is as tall as
  the worst roster. One manager skipping a defense adds a row for everyone. That is deliberate — a
  ragged grid is worse — but it means the board's height is data-dependent.
- **The queue must stay out of `/api/state` and out of `src/lib/version.ts`.** There are tests for
  both, and they are the only thing standing between a private shortlist and a public one.
- `positionMarket` deliberately excludes K and DEF. Adding them back would drag every median toward
  $1 and make the table useless.
- The completion panel keys off `status === 'done'` **or** every roster being full. `setStatus` is
  still only called by hand and by `draft:record`, so the second condition is what actually fires in
  practice.

**Next:** §9's P2 — `voidLot` and `undoPick` decrement `nomination_index` by exactly 1, which lands
mid-skip-run rather than back on the seat that nominated. It self-heals and did not cause the stall,
but "undo" does not reliably hand the turn back to the right manager.

---

## Step 19 — `/stats`, and the rank snapshot that had a deadline
**Date:** 2026-08-16  **Status:** done

**Built:** `picks.player_rank` / `player_pos_rank` + `scripts/migrate-pick-ranks.ts`;
`src/lib/stats.ts` + `stats.test.ts`; `src/hooks/useSeasonView.ts` + `src/components/SeasonPicker.tsx`
(extracted from `/board`); `src/app/stats/page.tsx` with four panels under
`src/components/stats/`.

**122 unit + 66 integration tests passing** (41 unit and 2 integration new), `db:verify` green,
build clean.

Backlog §7 plus three views it never considered — all four checked against the real 2026 data
*before* building, so none of them is merely computable:

| View | What 2026 shows |
|---|---|
| Teams | Mario $110 on RB vs Bolek $39; Daniel $80 on QB vs Mario $35 |
| Pace | Average price decays $34.1 → $1.1 across eight blocks of 20 |
| Nominations | Jack won **14%** of what he put up and drove **$142** to rivals; Daniel and Bolek 50% |
| Value | McCaffrey a $9 bargain, Mahomes an $11.50 overpay; team nets −$21 → +$35 |

### The bit with a deadline

`picks` snapshotted name/team/position but **not rank**, so a finished season's ranks were
recoverable only by joining `players` — and that join dies the moment the next rankings CSV is
imported, because the pool is replaced wholesale and `players.id` is not stable across seasons.
Verified 160/160 of the 2026 picks still resolved, and captured them. **A day later and after a
2027 import, this feature could never have been built for 2026 at all.** Same lesson as step 17's
name/team/position snapshot, arriving one column late.

The migration scopes its backfill to `draft.season` rather than a hardcoded 2026, so it stays
correct after every future draft instead of correct once.

**Learned:**

- **A naive "value" metric doesn't measure value, it rediscovers the league's format.** First pass
  benchmarked each price against similarly-ranked players *overall*. Every one of the top overpays
  came out a QB and every bargain a WR — because FantasyPros rank is overall and this is a
  superflex league, where QBs are worth far more than that rank implies. Comparing **within
  position** removed it (net by position QB +8 / RB +26 / TE +9 / WR +9) and produced sensible
  names. There is a unit test with a superflex-shaped fixture that fails if anyone "simplifies"
  this back to a cross-position comparison.
- **A flat per-position median doesn't work either** — price decays steeply with rank inside a
  position, so it would brand every QB1 an overpay. Nearest-neighbours within the position is the
  only shape that works.
- **The residual bias is at the ends and is documented rather than hidden.** The top-ranked player
  at a position has nobody above them, so their window comes entirely from below and a decaying
  market makes them look expensive. Dropping them would remove exactly the players the room argues
  about. On real data it stayed small — no rank-1 player reached the top overpays.
- **`budget_adjustments` cannot recover who originally bought a traded player.** A trade writes one
  combined row per manager folding salary *and* cash together, so they are inseparable afterwards.
  The trade log is the only surviving source, so `draftersByPick` walks it newest-first and rewinds.
  Every money view attributes through it, which is what stops a November trade retroactively
  rewriting who won their own nomination in August.
- **A spend matrix and a market view want different position lists.** `MARKET_POSITIONS` drops K and
  DEF because they'd drag every median to the floor — right for a market, wrong for a budget table,
  where a row that doesn't total what someone spent is a lie. Hence `SPEND_COLUMNS` with an OTHER
  bucket.
- **Next 16's lint rejects components defined during render** (`react-hooks/static-components`), so
  the shared `<Row>`/`<Head>` helpers inside `ValuePanel` had to be hoisted to module scope and take
  their data as props.

**Watch out for:**

- **Two different things are now called `rank`.** `BoardPlayer.rank` is today's pool;
  `RosterPick.rank` / `ArchivePick.rank` are frozen at award time. Both declaration sites say so.
- **`/api/board` reads rank from `pk.`, never the joined `p.`** — one source of truth, so live and
  archive cannot disagree and a mid-draft pool re-import cannot move the benchmark under a running
  draft. Do not "fix" it into a COALESCE.
- **`archive-service.ts` selecting `player_rank` looks like a violation** of that file's never-join-
  `players` rule. It isn't — it's the pick's own column — and there's a comment saying so.
- **There were two write paths to snapshot**, `awardLot()` and `scripts/record-picks.ts`. The second
  has no test coverage; miss it and out-of-band picks are silently unscorable forever.
- **The Value view is gated on every roster being full**, using the same "is anybody unfilled?"
  definition as `nominatorAt` rather than `status === 'done'`, because the status flag is set by
  hand and an archived season has no live status. It renders an explanatory empty state rather than
  hiding the tab.
- **2026's nomination numbers carry a small known bias**, noted on the panel itself: the 8 picks
  repaired via `draft:record` recorded the buyer as their own nominator, inflating "won own" for
  Daniel, Mario, Nate and Eric/Blakey.
- `npm run test:int` wipes the test database, so any hand-seeded demo state has to be rebuilt
  afterwards.

**Next:** §9's P2 (the `nomination_index` decrement), and §7's cumulative-spend curve, which was
deliberately deferred — it is the only view that would need a new visual primitive.

---

## Step 20 — Draft-screen pass: order strip, sortable picks, $/slot, roster header
**Date:** 2026-08-16  **Status:** done

**Built:** `upcomingOrder()` in `src/lib/draft.ts` + tests; `src/components/NominationOrder.tsx`;
`perSlotLeft()` in `src/lib/stats.ts`; rebuilt `MyRoster`, `Budgets` and `PickLog` in
`SidePanel.tsx`; reworked the draft page's banner and ticker.

**130 unit tests passing**, build clean, `db:verify` green.

Four things the user asked for after looking at the live screen:

### The bottom ticker was carrying too little

It showed recent picks and nothing else, and the read was that it wasn't earning its space. Rather
than replace it, the two jobs got split by direction: **what happens next goes above the lot, what
already happened stays below it.** The old thin "On the clock: X · on deck: Y" banner became a full
order strip showing the current nominator plus the next nine; the ticker below kept recent picks but
gained a position badge and manager colour so it scans.

Worth recording *why* the strip is honest about itself: only the first two names are certain.
Everything after assumes rosters stay as they are, and a manager who fills their 16th slot drops out
and shuffles the rest up. That is exactly right for most of a draft — nobody is full early — and
drifts at the end. So the tail is dimmed and labelled "after the next two, projected" rather than
presented as fact. Backlog §5 argued for showing only *one* name for this reason; showing ten with
the uncertainty drawn on is the better trade, but the uncertainty is real and had to be visible.

The strip also makes the snake turn legible for the first time — "Justin R9 › Justin R10" reads as
deliberate once the round number is next to the name, where before the same name twice in a row just
looked like a bug.

### The rest

- **Picks tab** gained position filters (with counts, and disabled when a position has none) and
  sortable `#` / `Player` / `$` columns. Default is still newest-first.
- **Budgets tab** gained `$/slot` — budget divided by roster spots still to fill, which is the
  number that says whether someone can actually compete for the next player. The old "Avg" (average
  price paid) column was dropped to make room: `$/slot` is strictly more useful mid-draft and the
  average is on `/stats`.
- **My Roster** header was genuinely confusing: two rows of near-identical chips where `QB 3` was a
  count and `QB $63` was dollars, plus a totals chip that `ml-auto` shoved onto a third line as soon
  as it wrapped. Now one summary line (players / spent / left) and one chip row combining count and
  spend per position.

**Learned:**

- **`w-full max-w-0` is a one-column trick.** It is the Tailwind pairing that makes a table cell
  absorb leftover width and truncate — but applied to two competing cells it collapses *both*. The
  picks table shipped a screenshot with every player name rendered as a single character before I
  caught it. Exactly one flexible column; everything else fixed.
- **Six columns do not fit a 19rem sidebar.** Adding `$/slot` silently clipped the last column off
  the right edge, which no test would ever catch — only looking at it did.
- Next 16's `react-hooks/static-components` rule bites again for tiny render helpers: the sort-arrow
  had to be hoisted to module scope, same as `ValuePanel`'s row helpers last step.

**Watch out for:**

- **`upcomingOrder` deliberately does not simulate purchases.** It cannot: who wins the next lot is
  unknown. Anyone "improving" it by advancing roster counts would be inventing data.
- The order strip renders for `status !== 'setup'`, so it is present while paused and while a lot is
  open — that is intentional, since knowing who is after the current lot is most useful *during* it.
- `perSlotLeft` is now the single definition shared by the Budgets panel and `/stats`; changing one
  changes both, which is the point.

**Next:** unchanged — §9's P2, and the cumulative-spend curve.

---

## Step 21 — Undo hands the turn back, and the draft knows when it is over
**Date:** 2026-08-17  **Status:** done

**Built:** `lots.nomination_index` + `scripts/migrate-lot-index.ts`; rewrote `voidLot`,
`undoLastPick` and `skipNominator` in `commish-service.ts`; the auto-`done` flip in `awardLot`.
Backlog §9 P2 and the rest of §9 P1.

**130 unit tests and 72 integration tests passing**, `db:verify` green, migration applied to both
databases.

### §9 P2 — the cursor is not the seat

`nomination_index` is a cursor that `nominatorAt` scans *forward* from; the seat it lands on can be
several indices later, because full rosters are skipped on the way. Nomination then parks the cursor
at **landed + 1**. So the distance a nomination moves the cursor is not 1, and `- 1` cannot undo it.

Worth writing down what I got wrong first: I assumed the bug was visible in a single
nominate-then-void, and it is not. In that sequence `- 1` returns the cursor to the landed index,
`nominatorAt` finds that seat unfilled, and the right manager is on the clock. **The shortest
sequence that actually breaks is two undos in a row across a skip run**, which is now the test:
seat 0 nominates at index 0, the next nomination skips four full rosters to land at index 5, and the
cursor is at 6. First undo → 5 → seat 5, correct. Second undo → 4 → a *full* seat → the scan skips
forward and returns seat 5 **a second time**. Seat 0 never gets their turn back.

The fix is to stop deriving and start recording: `lots.nomination_index` stores the index the lot
was opened at, and void/undo restore it exactly. Nullable, with `COALESCE(..., GREATEST(0, idx - 1))`
falling back to the old behaviour for the 160 lots from 2026 that predate the column.

**The migration deliberately does not backfill.** The index a 2026 lot was nominated at is *not*
recoverable: `draft.nomination_index` is one moving cursor with no history, and skipped seats mean
pick order cannot be replayed onto it. A guessed backfill would look exactly like a real one and
would send undo to a plausible wrong seat — worse than NULL, which at least selects the old
behaviour honestly.

### The same bug on the skip path, found while fixing it

`skipNominator` did `nomination_index + 1`. With the cursor at 1 and seats 1–3 full, seat 4 is on
the clock; +1 moves the cursor to 2, which still resolves to seat 4. **The skip button does nothing,
repeatedly, in front of the room.** It now advances past `onTheClock.index`, the same way `nominate`
does. This was never reported from draft night, which is its own lesson — it fails silently and
looks like a mis-click.

### §9 P1 — the flag now agrees with the screen

`awardLot` flips `draft.status` to `'done'` when the award fills the last slot in the league, guarded
on `status = 'live'` and asking `manager_totals` "is anybody below `roster_size`?" — the same
definition `nominatorAt` uses, not a pick count, so it stays right after a trade.

**Nothing was changed to trust the flag.** `stats.ts` and `LotPanel` still ask the roster question
directly, because an archived season has no live status and a commissioner can still set it by hand.
This makes the flag a *record* that the draft finished, not a source of truth.

**`undoLastPick` had to flip it back**, and that is the part that would have bitten later: 'done'
refuses nominations, so undoing the final pick without reopening the draft would leave the league one
player short and permanently unable to draft them. It is folded into the same statement.

### Both rewinds became single statements

`undoLastPick` was three statements (delete pick, void lot, move cursor) and `voidLot` was two.
Both are now one data-modifying CTE, per the Neon rule in AGENTS.md — a void that half-applied
would cancel a lot without returning the turn, which in the room reads as the app skipping someone.

**Learned:**

- **A cursor and the thing it points at are different values, and mixing them is a whole bug
  family.** Three functions had it: void, undo, and skip. Anywhere that does arithmetic on
  `nomination_index` instead of reading `onTheClock.index` is suspect.
- **Reason about the shortest failing sequence before writing the test.** I nearly wrote a
  single-void test, which passes against the *old* code and would have shipped the bug with a green
  suite behind it — the same trap step 18 recorded for the P0 stall, where the two obvious draft
  shapes both passed.
- **An `OFFSET` into a fixture pool fails open.** `OFFSET 400 LIMIT 159` against 503 players silently
  inserted 103 rows and left four seats unfilled, and the test failed several assertions later with a
  confusing message. Assert the inserted row count.

**Watch out for:**

- **`lots.nomination_index` is NULL for every 2026 lot** and for any lot opened before this deploy.
  The `COALESCE` fallback is load-bearing, not decorative — do not "simplify" it away.
- **`awardLot` now returns `draftComplete`.** Nothing renders it yet; the screen still derives
  completion from rosters, deliberately.
- `skipNominator` now reads `getState()`, so `commish-service` imports from `draft-service`. That
  direction only — `draft-service` must not import back.

**Next:** §7's cumulative spend curve and the sidebar positional split, then §4's queue reorder and
nominate-from-queue, then §2's cross-import player identity.

---

## Step 22 — The spend curve, and where everyone's money went
**Date:** 2026-08-17  **Status:** done

**Built:** `spendCurve()` in `src/lib/stats.ts` + 6 unit tests; `src/components/stats/CurvePanel.tsx`
behind a new **Curve** tab on `/stats`; `SpendSplit` in `SidePanel.tsx`. Backlog §7's two remaining
items — the cumulative curve that was deliberately deferred, and the per-manager positional split on
the draft screen.

**136 unit tests passing**, build clean, lint clean.

### The curve is small multiples, not ten lines

Ten overlapping series is spaghetti at any size. The league palette passes every colour-separation
check (I ran the validator: worst adjacent pair ΔE 10.2 under protanopia, 17.8 normal vision) but it
was designed to label **columns on a wide grid**, not to disambiguate ten crossing lines. So: one
small panel per manager, all sharing the same axes so the shapes compare directly, each one named —
identity never rests on colour.

The league total gets its own full-width chart **with a straight reference line from origin to final
total**. That line is the whole design: a cumulative curve on its own only ever goes up and says
nothing. The gap to the reference is the finding.

Checked against the real 2026 draft before calling it done, since there is no browser here to look
with — an ASCII render of the same function:

```
cumulative % of league spend:  pick 16 → 29%   pick 48 → 68%   pick 96 → 91%
Gabes  $200  ½ by pick 15      Bolek  $200  ½ by pick 41
```

**68% of $1,993 was gone by pick 48 of 160.** The room front-loads hard, and the halfway-pick spread
(15 to 41) is real variation between managers — so the view has something to say rather than ten
identical ramps.

### Steps, not a line

A manager's total only changes when *they* buy. Drawing a smooth line through their picks would
render money leaving the room during picks that belonged to somebody else. `stepPath` is step-after,
and extends flat to the final pick so somebody who stopped buying shows a long flat tail rather than
a line that ends early and reads as missing data.

### The sidebar split had to be a bar, not a table

§7 warned that the 10 × 4 matrix does not fit a 19rem sidebar, and step 20 proved it by clipping a
column off Budgets just by adding a sixth. A stacked bar costs **no columns** — it rides under the
manager's name in the cell that already exists.

**The colour ordering is load-bearing and was not obvious.** Running the palette validator on the
position tints from `PositionBadge` turned up rose (QB) against emerald (RB) at **ΔE 4.6 under
deuteranopia** — below even the 6–8 "legal with secondary encoding" floor. `PositionBadge` is fine
because it carries the position as *text*; a 4px bar has no room for a label. Interleaving the
segments to `WR · QB · TE · RB · K/DEF` lifts the worst adjacent pair to 10.6 and costs nothing.
This is the same trick, for the same reason, as `SEAT_ORDER` in `src/lib/colors.ts` — which the
codebase had already worked out once for seats and I nearly re-learned the hard way.

**Learned:**

- **Run the palette validator even on colours the codebase already uses.** The QB/RB pair has been
  on screen since the first build and is perfectly safe *there*, because it is always labelled. The
  same two hues in an unlabelled bar are a real accessibility defect. Safety is a property of the
  mark, not of the hex.
- **A stacked bar showing proportion must not be scaled to a league peak.** Each bar fills its own
  width; scaling to the biggest spender would make every early-draft bar an invisible sliver, and
  the $ columns directly above already answer "how much".
- No headless browser is available in this environment, so the curve was verified numerically
  against the live 2026 data rather than by looking. **The geometry still wants an eyeball** — see
  below.

**Watch out for:**

- **`spendCurve` attributes to the drafter via `draftersByPick`**, like every other money view. There
  is a unit test that fails if that is "simplified" to `pick.managerId` — a trade would otherwise
  redraw two managers' whole curves from the trade onward.
- `SPLIT_SEGMENTS` order is a colour-vision fix, not a display preference. Re-sorting it to match
  `SPEND_COLUMNS` reintroduces the ΔE 4.6 pair.
- The SVGs use `preserveAspectRatio="none"` with `vector-effect="non-scaling-stroke"`: the plot
  stretches to the container and the 2px lines stay 2px. Dropping the vector-effect makes strokes
  scale with the box and go fuzzy at small panel sizes.

**Next:** §4's queue reorder and nominate-from-queue, then §2's cross-import player identity.

---

## Step 23 — The queue reorders, and nominates
**Date:** 2026-08-17  **Status:** done

**Built:** `reorderQueue()` + a `reorder` action on `/api/queue`; optimistic `reorder` in
`useQueue`; drag handles and a per-row **Nominate** button in `PlayerPool`. Backlog §4's two
remaining items — the last of §4 is now closed.

**136 unit tests, 78 integration tests passing** (6 new, all on reorder), build and lint clean.

### Reorder sends the whole order, not a move

"Move this one to index 3" has to be applied against a base the server also has, and two quick drags
race. Sending the full list means the last request simply wins, and there is nothing to reconcile.

**The interesting bug was found by a test I nearly did not write.** The first implementation wrote
`sort_order` only for the ids it was given, which is correct whenever the client's list is complete —
and the client's list *is* complete, until it isn't. A star added in a second tab, or between the
fetch and the drop, leaves one entry unnamed; the positions the reorder writes then **collide with
the ones it left alone**, two rows share a `sort_order`, and the order is settled by the `q.id`
tiebreak rather than by the person who just dragged. It would have looked like an occasional
mysterious re-shuffle and been nearly impossible to reproduce on purpose.

So a reorder now renumbers the **whole** queue in one statement: named entries take positions 1..n,
and anything unnamed keeps its relative order at `UNNAMED_BASE + rank` — behind them, which is
exactly where a newly starred player would have been anyway.

### Privacy holds on the write path too

`reorderQueue` filters on the session manager id like everything else here, so ids the caller does
not own match no row. The test asserts the stronger property: it returns `moved: 0` rather than
reporting how many of the sent ids existed. A count would have been a working oracle for reading
somebody else's queue one id at a time.

### Nominate straight from the shortlist

The ★ view already showed the list; selecting from it still went through the pool's
select-then-confirm tray. Queue rows now carry their own **Nominate** button when it is your turn.

Deliberately a distinct labelled button rather than making the row itself one-tap: the row gesture
means "select" everywhere else in the pool, and a mis-click that puts the wrong player on the block
in front of the room needs the commissioner to void it. One tap from a list you built on purpose is
the payoff; one tap from a 500-row pool would be a hazard.

**Learned:**

- **"The client always sends the full list" is an assumption, not a guarantee**, and the failure it
  produces is a silent tie rather than an error. Any partial-update statement wants a test that
  feeds it a partial input.
- **A count can be an oracle.** Returning how many of the given ids matched would leak the contents
  of another manager's queue to anyone willing to send one id at a time — the same class of leak §4
  exists to prevent, arriving through the write path instead of the read path.
- Optimistic reorder is worth the extra code here: waiting on the round trip snaps the dragged row
  back for ~200ms, which reads as a failed drag and invites a second drag on top of the first.

**Watch out for:**

- **Dragging is offered only when the queue filter is on and the search box is empty** (`canDrag`).
  Indices are positions in the queue, so reordering a filtered subset would move entries relative to
  rows that are not on screen.
- `UNNAMED_BASE` is 1,000,000 against a queue capped at 60. It is a sentinel, not a magic number to
  tune — the gap is what makes a collision impossible.
- The **Nominate** button is gated on `filter === 'QUEUE' && canNominate && !p.gone`. Loosening the
  first condition puts a one-tap nomination beside all 300 pool rows.

**Next:** §2's cross-import player identity — the last open item that is not §1 or §8.

---

## Step 24 — Sunday Broadsheet: the app gets a visual identity, and a light theme

**Date:** 2026-08-17  **Status:** done

**Built:** the whole app reskinned as a sports page — **Broadsheet** on newsprint (`#f2ede3`) in
light, **Late Edition** on press-black (`#17150f`) in dark. New type: Oswald (condensed gothic) for
heads and labels, Source Serif 4 for body, Geist Mono for agate. `managers.color` became
theme-aware. The runner-up direction is parked with its palette in **BACKLOG §10**.

**149 unit tests passing**, typecheck and build clean, smoke-tested against the live database.

### The complaint was "it looks like every other website", and it was correct

The board wore Tailwind's factory setting — `slate` ground, `emerald` accent, `rounded-lg`
everywhere. That is the house style of roughly every dark-mode SaaS app, and swapping the hue only
produces a different anonymous app. The fix had to come from type and structure, not colour.

### The ramp is semantic by POSITION, which is what makes one theme flip into two

~4,200 lines of TSX hardcode `bg-slate-950` / `text-slate-100`. Rather than touch any of it, the
built-in scales are redefined in `globals.css` and the ramp is read as a role, not a lightness:

```
slate-950 page · 900 panel · 800 raised+rule · 700 strong rule
600/500 muted · 400/300 secondary · 200/100/50 primary text
```

**Light mode inverts that ramp** — 950 becomes the lightest value, 100 the darkest. So
`bg-slate-950 text-slate-100` is correct in both themes with zero component changes. The light
values in the file look upside-down and are not.

The **accent** ramps deliberately do *not* invert: `emerald-600` and friends stay dark fills in
both themes because they carry `text-white`. Only `emerald-100` and `rose-200` stay light, for the
one reversed-chip pattern in the test console.

The same trick squared the corners. Zeroing `--radius-*` in `@theme` flattens every
`rounded-sm|md|lg|xl|2xl|3xl` at once, while `rounded-full` — a static utility, not a scale entry —
keeps dots and progress bars round. Boxes go square, circles stay circles, no component edits.

### The palette was generated and validated, not eyeballed

A script defines both themes, checks every pairing the app actually uses, and emits the CSS. It
caught nine real failures on the first run — the muted tiers on raised surfaces, white text on
hover fills, `text-X-300` on its own `/15` wash in light mode, and a rule so close to the ground it
was invisible. Rather than tune-and-squint, the source of truth is the validated table.

### `managers.color` was the real cost of a light theme, exactly as predicted

The ten hues live in the **database**, are tuned for a dark ground, and vanish on newsprint. They
also satisfy four constraints at once (ten distinguishable, readable as text *and* as a fill behind
their own ink, never colour-alone). So there are now two sets, as `--mgr-*` variables that swap on
`prefers-color-scheme`, and `managerColor()` maps the stored hex to the variable **once, at the
serialisation boundary** in `draft-service` and `archive-service`. Every component that does
`style={{ color: m.color }}` became theme-correct without knowing any of this exists.

**Learned:**

- **A colour comparison has to be rendered, not described.** Three rounds of prose got nowhere; one
  page showing the same board under four palettes settled it in minutes. The decisive artifact was
  the *same markup* under swapped tokens — anything else compares layout as well as colour.
- **The generator caught a bug that reads as correct.** The ink-picker chose text for a manager
  swatch from the theme-inverted `slate` ramp, so light mode put near-black text on near-black
  fills. Ink laid ON a colour must be picked from *that colour's own* luminance, absolutely — it is
  the one value in the system that must not follow the theme.
- **`textOn`'s old 0.45 threshold was already failing AA.** White on `#f87171` is 2.8:1, and that
  has been shipping. 0.25 puts near-black on all ten, which is both correct and what the mockups
  had.
- **Hex-alpha string concatenation is a trap that only springs later.** `` `${m.color}33` `` worked
  for a year and produced silent garbage the moment the colour became a `var()`. `color-mix()`
  takes either.
- Geist was being downloaded and never rendered — `globals.css` overrode `body` with
  `Arial, Helvetica, sans-serif`, straight from `create-next-app`. Worth grepping for the
  boilerplate you inherited rather than assuming it is inert.

**Watch out for:**

- **The light ramp is inverted on purpose.** `--s-950: #f2ede3` is not a typo. Anyone "fixing" it
  to a dark value inverts every page at once.
- **`--mgr-*` has two sets that must stay in sync.** Adding an eleventh manager colour means adding
  it in three places: `PALETTE` in `colors.ts`, and both blocks in `globals.css`. Miss the light
  block and that manager is invisible on newsprint.
- **`colorForSeat()` must keep returning a raw hex.** It is what gets written to `managers.color`,
  and that value has to survive outside a browser — exports, scripts, `db:verify`. Only
  `managerColor()` returns a `var()`.
- **`var()` does not reliably resolve in an SVG presentation *attribute*.** `CurvePanel` had
  `stroke={color}` and now goes through `style={{ stroke: color }}`. Any new SVG that takes a
  manager colour has the same constraint.
- **`.uppercase` carries the display face** by a rule in `globals.css`, because in this app every
  use of it is a label or badge. Set body copy in caps and it will come out gothic — add
  `font-sans` to opt out.
- **The drawer scrim stays `bg-black/50`.** It has to darken the page in *both* themes, so it is
  one of the few colours that must not follow the palette. `bg-slate-950/70` is wrong: slate-950 is
  *light* in the light theme, and the scrim stops dimming anything.
- **Neither theme has been checked on a phone, or by anyone but the build.** The contrast maths is
  verified; how newsprint actually reads in a dim room on draft night is not.

**Next:** BACKLOG §9 P2 — `voidLot`/`undoPick` decrementing the nomination index by exactly 1.

---

## Step 25 — A player identity that survives the season
**Date:** 2026-08-17  **Status:** done

**Built:** `playerMatchKey`, `normalizeTeam` and `resolveSleeperIds` in `src/lib/sleeper.ts` + 15
unit tests; `players.sleeper_id` and `picks.player_sleeper_id`;
`scripts/migrate-player-identity.ts`; `src/lib/player-overrides.ts`; identity resolution wired into
`seed.ts` and the snapshot into `awardLot`. Backlog §2's last open item, and the hard half of §1.

**149 unit tests, 78 integration tests passing**, lint clean.

### The problem, restated

`players.id` is a Sleeper id when synced from Sleeper and a derived slug when imported from a CSV —
and the CSV is the *recommended* path, so in practice the pool is keyed by slugs no other system has
heard of. The pool is re-imported every season, so nothing survives a year boundary: "what did this
player cost in 2026 vs 2027" had nothing to join on, and a news provider had nothing to look a
player up by.

`sleeper_id` is now that key. `players.id` keeps its exact current meaning, so nothing that
references it changed.

### The matcher refuses to guess, and that is the feature

Tiers, most specific first: **defenses on team code only** (Sleeper synthesises "PHI Defense" and
keys by abbreviation; a CSV says "Philadelphia Eagles" — those never match as strings and the code
always does), then name+position+team, then name+position **only when exactly one Sleeper player
has that key**.

Two players sharing a name and position is precisely where a wrong answer is worse than no answer:
it would silently attribute one player's price history to another, and look completely plausible.
There is a test for the negative, and one for the subtler version — a third same-named player must
not *un*-poison an already-ambiguous key.

### The real backfill found a real bug

First run against live: **497 of 503 players, 159 of 160 picks.** The single miss was the
Jacksonville defense. FantasyPros writes `JAC`, Sleeper writes `JAX`.

That is not an override-table entry, it is a systematic divergence that would recur every year for
the same team — and because **defenses match on team code alone**, a spelling difference there is a
*guaranteed* miss rather than a probable one. So `normalizeTeam` and a `TEAM_ALIASES` map went in
(plus the relocations, SD/STL/OAK, for archived seasons). Second run: **160 of 160 picks, 498 of
503 players.**

The 5 unresolved pool players are correct — they are CSV entries with no live Sleeper counterpart.

### Why this one backfills when step 21's did not

Step 21 refused to backfill `lots.nomination_index` because it was unrecoverable: one moving cursor,
no history, any value a guess dressed as a fact. This one is a **derivation, not an invention** —
`picks` already snapshots name, team and position, which is exactly what the matcher consumes, so
the 2026 draft is resolved by the *same* code the import uses, with the same refusal to guess.

**Learned:**

- **Run the backfill before believing the matcher.** Fifteen unit tests covering apostrophes,
  suffixes, hyphens and ambiguity all passed, and the real data still found a defect none of them
  described — because I had not thought about team-code *spelling*, only about names. The 160-row
  live dataset was a better test than the fixtures.
- **The tier that matches on the least information is the one to be most careful with.** Every other
  position has three signals; a defense has one. Anything that reduces a match to a single field
  deserves an alias table.
- Resolution in `seed.ts` is wrapped in try/catch and skipped entirely on failure: seeding must never
  depend on a third party being up, which is the same rule §1 puts on the news feed. The upsert uses
  `COALESCE(excluded.sleeper_id, players.sleeper_id)` so an offline re-import cannot wipe ids an
  earlier run resolved.

**Watch out for:**

- **`sleeper_id` is nullable and will stay nullable.** Treat null as "unknown", never as an error,
  and never put it on the draft path. A matcher that reaches 100% is not a goal — §2 said so and it
  was right.
- **Re-run `npm run db:migrate-identity` after every pool import**, alongside
  `db:migrate-pick-ranks`. Both snapshot things that expire when the next CSV lands.
- `resolveSleeperIds` matches picks from the pick's **own** snapshot columns, never by joining
  `players` — the archive rule. A 2026 pick must resolve from what was true that night, not from
  whoever holds that slug today.

**Next:** the backlog is down to §1 (news feed) and §8. §1 is now materially cheaper: its identity
problem is solved here and its UI collision was solved by §4's sibling-button pattern.

---

## Step 25 — A theme toggle, and the rules that were holding the page together

**Date:** 2026-08-17  **Status:** done

**Built:** a Paper / Night / Auto toggle in every page header; `light-dark()` replacing the two
duplicated palette blocks; `--color-rule` split out as a role of its own; solid-ink position
badges; the heavy `rule-strong` section head.

**149 unit tests passing**, typecheck and build clean.

### Step 24 shipped the colour half of the identity and none of the structure

The board came out flat — one uniform slab. The reason was specific: Broadsheet's structure lives
in its **rules**, and the app's borders were all `border-slate-800`, a value that also has to work
as a *raised fill*. Something subtle enough to be a background is far too faint to be a hairline,
so the compromise value satisfied neither and every panel edge disappeared.

The fix is to stop treating the rule as a step on the slate ramp. `--color-rule` is now its own
token, tuned only for visibility, and all 95 `border-slate-700|800` sites became `border-rule`.
`rule-strong` is the second weight — the 2px head that opens a panel, which is what makes a panel
read as a panel now that nothing has a radius or a shadow.

Position badges went the same way: `bg-X-500/15 text-X-300` washes became solid `bg-X-300
text-slate-950` blocks. A newspaper prints a block or it prints nothing.

### `light-dark()` deleted a whole class of bug

Step 24 warned that `--mgr-*` had "two sets that must stay in sync". That warning is now obsolete —
**every token is a single `light-dark(light, dark)` pair**, so there is no second block to forget.
The toggle is then one property: `color-scheme`. No class to propagate down the tree, no second
stylesheet, and native scrollbars, form controls and caret colour follow along for free.

Three states fall out of it: `color-scheme: light dark` on `:root` follows the OS, and
`[data-theme='light'|'dark']` pins it. Lightning CSS polyfills `light-dark()` into
`--lightningcss-light/dark` sentinels and emits the matching `prefers-color-scheme` block, so all
three resolve correctly in the built CSS.

**Learned:**

- **A palette can be fully validated and still look wrong.** Every pairing in Step 24 passed AA,
  and the page still read as a flat slab, because contrast between *text and its ground* says
  nothing about whether the page has visible **structure**. Rules, weights and edges are a separate
  axis that no contrast checker looks at.
- **One token cannot be both a fill and a rule.** The moment a value has two jobs with opposite
  requirements, the compromise fails both. Splitting the role was a smaller change than tuning the
  shared value ever could have been.
- **`light-dark()` is the right primitive for a two-theme app** and removes the duplicated-block
  failure mode entirely. Worth reaching for before hand-rolling `prefers-color-scheme` twice.
- A theme's initial value **has to be applied by a blocking inline script in `<head>`**. Doing it in
  an effect runs after first paint, which is a visible flash of the wrong theme on every load.

**Watch out for:**

- **`--rule` is not on the slate ramp, deliberately.** Do not "tidy" `border-rule` back to
  `border-slate-800`; that is the exact change that made the page flat.
- **Solid badges depend on `-300` and `slate-950` moving in opposite directions.** `-300` is the
  readable accent on each ground while `slate-950` inverts to the page colour. Swapping either for
  a fixed value breaks one theme silently.
- **`suppressHydrationWarning` is on `<html>` and on the toggle button** because both legitimately
  differ between server and client — the server cannot know what is in `localStorage`.
- Supersedes Step 24's "two sets that must stay in sync" note: there is one definition per token now.
- **Still unverified on a phone.** Both themes are confirmed only on a desktop browser.

**Next:** BACKLOG §9 P2 — `voidLot`/`undoPick` decrementing the nomination index by exactly 1.

---

## Step 26 — Player news, in three tiers
**Date:** 2026-08-17  **Status:** done

**Built:** injury columns on `players` + `readInjury`/`injurySeverity` in `sleeper.ts`;
`scripts/refresh-news.ts`; `src/lib/news.ts` + 23 unit tests; `src/server/news-service.ts`;
`/api/news`; `InjuryBadge` and `PlayerDrawer`. Backlog §1.

**176 unit tests, 78 integration tests passing**, build and lint clean, verified end-to-end against
a running server.

### The finding that reshaped the whole feature

§1 was written assuming news meant picking a provider and paying for it. It does not. **Sleeper's
player dump — the same ~14MB file the pool is already seeded from — carries `injury_status`,
`injury_body_part`, `injury_notes`, `practice_participation` and `news_updated`.** 618 players
across the NFL, 84 within our 503-player pool.

So the question §1 actually exists to answer — "is this guy hurt?", the one people were alt-tabbing
to Rotowire for mid-auction — is answerable **with no runtime dependency at all**. It is a stored
column. On draft night it is already in Postgres and no provider being down can take it away.

That split the feature into tiers, and the ordering matters:

| Tier | Source | Runtime dependency |
|---|---|---|
| 1 — is he hurt | Sleeper dump, stored column | **none** |
| 2 — headlines | ESPN, one request | optional, degrades to empty |
| 3 — market buzz | Sleeper trending | optional |

**The most important question is the one with no network on its path.** That is the opposite of how
the section was originally scoped, and it is a much better shape.

### Verifying instead of recalling, without a search engine

§1 said to decide by verifying. I probed the actual endpoints:

- ESPN `/news?limit=100` **caps at 50 articles** but tags **129 distinct athletes** in one request.
  So one league-wide fetch serves a 500-player pool — which satisfies §1's "never fetch a provider
  from a request path" for free, rather than needing a pre-fetch job over the pool.
- ESPN's **per-athlete** news endpoint returns **0 articles**. Had I assumed it worked, the design
  would have been per-player fetches — exactly the thing §1 bans.
- Sleeper `trending/add` works and is keyed by `player_id`, which §2's `sleeper_id` now joins to
  directly.

### Everything a provider touches is quarantined

`news.ts` is pure and network-free; `news-service.ts` is the only file that fetches. Every request
is individually caught with a 4s timeout, and **a failed refresh keeps the previous snapshot**
rather than blanking a panel that was fine a moment ago. `/api/news` always returns 200 — a dead
provider is "no news about this guy", not an error state in the UI.

Backlog §1's rule 1 is now enforced **structurally rather than by discipline**: `news.test.ts` reads
`draft-service.ts` and fails if it ever imports the news service or grows a `fetch(`.

### The click collision was already solved

§1 worried at length about the pool's row-click meaning "nominate". §4 had already answered it: the
star is a **sibling button** that stays live while the row is disabled. The ⓘ button is a second
sibling, and it opens one drawer with several entry points rather than several components.

**Learned:**

- **Read the dependency you already have before shopping for a new one.** The answer to the headline
  question was inside a file this app has downloaded at every setup since step 2.
- **Probe the endpoint you intend to build on.** The per-athlete ESPN endpoint returning 0 would
  have been discovered late and expensively; it took one curl to find.
- **Next 16's `react-hooks/set-state-in-effect` bites the "reset then fetch" pattern.** Clearing
  state at the top of an effect is a cascade. Tagging the result with the player it belongs to makes
  "loading" *derived* instead — and as a bonus makes it impossible to flash player A's headlines
  under player B's name.

**Watch out for:**

- **Null injury means UNKNOWN, not healthy**, everywhere. `InjuryBadge` renders nothing rather than
  a green tick, and the drawer says "no injury on file — not a clean bill of health". A pool that
  has never been refreshed is null on every row.
- **`npm run news:refresh` requires `sleeper_id`.** It joins on the identity from step 25 and exits
  non-zero with instructions if *nothing* matched, because the silent version of that failure is
  every player reading as healthy.
- The refresh writes **five columns and nothing else** — never ranks, names or teams. It must not
  quietly reorder the draft board on the morning of the draft because Sleeper disagrees about who is
  better.
- Clearing matters as much as setting: a player who was Questionable on Tuesday and fine on Sunday
  must lose the badge, or the board fills with injuries that resolved weeks ago and nobody trusts it.

**Next:** §8 is all that remains — mobile, push-to-Sleeper, accessibility.

---

## Step 27 — Phase 2 H1: the sources, pinned and proven

**Date:** 2026-08-18  **Status:** done

**Built:** `scripts/history/xlsm-to-csv.py` + `data/history/*.csv` (8 files, 14,317 rows);
`scripts/history/pull-sleeper.ts` + `data/sleeper/2020..2025/*.json` (2.0MB, 6 seasons);
`src/lib/history-identity.ts` + 25 unit tests. No schema, no UI. Phase 2 §12.

**201 unit tests passing**, lint and typecheck clean.

This is the acquisition layer for league history: sixteen seasons back to 2011, champions named
back to 2006. Nothing here writes to a database — it lands committed, hashed artifacts so every
importer that follows is reproducible, offline, and diffable in review.

### Sleeper is the source of record from 2020, and that decision paid for itself

The workbook's weekly sheets were themselves pulled from the Sleeper API and then hand-maintained.
Going back to the origin rather than importing a copy killed three problems outright:

- `player_details_by_team` sums **6.4 points below** the real team score in 681 of 690 member-weeks.
  Not missing kickers — this league doesn't roster any — but an approximate scoring model, the gap
  correlating **0.54 with team-defense points**. Real `players_points` reconcile exactly.
- `lineup_efficiency_weekly.actual_points` sits on that same approximate scale, so efficiency could
  only ever be `actual/optimal`, never comparable across eras.
- `regular_season` and `matchup_data` disagree on PF/PA in **15 of 50** member-seasons (0.5–3.5 pts).
  Both are internally coherent; Sleeper settles it, and the workbook rows become the cross-check.

### Three namespaces, none of which share an id space

The app says `Gabes`/`Bolek`/`Grossman`; the workbook says `Brian`/`Jon`/`Eric + Mark`; Sleeper says
`bgabrielsen`/`OGJonnyB`/`gizzle4`. And the workbook's `member_id` is **not** `managers.id` — Bill is
workbook 1 and manager 4. Every pairing was *derived*, not guessed:

- Nicknames: joined `auction_drafts` to `Drafts/AllTimeDraftData.xlsx` on (year, player). 40+
  concordant picks per seat, zero conflicts.
- Sleeper ids: matched each owner's 2022 drafted roster against the workbook's `drafted_by`. Every
  owner scored **16/16 against exactly one member, with the runner-up at zero**.
- `markcubs` turned out to be a Sleeper **co-owner** of gizzle4's roster from 2023 — the "Mark" of
  "Eric + Mark". One seat, two humans, two user_ids.

### What the cross-check against Sleeper found in the auction record

Comparing drafted rosters year by year: **2023 is perfect, zero differences.** 2022 differs by
exactly one player. 2021 differs by three, all of which are the *same player renamed* (Robby Anderson
→ Robbie Chosen, Will/William Fuller, Washington Football Team → Commanders). And in 2022 the
workbook has George Pickens **twice** (pick 138 `"George Pickens"` $1, pick 160 `"george pickens"`
$3, both to Nate) while Sleeper has him once — which is why Nate read 17 players/$203 and resolves to
exactly 16/$200. The one genuinely missing pick, Bill's 16th, is **Tyler Boyd**.

**Learned:**

- **A second source is worth more than a careful reading of the first.** Three years of hand-checking
  the workbook would not have found the Pickens duplicate; one roster diff did, and it also recovered
  a missing pick and independently confirmed the whole identity map.
- **Ask what a field is worth before importing it.** Sleeper's auction *amounts* are a formality —
  2022, 2023 and 2025 each record 160 picks totalling exactly $160, every pick $1, because the room
  drafted on a Google Sheet and entered results afterwards to set rosters. The same endpoint whose
  prices are worthless has *rosters* that are authoritative.
- **Recomputing a spreadsheet is how you audit it.** All-play, win %, high/low weeks and the $10/week
  side bet reproduce the dashboard exactly — which is what makes the one disagreement meaningful:
  Eric + Mark show 0 high-scorer weeks and $0 because a lookup keys on `Eric` against data spelling
  it `Eric + Mark`. True answer: 4 high, 2 low, **+$20**.

**Watch out for:**

- **Never select the Sleeper league by name.** The account holds an unrelated 18-team *Guillotine
  League* in 2024 and 2025, and the real 2025 league is **misnamed "Fantasy 101 XIX"** — 2024's name.
  `verifyLeagueChain()` walks `previous_league_id` instead, and the ids are pinned.
- **Roster shape changed in 2022.** 2020–2021 start 9; 2022+ start 10, adding `SUPER_FLEX`. Any
  optimal-lineup calculation must read *that season's* `roster_positions` — assuming superflex
  throughout silently misreports four seasons, and assuming it never applies misreports the other two.
- **`data/` must stay out of the test and compile globs.** Checked: `vitest.config.ts` includes only
  `src/**/*.test.ts` and tsconfig only picks up `.ts`. 2.8MB of CSV and JSON is fine committed and
  very much not fine parsed on every test run.
- **Every identity lookup throws, deliberately.** An unmapped name is not a row to skip — it means a
  source holds someone the league has no record of. The league has had the same ten members since
  2011, so a miss is a bug in the map, not an eleventh manager.
- **The identity test reads the real committed data**, so a source that gains an unmapped spelling
  fails the build rather than being discovered three importers later.

**Next:** H2 — the history schema (`seasons`, `season_standings`, `season_matchups`,
`season_lineups`, `player_weeks`, `player_seasons`, `legacy_champions`) via a hand-written
idempotent migration.

---

## Step 28 — The poll loop learns to be quiet

**Date:** 2026-08-18  **Status:** done

**Built:** visibility pause, finished-draft backoff and a re-entrancy guard in `src/hooks/useDraft.ts`.

**Found while Phase 2 H2 could not open a database connection at all**: Neon was returning
`HTTP 402 — data transfer quota exceeded` on both `neondb` and `neondb_test`. The cause was not the
history import. It was this app, idling.

`POLL_MS` is 400 and the loop had no idea whether anyone was looking. `getState()` runs **five
queries on every poll**, including the 204 "nothing changed" path, because the version is computed
from the state rather than stored — so there is no cheap path, only a cheap *response*. One browser
tab left open is **~216,000 requests and ~1.08M queries a day**. The draft was 2026-08-14; this was
found on the 18th.

The loop is now fast when it matters and quiet when it does not:

| Condition | Cadence |
|---|---|
| Tab hidden | **no requests at all**, waking every 5s only to re-check visibility |
| `status === 'done'` | 30s |
| setup / live / paused, visible | 400ms — unchanged |

**Learned:**

- **An uncached endpoint is not the same as an endpoint that must be polled forever.** `/api/state`
  is still `force-dynamic` + `no-store`, and that rule was never the problem. The client's
  willingness to ask 2.5 times a second, for four days, with nobody watching, was.
- **A 204 is cheap for the client and not for the database.** The response is empty; the work behind
  it is five queries including a view with correlated subqueries over `picks`. "Cheap path" in the
  route comment describes the payload, not the cost.
- **The app was built for one night and then kept running.** Ten laptops for three hours is 25 req/s
  for an evening. The same code left idle is the same rate until someone closes a tab.

**Watch out for:**

- **A finished draft must keep polling, slowly — never stop.** `undoPick` flips `status` back to
  `'live'`, and a client that had stopped would sit on a finished board with no way back.
- **`visibilitychange` can start a second timer chain.** If the event lands while a poll is in
  flight, the resumed chain and the original both call `setTimeout`, and the tab polls at double
  rate for the rest of its life — the exact opposite of the fix. A `ticking` guard makes two chains
  impossible.
- **The hidden branch still reschedules.** A tab that only stopped on the event would stay dark
  forever if the event were missed; it wakes every 5s to check, which costs no network.
- `refresh()` re-arms the loop after polling, so undoing on a finished draft returns the acting
  client to draft cadence immediately instead of leaving it on the 30s timer it was already sitting on.

**Next:** H2 remains blocked until the Neon quota clears.


---

## Step 29 — The news feed comes back out
**Date:** 2026-08-18  **Status:** done

**Removed:** `src/lib/news.ts`, `src/lib/news.test.ts`, `src/server/news-service.ts`,
`/api/news`, `src/components/PlayerDrawer.tsx`, and the ⓘ button on pool rows.
**Kept:** everything in tier 1 — the injury columns, `npm run news:refresh`, and `InjuryBadge`.

**184 unit tests passing**, build and lint clean.

### Built one day, removed the next, on purpose

Step 26 shipped a working ESPN + Sleeper-trending aggregator, verified end to end. The user looked
at it and cut it:

> "I like the questionable tags but maybe we get rid of the news. People can go to Sleeper and look
> things up on their own, and in our app it won't be current at all times."

That is the right call and the reasoning generalises, so it is worth writing down rather than just
deleting the files:

- **A feed is only as fresh as its last refresh, and it does not look stale.** A panel of headlines
  renders identically whether it is four minutes or four weeks old. That invites trust at exactly
  the moment it should not be given — somebody about to commit $60. Injury *status* survives the
  same objection because it is one field with an explicit "as of", not a wall of prose.
- **Don't rebuild what a better tool already does.** Sleeper is one tab away, always current, and
  already where these managers look. The app's edge is the auction.
- **It was the only third party on a request path.** Removing it deleted a whole class of failure,
  and the surviving rules got *simpler* rather than more carefully guarded.

The distinction that survived is a good one to keep: **a small factual field attached to a price you
are about to pay earns its place; a general feed does not.**

### What was kept from the removal

The structural test moved rather than died. `news.test.ts` asserted that `draft-service.ts` never
calls `fetch(`; that rule is older and broader than the news feature — `/api/state` is polled by
every client several times a second — so it now lives in `sleeper.test.ts`, with a second assertion
that `draft-service` does not import the Sleeper client either.

`BACKLOG.md` §1 went from ✅ to 🟡 and records **both halves**: what shipped, and why the feed was
cut, with the commit to recover it from. A section that just said "done" would invite the next
person to rebuild the removed half.

**Learned:**

- **Shipping something is a legitimate way to find out you do not want it.** The aggregator took a
  few hours and the decision to cut it took one look at the running app. That is a cheaper path to
  the right answer than a longer argument beforehand would have been.
- **Record removals as decisions, not as absence.** An empty space in a codebase reads as an
  oversight; `AGENTS.md` now carries "there is no live news feed, and that is a decision rather than
  a gap" precisely so the next agent does not helpfully fill it in.

**Watch out for:**

- `git rm` leaves the directory behind, and an open editor buffer **rewrote `route.ts` back to
  disk** after the delete — the build kept listing `/api/news` long after it should have been gone.
  Check `find`, not `ls`, and clear `.next` before trusting a route listing.
- The injury data is still a **snapshot**. The user's objection to stale news applies to it too, and
  the answer is `injury_updated_at` being visible — do not let that "as of" disappear from the UI.

**Next:** §8 is all that remains in the backlog.

---

## Step 30 — Local development stops costing the league its database

**Date:** 2026-08-18  **Status:** done

**Built:** `docker-compose.yml` (Postgres 17 + two Neon HTTP proxies), `src/db/neon-local.ts`,
`scripts/local/bootstrap.ts`, `scripts/local/init-databases.sql`, and the `db:local:*` / `local`
npm scripts. Plus a real fixture bug in `scripts/seed-test.ts`.

**184 unit tests and all 78 integration tests passing — the integration suite now runs entirely
against local Postgres**, which previously burned Neon quota on every run.

### The problem was never the history import

H2 could not open a connection at all: `HTTP 402`, data transfer quota exceeded, on *both*
databases. The cause was `npm run dev` pointing at production. `/api/state` polls every 400ms and
`getState()` runs five queries per poll, so a single dev tab is ~1.08M queries a day. Writing code
took the live database down.

### Redirecting the driver rather than replacing it

`@neondatabase/serverless` speaks SQL-over-HTTP, not the Postgres wire protocol, so it cannot reach
a local Postgres unaided. The two options were a `pg`-backed shim implementing the same
tagged-template interface, or keeping the identical driver and moving only its endpoint.

The shim was the wrong trade. This codebase's correctness *is* its SQL — awarding a lot and
executing a trade are single data-modifying CTEs precisely because neon-http has no interactive
transactions (§4). A shim would sit between those statements and the database in development and
not in production, which is the one place a difference must never exist.

So `src/db/neon-local.ts` sets `neonConfig.fetchEndpoint` and routes **per request, by host**: a
local host goes to a proxy, anything else gets Neon's own endpoint unchanged. There is no
environment flag, because a flag is a thing you can forget — the connection string decides.

Verified before being trusted: parameter binding through the tagged template (including a hostile
`O'Brien; DROP TABLE x--`), a data-modifying CTE, `sql.query()`'s dynamic form, and that `numeric`
comes back as the string `"124.20"`.

**Learned:**

- **An accumulated test database hides fixture bugs.** `commish-service.itest.ts` reaches
  `OFFSET 300 LIMIT 48` into the pool but `seed-test.ts` created 200 players. It only ever passed
  because the shared Neon test database had rows left over from earlier runs. A database built from
  the seed script alone failed immediately — and the failure reads as `undefined.id` deep in a
  skip-run assertion, which looks like a `nominatorAt` bug rather than a missing fixture.
- **`drizzle-kit push` cannot be used locally**: it reaches for the Neon driver over a **WebSocket**,
  and the proxy exposes only the HTTP SQL endpoint (`docker inspect` confirms port 4444 alone), so it
  hangs on "Pulling schema from database" rather than failing. `drizzle-kit generate` needs no
  database at all, so the local bootstrap generates SQL offline from `schema.ts` and applies it
  through the same HTTP client the app uses. Nothing restates a table definition.
- **`dotenv` does not override an already-exported variable.** That one fact is what lets a single
  `npm run local --` wrapper send every existing script at the local database with no edits to any
  of them.

**Watch out for:**

- **Neon's HTTP endpoint takes one statement per call.** `DROP SCHEMA public CASCADE; CREATE SCHEMA
  public;` comes back as a bare syntax error (42601), which reads like malformed SQL rather than an
  unsupported shape.
- **The generated `drizzle/` output is gitignored and regenerated every bootstrap.** A committed
  baseline rots the moment the schema moves, and a stale one that still applies cleanly is worse
  than none.
- **`bootstrap.ts` drops and recreates the public schema**, so it refuses to run against any
  non-local host rather than trusting the caller.
- **The test URL's port 5433 is a routing label, not a listening Postgres.** Both databases live in
  one container on 5432; the port in the URL only selects which proxy — the image targets one fixed
  database per instance.
- Local runs are slower than Neon (~220s for the integration suite) because every query is its own
  HTTP round-trip. Individual tests reach 20s against a 30s timeout, so a test that grows may need
  the timeout raised rather than being assumed broken.
- Two pre-existing `react-hooks/set-state-in-effect` lint errors remain in `src/app/setup/page.tsx`
  and `src/components/ThemeToggle.tsx`. They predate this work and are untouched.

**Next:** H2 is unblocked and the history schema is in place locally. H3 imports the Sleeper era.

---

## Step 31 — Phase 2 H2: the history schema

**Date:** 2026-08-18  **Status:** done

**Built:** seven tables in `src/db/schema.ts` — `seasons`, `season_standings`, `season_matchups`,
`season_lineups`, `player_weeks`, `player_seasons`, `legacy_champions` — plus
`scripts/migrate-history.ts` (`npm run db:migrate-history`), appended to the `db:test-migrate` chain.

**Run twice against local Postgres; idempotent both times. `npm run db:verify` green, 184 unit and
78 integration tests passing.** Not yet run against Neon — that waits on the quota.

### The tables do not mirror the sheets

Excel forced shapes Postgres does not. Six principles, each answering something the workbook does
differently, are written up in `PROJECT_PLAN.md` §12; the two that shaped the most:

**One fact, one table.** The workbook has three sheets saying "a game happened" — `matchup_data`,
`playoff_matchup_data`, `playoffs_legacy`. `season_matchups` is one table with `is_playoff`, because
every record question spans both ("the all-time high score" is not a regular-season question) and
splitting them puts a `UNION` in every query.

**One row per game *side*, not per game.** Two rows per game looks redundant until you notice every
consumer wants "for each manager, for each week": all-play, streaks, high/low scorer weeks,
per-manager points, consistency, the head-to-head grid. One row per game would put a `UNION ALL` in
all of them. The cost is ~700 rows.

### `season_lineups` stays separate from `season_matchups` despite an identical grain

In the workbook those two numbers were on **different scales** and disagreed by an average of 6.4
points. Sourcing both from Sleeper fixes the scale, but the separation is still right: putting
`actual_points` on the same row as `points` creates two columns that both look like "what they
scored", and a join is a cheap price for never letting them touch by accident.

### `data_tier` makes the era rule structural

`'legacy' | 'standings' | 'weekly'` on `seasons` is what stops the two eras being mixed by
convention. The workbook mixes them silently and contradicts itself as a result: its hidden records
sheet claims an all-time high of 203.9 (Nate, 2014) while its dashboard says 234.96 (Daniel, 2023),
and both are "right" for the era each was computed over.

**Learned:**

- **`numeric` is worth the string it returns.** Neon hands back `"124.20"`, and `'124.20' + '110.00'`
  is `'124.20110.00'` — a sum that renders, sorts, and is wrong. It is still the right type: Postgres
  sums points-for exactly, where 140 doubles land on 1497.9999999999998, and this data exists to be
  quoted back at people who know the real number. Every points column goes through `Number()` at the
  service boundary.
- **The assertion worth more than the rest is the one about what did *not* change.** The migration
  snapshots all ten rows of `manager_totals` before any DDL and refuses to finish if a single number
  moved. History can never reach a live budget — the view is `CROSS JOIN draft` filtered to
  `d.season` — and this proves it rather than asserting it in a comment.
- **DDL and data belong in different scripts.** This has to run against `neondb_test`, which has none
  of the committed source files, so it creates seven tables and seeds exactly one row: the `seasons`
  entry for the current draft, which is described by `draft` and nothing else.

**Watch out for:**

- **Null prize money means unknown, not zero.** It is a real $0 for 2011–2013 and genuinely unknown
  for 2006–2010, where the source records a literal `-`. Collapsing them makes a "Bag Secured" total
  quietly authoritative about five years it knows nothing about.
- **Third place is recorded, never derived.** The bracket is six teams over three rounds, so there is
  no third-place game — deriving it from the matchups produces a confident, wrong name.
- **`legacy_champions` is deliberately not linked to `managers`.** Those five years predate the
  membership record; the names are recognisable but asserting the 2006 "Daniel" is today's Daniel is
  a guess dressed as a fact.
- The migration must never re-emit `manager_totals`. A migration that hardcodes a view definition
  becomes a loaded gun the moment the view changes — `migrate-called-auction.ts` is the cautionary
  tale, and it now refuses to run at all.

**Next:** H3 — import the Sleeper era (2020–2025), ending with the reconciliation table against the
workbook's own standings.

---

## Step 32 — Phase 2 H3: the Sleeper era lands

**Date:** 2026-08-18  **Status:** done

**Built:** `scripts/import-sleeper-history.ts` (`npm run history:import-sleeper`), on top of the
pure transform layer from step 31.

**Imported 2020–2025:** 60 standings rows, 914 matchups, 1,010 lineups, 16,888 player-weeks,
1,693 player-seasons. `manager_totals` unchanged. 229 unit tests passing.

### Three independent checks, all green

1. **Reconciliation against the workbook, 2020–2024.** Every win-loss record, every
   regular-season place and every points-for total agrees across all fifty member-seasons. The
   place check is the interesting one: Sleeper stores a record but not a rank, so `place` is
   computed (wins, then points for) — and matching the workbook's recorded `reg_season_place`
   fifty times over turns "the usual tiebreak" into a verified one.
2. **Starter points reproduce Sleeper's weekly team totals to the cent**, 60/60 manager-seasons.
3. **All-play recomputed from the database reproduces the workbook's dashboard exactly** — Bolek
   368-252-1, Bryan 235-386, and the eight in between. That is the whole chain validated end to
   end: API → committed JSON → transform → Postgres → SQL aggregate.

### Points come from the games, not from Sleeper's season total

A roster's stored `fpts` is not always the sum of that roster's weekly results — five rosters in
2020 and three in 2021 drift by 0.5 to 3.0 points. `season_standings.points_for` is therefore the
sum of the weekly rows. A season total that does not equal the games it is made of cannot be
reconciled on a page that shows both, and every derived metric reads from those same rows.

**Learned:**

- **The reconciliation is the deliverable, not the import.** Loading 16,888 rows is easy; knowing
  they are right is the work. Three checks against two independent sources is what makes it
  possible to say the numbers are correct rather than merely present.
- **Batch, or the HTTP driver will punish you.** One statement per call means 16,888 player-weeks
  is 16,888 round trips. Multi-row `INSERT` in chunks of 400 turns the whole import into ~60.
- **A computed rank needs a witness.** `place` looked like a detail until it turned out the
  workbook had recorded it independently for fifty member-seasons, which is the only reason the
  tiebreak rule can be stated as fact.

**Watch out for:**

- **The playoff weeks contain consolation games.** Only the winners bracket is imported; weeks 15–17
  also hold games between eliminated teams, which the league has never counted. The bracket's seven
  games are all kept, including the fifth-place game — the workbook recorded only five, dropping the
  fifth- and third-place games while still naming a third-place finisher.
- **2020 is shaped differently.** Thirteen regular-season weeks with playoffs in 14–16, against
  fourteen and 15–17 for every later season. Nothing may assume a fixed week count.
- **Per-season deletes, never a bare `DELETE FROM`.** A re-run clears only the seasons it is
  importing, so a partial re-import cannot silently drop the rest of the league's history.

**Next:** H4 — the pre-Sleeper era (2006–2019) from the workbook: standings, podium, prize money
and draft locations.

---

## Step 33 — Consolation games are kept, and counted separately

**Date:** 2026-08-18  **Status:** done

**Built:** `season_matchups.playoff_placement`, set from the bracket's own placement tag.

The first cut of H3 treated all seven winners-bracket games as equal playoff games. The league does
not: third place pays, and nobody tries in the fifth-place game. Counting a game people were not
playing seriously toward "all-time high score" or a playoff record makes both worse.

So the rows are all kept and the *meaning* is stored alongside them. `playoff_placement` is null on
the championship path (quarter-final, semi-final, final) and otherwise names the place contested —
`3` or `5`. Stats default to `playoff_placement IS NULL OR playoff_placement <= 3`; nothing is
thrown away, and anyone who wants the consolation bracket can have it.

Per season: 5 championship-path games, 1 third-place, 1 fifth-place.

**Learned:**

- **"Which games count" is a league rule, not a data question.** Sleeper marks the placement games
  and stops there; whether a fifth-place game belongs in a record book is something only the league
  can answer. Storing the tag rather than filtering on import means the answer can change later
  without re-importing anything.

**Watch out for:**

- **The final carries `p: 1` but is not a placement game.** Treating any `p` as consolation would
  drop the championship itself out of every playoff record.
- The losers bracket is pulled and committed but **not imported at all**. If it is ever wanted, it
  is already on disk.

**Next:** H4 — the pre-Sleeper era.

---

## Step 34 — Phase 2 H4: the pre-Sleeper era

**Date:** 2026-08-18  **Status:** done

**Built:** `scripts/import-workbook-history.ts` (`npm run history:import-workbook`).

**The league's full record is now in Postgres — 2006 to 2025.** 20 seasons, 150 standings rows,
5 legacy champions. `manager_totals` unchanged.

| Tier | Years | What exists |
|---|---|---|
| legacy | 2006–2010 | a champion's name, nothing else |
| standings | 2011–2019 | member-season record, points, place, playoff W/L, podium, money |
| weekly | 2020–2025 | everything, from Sleeper |

**Verified:** championships and prize money per manager reproduce the workbook's dashboard exactly
for all ten managers through 2024 — Daniel 2/$4,000, Bryan 3/$3,275, Bolek 2/$2,575, down to Jack
1/$1,025.

### Filling gaps without overwriting better data

This runs after the Sleeper import and must not undo it. The podium for 2020+ was derived from
Sleeper's bracket and independently agrees with this workbook on all fifteen placings, so those
columns fill with `COALESCE(existing, incoming)` rather than being replaced. Prize money goes the
other way — it exists nowhere but here, so the workbook always wins. `data_tier` never downgrades a
season Sleeper already described.

**Learned:**

- **Import order is a design decision, not an accident.** Two sources overlap on 2020–2024, and
  which one wins per column is a per-column answer: bracket for the podium, workbook for the money,
  Sleeper for everything weekly. Encoding that in the conflict clause makes re-running either
  importer in any order safe.
- **The sheet numbers its members *and* names them**, so the importer cross-checks the two on every
  row rather than trusting `member_id`. Bill is workbook 1 and manager 4; an off-by-one there
  produces a perfectly plausible wrong answer, like Bryan's championships showing under Mario.

**Watch out for:**

- **`money_won` of `'-'` is unknown, not zero.** 2006–2010 record a literal dash, while 2011–2013
  record a real $0. Collapsing them makes a "Bag Secured" total quietly authoritative about five
  years it knows nothing about — so those are null, and any sum over them must report its coverage.
- **`legacy_champions` is deliberately unlinked from `managers`.** The names are recognisable, but
  asserting the 2006 "Daniel" is today's Daniel is a guess dressed as a fact.
- **Games per season are derived from the records, and asserted constant within a year.** Nothing
  assumes 13 or 14; a season where managers disagree about how many games they played stops the run.
- 2025 has no prize money on record — the workbook stops at 2024. Null, not zero.

**Next:** H5 — `src/lib/history.ts` and the League Summary. Everything it needs is now in the
database.

---

## Step 35 — Phase 2 H5: the League Summary

**Date:** 2026-08-18  **Status:** done

**Built:** `src/lib/history.ts` + 25 unit tests, `src/server/history-service.ts`,
`src/components/history/{EraBadge,LeagueSummaryTable}.tsx`, and `/history`.

**254 unit tests passing.** Verified in a browser against the real imported data.

### The two-era rule is enforced by the types

Every summary row splits into `allTime` and `weekly`, and `weekly` is **nullable**. An all-play
record cannot be added into a career win total by accident because they are not in the same object,
and every report carries the `Coverage` it was computed over. `EraBadge` takes a `Coverage` rather
than a string, so a column of six-season figures physically cannot be rendered under a
fifteen-season heading.

This is guarding against a real failure, not a hypothetical one: the league's own dashboard puts
those columns side by side unlabelled, and its hidden records sheet disagrees with its front page
about the all-time high score because the two were computed over different eras.

### A Server Component, deliberately

History does not change, so `/history` renders on the server with `revalidate = 3600`. No route, no
poll, no client fetch, and nothing reachable from the 400ms path that drives draft night. The table
ships no JavaScript at all.

**Learned:**

- **A season row exists before the season does.** 2026 has a `seasons` row, a tier and a draft
  location the moment the draft happens — so a coverage span built from rows alone read
  "2011–2026" for a table whose last result is 2025. `coverageFor` now takes the seasons that
  actually contributed rows to the metric being labelled. Caught by looking at the rendered page,
  not by a test; the test came after.
- **Null propagates all the way to the screen or it is not worth having.** The Net column reads `—`
  for every manager right now, because no season has a high/low rate recorded. That is the correct
  answer and it is visibly different from `$0` — which is exactly the bug the workbook has, where a
  failed lookup renders as a manager who broke even.

**Watch out for:**

- **`numeric` arrives as a string.** `history-service.ts` is the one place that converts, and
  nothing downstream should ever see a stringified number. `'124.20' + '110.00'` is `'124.20110.00'`.
- **The era divider is load-bearing layout**, not decoration. It is the only thing separating a
  fifteen-season career record from a six-season all-play record.
- The high/low payout is unset for every season, so the side-bet column is all `—`. Set it with
  `npm run season:prizes -- <year> --high 10 --low 10` once the league confirms the rate per era.

**Next:** H6 — the record book and the Season in Review card.

---

## Step 36 — The side bet loses its money, and keeps its point

**Date:** 2026-08-18  **Status:** done

**Removed:** `highLowNet` from the summary, the Net column from the table, `--high`/`--low` from
`season:prizes`, and the `high_score_payout` / `low_score_penalty` columns from `seasons`.
**Kept:** how often each manager was the league's high or low scorer.

The count is the interesting number and it cannot be wrong. The dollar figure needed a per-season
rate that mostly is not on record, which meant an entire column of `—` and a schema field nobody
could fill. Dropped rather than left dangling: a half-wired feature is worse than no feature,
because the next reader cannot tell which it is.

Third place stays part of the playoff record — confirmed with the league rather than assumed. Only
the fifth-place game is excluded.

**Learned:**

- **Removing a metric is easier than justifying one.** The rule that null must never render as zero
  was correct and the column still had to go, because "correct but permanently blank" is not a
  column. The rule earned its keep anyway — it is what made the blankness visible instead of
  silently reading `$0`, which is exactly the bug the workbook has.

**Watch out for:**

- The columns are dropped in `migrate-history.ts` with `DROP COLUMN IF EXISTS`, so the migration
  stays idempotent and safe to re-run on a database that never had them.

**Next:** H6 — the record book.

---

## Step 37 — Two sections, not one pile of pages

**Date:** 2026-08-18  **Status:** done

**Built:** `src/components/SiteNav.tsx` and `src/hooks/useSession.ts`; every page's ad-hoc
back-links replaced with a section nav.

```
FANTASYWORLD  |  [Draft] [History]
  Draft   → Draft · Board · Stats · Trades · Setup (commissioner only)
  History → Summary
```

The wordmark carries the league's name; the auction draft is one thing FantasyWorld does and the
history is another, so the name sits above both rather than being one of them.

### Why the app has two halves

These are two products sharing a database. The draft pages are a live tool — ten people, one room,
three hours a year, polling every 400ms with money on the line. The history pages are a reference
read at leisure, rendered on the server once an hour. Different cadence, different posture,
different failure modes. A flat nav that mixes them invites somebody to treat one like the other.

It also fixed something shipped an hour earlier: `/history` had a **"← Board"** button, which
quietly claimed history was a sub-page of the draft.

`/` stays the join screen. It is the link everyone opens on draft night and `DRAFT_NIGHT.md`
depends on it; putting a hub in front of claiming a seat costs a click on the one night that is
time-critical.

**Learned:**

- **A nav is an assertion about what exists.** The history section was written with five items and
  trimmed to one, because four of them were pages yet to be built. A nav pointing at a 404 makes a
  section look broken rather than unfinished; entries get added as pages land.
- **The back-link you write on a new page encodes where you think it belongs.** Writing "← Board"
  on `/history` was the tell that the information architecture had not been decided.

**Watch out for:**

- **`isCommish` here only decides whether a link is drawn.** Every commissioner action re-reads
  `is_commish` from the database against the session id. Hiding a link is presentation; it is not
  and must never become a trust boundary.
- **`useSession` returns `undefined` while asking and `null` for nobody.** Collapsing those to
  `null` would flash the commissioner's Setup link off on every load for the one person who wants it.
- `/draft` and `/trades` keep their own inline session lookups, because theirs also redirect an
  unsigned visitor to the join screen — a page-level decision a shared hook should not impose.

**Next:** H6 — the record book, which adds the second History entry to the nav.

---

## Step 38 — Phase 2 H6: the record book

**Date:** 2026-08-18  **Status:** done

**Built:** `records()`, `seasonInReview()` and `longestStreaks()` in `src/lib/history.ts` (+17
tests), `RecordLine` and `SeasonReviewCard`, and `/history/records`.

**271 unit tests passing.** Verified in a browser against the real imported data.

### Three groups, because they do not cover the same years

Single-game records reach back to 2020, when week-by-week results start. Season and career records
reach to 2011. Each group carries its own `EraBadge`, and the two weekly-era records that sit in the
season column (the streaks) carry theirs individually rather than inheriting the column's.

### What it reproduces, and the three places the workbook is wrong

Matches the dashboard exactly: 234.96 (Daniel, wk12 2023), 37.12 (Bryan, wk5 2021), the 132.74
blowout, the 0.10 narrowest win, 1051.92 fewest points, 1995.22 most points against, and both
streaks (7 wins, 8 losses).

The workbook's **hidden `All-time Records` sheet** disagrees with its own standings sheet on three
records, and it is wrong every time:

| Hidden sheet | The standings data |
|---|---|
| High score 203.9 — Nate, 2014 | 234.96 — Daniel, wk12 2023 |
| Best season 12-1 — Mario, 2013 | Mario went 10-3 in 2013; the real best is 12-2 |
| Worst season 1-12 — Justin, 2012 | Justin went 2-11; the real worst is Daniel, 2016 |

`xlsm-to-csv.py` already refuses to convert that sheet. This is why.

One genuine difference from the dashboard, and it is the league's own decision: the highest playoff
score is now **192.44 (Daniel, wk17 2023)** rather than 181.16, because that game was the
third-place game — which the league says counts, and the workbook excluded.

**Learned:**

- **A margin is not a rate.** Best and worst record were first ranked by wins minus losses, which
  quietly favours the longer seasons: the league played 13 games through 2020 and 14 from 2021, so
  12-3 (.800) would have beaten 11-2 (.846) on margin alone. Ranked by percentage now, with a test
  built from exactly that pair.
- **The number is not always the record.** "Best regular-season record" is `12-2`, not `12`, so
  `RecordEntry` grew a `display` string that overrides the formatted value. A formatter that only
  sees a number cannot know this.
- **Margins are taken from the winner's side only.** Reading them from both sides would make every
  blowout simultaneously the narrowest loss.

**Watch out for:**

- **Streaks do not cross a season boundary.** Eight months and a fresh draft sit between the last
  game of one year and the first of the next; a streak spanning them describes two different teams.
- **A standings-era season's review card says so**, rather than showing empty rows. "Not recorded
  that way" and "we lost it" are different claims and must not look the same.
- Ties keep the earliest holder so a record has one name. The workbook lists two for the 7-win
  streak (Jon and Justin); this shows Justin.
- The "draft steal" is deliberately absent until the auction import lands.

**Next:** H7 — `getArchivedSeason` reads `seasons`, which fixes a live bug.

---

## Step 39 — Phase 2 H7: an archived season renders with its own settings

**Date:** 2026-08-18  **Status:** done

**Fixed:** `getArchivedSeason` read `roster_size` and `starting_budget` straight from `draft`, so
every archived year rendered with **today's** settings. `ArchiveSeason` gains `isFinal` and `notes`;
`draftComplete` honours `isFinal`.

**274 unit and 80 integration tests passing**, `db:verify` green.

This was invisible while the app knew one season and became wrong the moment it knew several. A rule
change today — a bigger roster, a different budget — silently rewrote every board the league had
ever played, and every budget derived from it. It now reads the season's own row and falls back to
the current draft only when that season has none, which keeps a pre-`seasons` year readable rather
than refusing to render a season that was really played.

### `draftComplete` needed the same treatment

It asks "is every roster full?", which is the right question about a draft in progress and the wrong
one about a season that ended years ago. 2022's record is one pick short and always will be — the
pick is missing from the source and cannot be recovered — so that season was reported as still
drafting, forever. A finished season now says so directly and that wins; the live draft, which has
no such flag, still uses roster counts.

**Learned:**

- **"Derived, never stored" has a boundary, and it is the season.** Budgets are still derived from
  picks and adjustments — but the *rules* they are derived under belong to the season that was
  played, not to the row describing what the league is doing now.
- **A fallback is a feature when the alternative is a blank page.** No `seasons` row means today's
  settings are the best answer available, which beats refusing to render a season that happened.

**Watch out for:**

- **Do not clamp a negative archived budget to zero.** Some manager-seasons genuinely do not
  balance (2023 has managers at $205 and $194 against a $200 budget, from auction-dollar trades),
  and tidying that away is the stored-budget lie this app exists to remove. `notes` is where the
  explanation goes.
- Two integration tests now pin this: changing `draft.roster_size` must not move an archived
  season's numbers, and a season with no row must still render.

**Next:** H8 — the 2021–2024 auction drafts into `picks`.

---

## Step 40 — Phase 2 H8: the auction years

**Date:** 2026-08-18  **Status:** done

**Built:** `scripts/import-history-picks.ts` (`npm run history:picks`), the `AND p.active` pool
filter, a Value-panel empty state, an archive notes banner, and pool checks in `verify.ts` scoped
to draftable players.

**640 picks across 2021–2024 in `picks`.** 274 unit and 81 integration tests passing,
`db:verify` green, `manager_totals` unchanged.

The payoff step: `/board`'s year picker, all five `/stats` panels and `/api/export` now work on
four more seasons with no new view code, because they were already season-agnostic.

### Two corrections, both found by a second source

Sleeper's auction *amounts* for this league are a formality — every pick $1 — but its record of
**which players** each manager took is real, and diffing it against the workbook found:

- **2022 pick 160 dropped.** George Pickens appears twice under two spellings; Sleeper has him
  once. Removing it puts Nate at 16 players / $200 instead of 17 / $203.
- **2022 Tyler Boyd added at $1.** Bill's sixteenth pick is missing from the workbook. The price is
  arithmetic rather than judgement: $199 across the other fifteen, a $200 budget and a $1 minimum
  leave no other value. The pick *number* is a placeholder and says so.

Both live in one `HISTORY_PICK_CORRECTIONS` list with a reason and a date, and both are surfaced in
`seasons.notes` and drawn on the archived board. After them, **every roster matches Sleeper player
for player** for 2021–2023. 2024 has no Sleeper draft, so it is the one year with no second source.

### 2023 still does not balance, and that is the point

Bryan $205, Brian $202, Nate $201 against a $200 budget — auction dollars were traded, and the
league confirmed it. The archive shows the negative budgets **unclamped**, with the reason printed
beside them. Tidying that away would be the stored-budget lie this app exists to remove.

**Learned:**

- **A second source is worth more than a careful reading of the first.** No amount of staring at the
  workbook would have found the duplicate; one roster diff found it, recovered a missing pick, and
  then certified all 640.
- **`verify.ts` was right to fail and its question was wrong.** "Every player has a board rank" broke
  on 287 historical players who have no rank by design. Scoped to `active`, it is again asking the
  thing it means: is the *draft board* ready.

**Watch out for:**

- **No backticks inside a SQL template literal.** Writing an explanatory comment containing
  `players` terminated the tagged template, and the error surfaced as three unrelated TypeScript
  parse errors twenty lines away. AGENTS.md says this; it is still easy to do.
- **`active` is the only thing keeping retired players off a live board.** `scripts/seed.ts`
  deliberately protects any player a pick references from the annual wipe, so there is no second
  line of defence. An integration test now pins it.
- **`player_rank` is NULL for all 640 and always will be.** Rank stops being recoverable the moment
  a season's pool is replaced. The Value panel says so rather than rendering two empty tables.
- Draft order for these seasons is each manager's **first nomination**, not the drawn seat — the
  drawn order was never recorded, and the note on the board says exactly that.

**Next:** H9 — the 2025 auction from the Google Sheet.

---

## Step 41 — Phase 2 H9: the 2025 auction

**Date:** 2026-08-18  **Status:** done

**Built:** `data/history/auction_2025.csv` from the league's Google Sheet, 2025 folded into
`import-history-picks.ts`, a `ROSTER_EXCEPTIONS` list, `RECORDED_ORDERS`, and automatic
over-budget notes on every season.

**800 picks across 2021–2025.** Every season the league has ever auctioned is now in `picks`.
274 unit tests, `db:verify` green, `manager_totals` unchanged.

### The sheet disagrees with itself, and that is the whole origin story

The 2025 sheet's **pick log** and its **budget summary** both account for exactly $1,979 and split
it differently across four managers: Bolek is $187 in the log and $201 in the summary, with Bill,
Bryan and Mario making up the difference. Six managers match to the dollar.

The log wins. It is 160 explicit rows, each naming a player and a price, and **all 160 of its
player-to-manager assignments match Sleeper's draft exactly**. The summary is a derived total that
drifted — which is precisely the failure this app was built to remove, and the famous **−$1** that
`PROJECT_PLAN` §1 cites turns out to live in that summary rather than in any pick.

### Two draft-time sources beat two post-hoc ones

Pick 106 reads Jayden Reed in the sheet's log **and** in its player pool; Sleeper's draft and the
sheet's roster board both say Dylan Sampson. The first two are draft-time artifacts; the second two
could equally reflect an early-season waiver swap, since 2025's results were typed into Sleeper
after the fact. Reed stays, in a `ROSTER_EXCEPTIONS` list with the reasoning, and the season note
says so on the board.

**Learned:**

- **Transcription is not a source; a check is.** The first pass at this CSV was written out by hand
  and four managers' budgets did not reconcile. Diffing against Sleeper proved the *assignments*
  were right, which localised the problem to prices — and re-reading the sheet showed the prices
  were right too, and the sheet's own summary was wrong. Without a numeric check the error would
  have been silently inverted.
- **A per-row record beats a summary of it, every time.** Both are "the sheet", and only one can be
  audited line by line.

**Watch out for:**

- **2025 has a real drawn draft order** — it is on the sheet's first tab — so it is recorded rather
  than reconstructed. The workbook years still fall back to first nomination and say so.
- Every season now auto-generates an over-budget note when a manager finishes above $200, so the
  explanation travels with the data rather than living in a commit message.
- 2025's over-budget managers are Bill (−$1) and Bryan (−$8), which are **not** the ones the sheet's
  summary flagged. Same cause, different arithmetic.

**Next:** H10 — member pages and the head-to-head grid.

---

## Step 42 — Three sections, on hover

**Date:** 2026-08-18  **Status:** done

**Built:** `SiteNav` rebuilt as three hover menus, `/history/drafts` (Past Auctions), and the
redundant page title removed from `/draft`.

```
FANTASYWORLD   Draft ▾   Draft History ▾   League History ▾
```

### Two sections were one too few

The first cut had Draft and History, and everything draft-shaped piled into one flat row. That
conflated two genuinely different questions — *what is happening in this auction* and *what
happened in past auctions* — which share pages but not intent. A row of eight equal-weight links
made the reader do that sorting themselves.

`/history/drafts` gives the middle section a home: every auction on record, its most expensive pick,
who finished over budget, the notes, and buttons through to that year's board, spend view and CSV.
The year picker on `/board` could already do this, but only for somebody who knew the picker existed.

### The menus are CSS-only, deliberately

`group-hover` plus `group-focus-within`, so `SiteNav` stays hook-free and renders unchanged inside
the client draft pages and the server-rendered history pages alike. It also keeps the menus working
while JavaScript is still loading, which on draft night is worth having. `invisible` rather than
`hidden` keeps every link in the tab order, so the menus open on keyboard focus too.

**Learned:**

- **A flat nav grows one item per feature and never shrinks.** Nesting keeps the top level at three
  stable words, so the shape of the app is legible before you read any of it.
- **Two titles is one title too many.** `/draft` carried an "Auction Draft" heading beside the
  wordmark and the section nav, all three saying the same thing.

**Watch out for:**

- Hover menus assume a pointer. Mobile is explicitly out of scope (`UAT.md`), but if that changes
  this is the first thing to revisit.
- The section a page belongs to is passed in, not inferred from the path — `/stats` sits under
  Draft History while `/board` sits under Draft, and no amount of path-matching would guess that.

**Next:** H10 — member pages and the head-to-head grid.

---

## Step 43 — Phase 2 H10: members, head to head, favourites

**Date:** 2026-08-18  **Status:** done

**Built:** `headToHead()` and `memberProfile()` in `src/lib/history.ts` (+13 tests),
`getFavoritePlayers`/`getMostCarried` in the service, `/history/members`,
`/history/members/[id]`, `/history/h2h`, and a sortable all-time table.

**287 unit tests passing.** Phase 2's ten build steps are complete.

### Favourite players — the feature the data was already carrying

`picks` knows what somebody paid; `player_weeks` knows how long they carried them. Joined per
manager, that answers "who does this person actually like" — and the two halves disagree usefully.
Bill's most expensive player and his most-carried are both Ja'Marr Chase, but Keenan Allen and
Christian Kirk show up near the top of the weeks list having **never been drafted at all**.

Ranked by weeks rather than money, on the league's instruction: a $54 buy dropped by week four says
less than a waiver pickup kept for four seasons. A **FULL JOIN**, because drafting and rostering are
independent — a waiver pickup has weeks and no price, a 2026 pick has a price and no weeks.

### Seed and Finish are two different columns now

The first cut put an unlabelled medal beside a column headed "Place", which read as a contradiction:
a trophy next to 4th. It is not — Bill was the 4 seed in 2016 and won it. Two columns, each saying
which question it answers.

### The all-time table sorts

Every column, because the interesting question changes by reader. `LeagueSummaryTable` becomes the
one client component in `/history`; everything else stays a Server Component shipping no JavaScript.

**Learned:**

- **A null must not be sortable as a zero.** Nulls here mean "no record for this era", so they sort
  last in *both* directions — floating a manager with no weekly data to the top of "worst lineup
  efficiency" would be a confident wrong answer.
- **`memberProfile` reuses `leagueSummary` rather than recomputing.** A member page and the all-time
  table disagreeing by a game is the kind of thing that makes people stop trusting both, and a test
  asserts they are identical.
- **A grid child defaults to `min-width: auto`.** The wide season table forced the whole row wider
  than its container and pushed the right column's values off the screen edge; `min-w-0` on the grid
  and both children fixes it. Caught by looking at a screenshot, not by a test.

**Watch out for:**

- **Head-to-head is regular season only**, deliberately. Playoff meetings are rare and unevenly
  distributed, so including them would say more about seeding than about the matchup — and it keeps
  the grid comparable to the league's own Everyone-vs-Everyone sheet.
- Cell tint tracks win rate but **colour is never the only encoding**: every cell prints its record.
- An unknown draft spend renders as `—`, never `$0`. A season whose auction is not on record is not
  a season somebody drafted nobody.

**Next:** Phase 2's build steps are done. Remaining: run the migrations and imports against Neon
once the quota clears, and a UAT pass over the new pages.

---

## Step 44 — A weekly refresh, and the waiver wire's greatest hits

**Date:** 2026-08-18  **Status:** done

**Built:** `scripts/history/refresh-season.ts` (`npm run history:refresh`),
`.github/workflows/weekly-history.yml`, `getBestPickups()`, and best-pickup lines on every season
card. Plus two bugs the live season exposed.

**291 unit tests passing.**

### The season in progress is a different kind of data

Everything before this assumed a finished season. Pointing the importer at a live one surfaced two
faults within minutes, both of the same shape — **a row existing is not the same as something having
happened**:

- **Sleeper returns the whole schedule from day one.** A league in week 1 answers with fourteen
  weeks of matchups, every one 0–0 with lineups already set. Imported, they became the lowest score
  on record, the narrowest win, and a ten-way tie in every all-play week. `hasBeenPlayed()` now
  skips a week until somebody has scored.
- **A standings row appears on the first refresh** with an 0-0 record and zero points, which won
  "fewest points in a season" outright and stretched every era badge to 2026. `playedStandings()`
  drops seasons nobody has played from the season-level records and from coverage.

`is_final` also follows Sleeper's own `status` now rather than being asserted true, so a live season
reads as live.

### Best pickups, split by owner

Most points started by a player **nobody in the league rostered in week 1** — a player dropped by one
team and claimed by another is a trade of sorts; a player nobody owned is a find.

Ranked on the player's whole season and then **split across everyone who held them**, because whoever
found somebody and whoever cashed in are rarely the same person: 2023's best pickup is C.J. Stroud at
228, of which Eric/Blakey realised 75 over four starts before Bill took 153 over seven. Crediting one
manager erased half the story, and ranking each share separately buried the player entirely — Stroud
placed behind Jerome Ford until the halves were added together.

**Learned:**

- **Live data is its own test case.** Six settled seasons imported cleanly and told us nothing about
  what a season in progress looks like. Two bugs, both found by running the thing once against a
  league that had not kicked off.
- **Rank on the whole, display the parts.** Ranking on an owner's share hides traded players; showing
  only the total hides who actually found them.

**Watch out for:**

- **Wednesday, not Tuesday.** The NFL week ends Monday night and stat corrections settle through
  Tuesday; pulling earlier imports scores that are still moving.
- **The workflow needs a `DATABASE_URL` repository secret** and fails loudly on step one without it,
  rather than importing nothing and reporting success.
- **It refreshes one season, not all of them.** Re-pulling six settled seasons weekly would churn six
  seasons of committed files and would let a Sleeper revision quietly rewrite settled history.
- `CURRENT_SLEEPER_SEASON` is the one place a literal current year lives, and it moves every August
  alongside `npm run season:new`.

---

## Step 45 — Every ring counts, and the grid becomes readable

**Date:** 2026-08-18  **Status:** done

**Changed:** 2006–2010 champions now resolve to managers, the head-to-head grid moves to one
diverging scale, legacy season cards drop their empty rows, and the trophy display stops
multiplying.

**291 unit tests passing.**

### Championships reach back to 2006

The earlier position — that linking a pre-membership-record name to today's manager was "a guess
dressed as a fact" — was overruled by the league, correctly. Rings are counted from the start of the
record, the way every other sport does it, and the league knows whether the 2006 Daniel is this
Daniel. Bryan goes to **5**, Daniel to **4**, Justin to **2**.

It does create a real era mismatch, so the trophy column carries its own `Coverage`: titles span
2006–2025 while the record beside them spans 2011–2025. That is exactly what `EraBadge` is for.

### The head-to-head grid was unreadable, and it was my fault

Cells were tinted with the row manager's own colour and the text colour was computed from that tint
— which in the light theme put pale text on a pale background across half the grid. Ten competing
hues also meant nothing stood out.

One diverging scale now: green above .500, red below, intensity tracking distance from even, and
**the text colour left alone** so contrast is whatever the theme already guarantees. It cannot
regress to light-on-light, because nothing overrides the foreground any more.

**Learned:**

- **Computing a foreground from a computed background is where contrast bugs live.** Leaving the
  text alone and tinting only behind it is both simpler and safe in every theme by construction.
- **Absence rendered as content reads as breakage.** A legacy card showing Runner-up, Third and
  Regular season as three em-dashes made a complete record look like a broken one. Showing only what
  exists says more.
- **`🏆🏆🏆 ×4` reads as twelve.** Repetition and multiplication in the same glyph run multiply in the
  reader's head. Past three it is one trophy and a count.

**Watch out for:**

- Linking legacy champions is the **one** place the app asserts a pre-record name is today's person.
  The resolver still throws on anything unrecognised, so a new name there stops the import rather
  than inventing an eleventh member.
- The trophy column's span is wider than the table's. If a column is ever added that also reaches
  past 2011, it needs its own badge too.

## Buy-in, and what it took to make "winnings" a real number

The league's prize table records what the podium *won*. It says nothing about what anyone *paid*,
so the Net column read −$350 for all ten managers: 2026's entry fee against fifteen years of prizes.

Then the rule turned out to be recoverable. **Third gets their money back, second gets double, first
takes the rest** — ten managers, a `10×` pot, payouts of `7× / 2× / 1×`. The third-place prize is
the buy-in. It holds for all fourteen priced seasons with every pot balancing to the dollar, so
`seasons.buy_in` is derived at import instead of being typed in by hand.

Derived *and* asserted: the importer throws if a runner-up isn't `2×` third, or a champion isn't
`7×`. A changed payout structure should stop an import and get recorded, not quietly become a wrong
buy-in that skews every career figure downstream.

Net winnings became a real spread as a result — Daniel +$1,550 and Bryan +$825 at one end, Jack
−$1,425 at the other — and then validated itself: **every net figure sums to exactly −$3,500**,
which is 2026's ten $350 buy-ins paid in and not yet awarded. That was not something I built a check
for; it fell out of the data and is now the check.

The same commit moves draft location and buy-in out of a script and into `/setup`, which is where
they were asked for. They live on `seasons`, not `draft`, and unlike budget and roster size they
stay editable after the first pick.

**Learned:**

- **A derived field with an assertion beats a typed one with a comment.** Fourteen hand-entered
  buy-ins are fourteen chances to fat-finger a digit, and nothing would have caught it. One rule,
  checked on every row, catches both a typo *and* the day the league changes the rule.
- **A zero-sum domain gives you a free integration test.** Nothing in the code knows the league is
  zero-sum, so "the nets sum to minus the undecided pot" exercises the prize import, the buy-in
  derivation, the podium mapping and the profile aggregation in a single number. Look for the
  conservation law before writing assertions by hand.
- **"Unknown" has to survive the whole round trip.** `null` buy-in → empty box in the form → `null`
  back to the database. A single `?? 0` anywhere in that chain would turn "we haven't agreed on it"
  into "it was free", and the resulting net would look plausible enough that nobody would question
  it.
- **Not every setting deserves the mid-draft lock.** `setLeagueSettings` refuses to run once picks
  exist, and copying that guard onto season info would have been the reflex. But the buy-in is
  usually settled *after* the room has paid up, and nothing about it can move a max bid.

**Watch out for:**

- The rule is asserted only for seasons that *have* a third-place prize. A season priced from one
  end (champion only) derives no buy-in at all and stays `null`, which is correct but easy to read
  as a bug when the Net column skips it.
- `/api/season-info` is a second read path for league facts. It must stay off the polling
  fingerprint in `src/lib/version.ts` — its whole reason to exist is that it isn't on it.
- 2025 has no prize data, so it has no buy-in. If it is priced later, the derivation picks it up on
  the next `history:import-workbook` run — the importer's upsert `COALESCE`s so a re-run adds
  without overwriting what the setup form may have set by hand.
