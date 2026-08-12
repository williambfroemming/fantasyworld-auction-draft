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
