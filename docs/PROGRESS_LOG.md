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
