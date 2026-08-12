# Fantasy Auction Draft

Live auction draft app for a 10-person fantasy football league, replacing a manual Google Sheet.
**The real draft is Friday 2026-08-14.** This is not a toy — ten people will be bidding real money-equivalent budgets in a room, in real time.

## Read these first

| File | What it is |
|---|---|
| `docs/PROJECT_PLAN.md` | The durable spec — context, locked decisions, rules, architecture, data model, build steps |
| `docs/PROGRESS_LOG.md` | Append-only learnings, one entry per completed step. **Read before starting work** |
| `docs/UAT.md` | Acceptance checklist the user runs against a preview deploy |

## The working rule — follow this on every completed build step

1. Append a full entry to `docs/PROGRESS_LOG.md`, including **Learned** and **Watch out for**. An entry with nothing learned is a smell, not a clean run.
2. Flip that step's box to `[x]` in `docs/PROJECT_PLAN.md` §10.
3. Commit docs alongside the code so the tree and the docs never disagree.
4. Move on. Don't batch several steps and reconstruct the log afterwards — the learnings are the first thing to evaporate.

## Non-negotiables

These look like mistakes and are not. Read `PROJECT_PLAN.md` §4 before changing any of them.

- **Budget and max bid are derived from `picks`, never stored.** Storing them is exactly how the old sheet ended up with a manager at −1.
- **Bids are one atomic conditional `UPDATE`, not `SELECT … FOR UPDATE`.** Neon's HTTP driver has no interactive transactions; the transactional version fails at runtime.
- **`GET /api/state` has side effects** (lazy settlement) and must stay `force-dynamic` + `no-store`. Caching it freezes the entire draft and looks like a UI bug.
- **The client clock is never trusted.** Countdowns render against a server-provided `serverNow` offset.
- **`autoSlot()` is display-only** and must stay unreachable from any bid path. Position slotting must never be able to block a bid.
- **Roster is 16 slots.** `maxBid = budget − (16 − rostered − 1)` → $185 at the start. Getting this wrong skews every bid all draft.

## Commands

```bash
npm run dev            # local dev
npm test               # unit tests for the rules engine
npx dotenv -e .env.local -- npx drizzle-kit push    # migrations (drizzle-kit does NOT read .env.local on its own)
```
