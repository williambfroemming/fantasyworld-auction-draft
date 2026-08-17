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
