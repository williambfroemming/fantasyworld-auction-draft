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
